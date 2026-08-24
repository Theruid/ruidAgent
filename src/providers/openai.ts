import type {
  CompletionRequest,
  LLMMessage,
  LLMProvider,
  ProviderConfig,
  StreamEvent,
} from "./types.js";
import { sseDataLines } from "./types.js";

// Works with any OpenAI-compatible /chat/completions endpoint:
// OpenAI, DeepSeek, Groq, OpenRouter, Together, Mistral, Ollama (/v1), LM Studio, vLLM.

function resolveApiKey(config: ProviderConfig): string | undefined {
  return (
    config.apiKey ??
    (config.apiKeyEnv ? process.env[config.apiKeyEnv] : undefined) ??
    process.env.OPENAI_API_KEY
  );
}

// Local servers (Ollama/LM Studio) don't need a key; remote endpoints do.
function isLocalBase(baseUrl: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/.test(baseUrl);
}

function resolveBaseUrl(config: ProviderConfig): string {
  return (config.baseUrl ?? "https://api.openai.com").replace(/\/+$/, "");
}

export async function listModels(config: ProviderConfig): Promise<string[]> {
  const apiKey = resolveApiKey(config);
  const baseUrl = resolveBaseUrl(config);

  if (!apiKey && !isLocalBase(baseUrl)) {
    throw new Error(`API key required for ${baseUrl}. Use --api-key, --api-key-env, or config.`);
  }

  const headers: Record<string, string> = { ...config.headers };
  if (apiKey) headers["authorization"] = `Bearer ${apiKey}`;

  const res = await fetch(`${baseUrl}/models`, { headers });
  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`${baseUrl}/models responded ${res.status}: ${errText.slice(0, 300)}`);
  }

  const json: any = await res.json();
  const ids: string[] = Array.isArray(json?.data)
    ? json.data.filter((m: any) => typeof m?.id === "string").map((m: any) => m.id)
    : [];
  return [...new Set(ids)].sort();
}

export function createOpenAIProvider(config: ProviderConfig): LLMProvider {
  const apiKey = resolveApiKey(config);

  if (!apiKey && !isLocalBase(resolveBaseUrl(config))) {
    throw new Error(
      `OpenAI-compatible provider needs an API key. Set apiKeyEnv in config or OPENAI_API_KEY.`,
    );
  }

  const baseUrl = resolveBaseUrl(config);

  return {
    name: `openai-compatible (${baseUrl})`,
    config,

    async *complete(req: CompletionRequest): AsyncIterable<StreamEvent> {
      const headers: Record<string, string> = {
        "content-type": "application/json",
        ...config.headers,
      };
      if (apiKey) headers["authorization"] = `Bearer ${apiKey}`;

      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: req.model,
          stream: true,
          stream_options: { include_usage: true },
          messages: [
            { role: "system", content: req.system },
            ...req.messages.map(translateMessage),
          ],
          ...(req.tools.length > 0 && {
            tools: req.tools.map((t) => ({
              type: "function",
              function: { name: t.name, description: t.description, parameters: t.parameters },
            })),
          }),
        }),
        signal: req.signal,
      });

      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => res.statusText);
        yield { type: "error", message: `${baseUrl} responded ${res.status}: ${errText}` };
        return;
      }

      yield* parseStream(res.body);
    },
  };
}

function translateMessage(m: LLMMessage): Record<string, unknown> {
  if (m.role === "assistant") {
    const text = m.content
      .filter((c): c is Extract<typeof c, { type: "text" }> => c.type === "text")
      .map((c) => c.text)
      .join("");
    const toolCalls = m.content.flatMap((c) =>
      c.type === "tool_call"
        ? [
            {
              id: c.id,
              type: "function" as const,
              function: { name: c.name, arguments: JSON.stringify(c.input ?? {}) },
            },
          ]
        : [],
    );
    return {
      role: "assistant",
      ...(text ? { content: text } : {}),
      ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
    };
  }

  // User-role message. The OpenAI protocol requires each tool result to be
  // its own role=tool message, so a user message containing multiple results
  // (or mixed with text) can't be expressed — the loop guarantees one result
  // per user message for this adapter's benefit.
  const first = m.content[0];
  if (first?.type === "tool_result") {
    return {
      role: "tool",
      tool_call_id: first.toolCallId,
      content: first.content,
    };
  }

  const text = m.content
    .filter((c): c is Extract<typeof c, { type: "text" }> => c.type === "text")
    .map((c) => c.text)
    .join("\n");
  return { role: "user", content: text || "(empty)" };
}

async function* parseStream(body: ReadableStream<Uint8Array>): AsyncIterable<StreamEvent> {
  let usage: { prompt_tokens?: number; completion_tokens?: number } | undefined;
  let finishReason: string | null = null;

  // Accumulate streamed argument fragments per call index; emit each call as
  // a single complete event once its finish_reason arrives or stream ends.
  const calls = new Map<number, { id: string; name: string; json: string }>();

  for await (const payload of sseDataLines(body)) {
    let evt: any;
    try {
      evt = JSON.parse(payload);
    } catch {
      continue;
    }

    if (evt.usage) usage = evt.usage;

    const choice = evt.choices?.[0];
    if (!choice) continue;

    const delta = choice.delta;
    if (choice.finish_reason) finishReason = choice.finish_reason;

    if (!delta) continue;

    if (typeof delta.content === "string" && delta.content.length > 0) {
      yield { type: "text_delta", text: delta.content };
    } else if (typeof delta.reasoning_content === "string" && delta.reasoning_content.length > 0) {
      yield { type: "text_delta", text: delta.reasoning_content };
    } else if (typeof delta.reasoning === "string" && delta.reasoning.length > 0) {
      yield { type: "text_delta", text: delta.reasoning };
    }

    for (const tc of delta.tool_calls ?? []) {
      const idx: number = tc.index ?? 0;
      let entry = calls.get(idx);
      if (!entry) {
        entry = {
          id: tc.id ?? `call_${idx}`,
          name: tc.function?.name ?? "",
          json: "",
        };
        calls.set(idx, entry);
      }
      if (tc.function?.name && !entry.name) entry.name = tc.function.name;
      if (tc.function?.arguments) entry.json += tc.function.arguments;
    }
  }

  // Stream over: flush complete tool calls in index order.
  const ordered = [...calls.entries()].sort((a, b) => a[0] - b[0]);
  for (const [, call] of ordered) {
    if (!call.name) continue;
    let input: unknown = {};
    if (call.json.trim()) {
      try {
        input = JSON.parse(call.json);
      } catch {
        yield {
          type: "error",
          message: `Malformed arguments for ${call.name}: ${call.json.slice(0, 200)}`,
        };
        continue;
      }
    }
    yield { type: "tool_call", id: call.id, name: call.name, input };
  }

  const hadToolCalls = ordered.length > 0;
  yield {
    type: "message_delta",
    stopReason: hadToolCalls ? "tool_use" : finishReason === "stop" ? "end_turn" : finishReason,
    usage: usage
      ? { inputTokens: usage.prompt_tokens ?? 0, outputTokens: usage.completion_tokens ?? 0 }
      : undefined,
  };
}

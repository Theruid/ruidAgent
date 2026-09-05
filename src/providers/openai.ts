import type {
  CompletionRequest,
  LLMMessage,
  LLMProvider,
  ModelCapabilities,
  ProviderConfig,
  StreamEvent,
  SystemPromptBlock,
} from "./types.js";
import { sseDataLines } from "./types.js";
import { fetchWithRetry } from "./retry.js";
import { resolveModelCapabilities } from "./capabilities.js";

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

  const res = await fetchWithRetry(`${baseUrl}/models`, { headers });
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

export function createOpenAIProvider(config: ProviderConfig, name = "openai-compatible"): LLMProvider {
  const apiKey = resolveApiKey(config);

  if (!apiKey && !isLocalBase(resolveBaseUrl(config))) {
    throw new Error(
      `OpenAI-compatible provider needs an API key. Set apiKeyEnv in config or OPENAI_API_KEY.`,
    );
  }

  const baseUrl = resolveBaseUrl(config);

  return {
    name,
    config,

    capabilities(model?: string): ModelCapabilities {
      const targetModel = model ?? config.defaultModel ?? "gpt-4o";
      return resolveModelCapabilities("openai", targetModel, config);
    },

    async *complete(req: CompletionRequest): AsyncIterable<StreamEvent> {
      const headers: Record<string, string> = {
        "content-type": "application/json",
        ...config.headers,
      };
      if (apiKey) headers["authorization"] = `Bearer ${apiKey}`;

      const caps = resolveModelCapabilities("openai", req.model, config);

      const systemContent = Array.isArray(req.system)
        ? req.system.map((b: SystemPromptBlock) => b.text).join("\n\n")
        : req.system;

      const bodyPayload: Record<string, unknown> = {
        model: req.model,
        stream: true,
        stream_options: { include_usage: true },
        messages: [
          { role: "system", content: systemContent },
          ...req.messages.flatMap(translateMessageToOpenAI),
        ],
      };

      if (req.tools.length > 0) {
        bodyPayload.tools = req.tools.map((t) => ({
          type: "function",
          function: { name: t.name, description: t.description, parameters: t.parameters },
        }));
      }

      // Handle structured output format
      if (req.responseFormat?.type === "json_schema") {
        bodyPayload.response_format = {
          type: "json_schema",
          json_schema: {
            name: req.responseFormat.jsonSchema.name || "structured_response",
            description: req.responseFormat.jsonSchema.description,
            strict: req.responseFormat.jsonSchema.strict ?? true,
            schema: req.responseFormat.jsonSchema.schema,
          },
        };
      } else if (req.responseFormat?.type === "json_object") {
        bodyPayload.response_format = { type: "json_object" };
      }

      // Reasoning models (o1, o3-mini) vs standard models parameter handling
      if (caps.supportsReasoningEffort) {
        if (req.thinking?.type === "disabled") {
          bodyPayload.reasoning_effort = "low";
        } else if (req.thinking?.reasoningEffort) {
          bodyPayload.reasoning_effort = req.thinking.reasoningEffort;
        }
        if (typeof req.maxTokens === "number") {
          bodyPayload.max_completion_tokens = req.maxTokens;
        }
        // Omit temperature for reasoning models (rejected by OpenAI API)
      } else {
        if (req.thinking?.type === "disabled") {
          // Send explicit disabled reasoning hint to OpenAI/Gemini/OpenRouter proxies
          bodyPayload.thinking = { type: "disabled", budget_tokens: 0 };
        } else if (req.thinking?.type === "enabled") {
          bodyPayload.thinking = { type: "enabled", budget_tokens: req.thinking.budgetTokens ?? 2048 };
        }

        if (typeof req.temperature === "number") {
          bodyPayload.temperature = req.temperature;
        }
        if (typeof req.maxTokens === "number") {
          bodyPayload.max_tokens = req.maxTokens;
        }
      }

      let res: Response;
      try {
        res = await fetchWithRetry(
          `${baseUrl}/chat/completions`,
          {
            method: "POST",
            headers,
            body: JSON.stringify(bodyPayload),
          },
          { signal: req.signal }
        );
      } catch (err) {
        yield {
          type: "error",
          message: `${baseUrl} network connection failed: ${err instanceof Error ? err.message : String(err)}`,
        };
        return;
      }

      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => res.statusText);
        yield { type: "error", message: `${baseUrl} responded ${res.status}: ${errText}` };
        return;
      }

      const allowThinking = req.thinking?.type !== "disabled";
      yield* parseStream(res.body, allowThinking);
    },
  };
}

export function translateMessageToOpenAI(m: LLMMessage): Array<Record<string, unknown>> {
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
    return [
      {
        role: "assistant",
        ...(text ? { content: text } : {}),
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      },
    ];
  }

  // User-role message can contain text, multiple tool_results, or both.
  // In the OpenAI protocol, each tool result MUST be its own discrete role="tool" message.
  const toolResults = m.content.filter((c): c is Extract<typeof c, { type: "tool_result" }> => c.type === "tool_result");
  const textBlocks = m.content.filter((c): c is Extract<typeof c, { type: "text" }> => c.type === "text");

  const results: Array<Record<string, unknown>> = [];

  // Emit each tool result as a discrete message
  for (const tr of toolResults) {
    results.push({
      role: "tool",
      tool_call_id: tr.toolCallId,
      content: tr.content,
    });
  }

  // If there is also text in this user turn, emit it as a user message
  if (textBlocks.length > 0 || results.length === 0) {
    const text = textBlocks.map((c) => c.text).join("\n");
    results.push({
      role: "user",
      content: text || "(empty)",
    });
  }

  return results;
}

export function translateMessage(m: LLMMessage): Record<string, unknown> {
  const translated = translateMessageToOpenAI(m);
  return translated[0] ?? { role: "user", content: "(empty)" };
}

export async function* parseStream(
  body: ReadableStream<Uint8Array>,
  allowThinking = true
): AsyncIterable<StreamEvent> {
  let usage: any | undefined;
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

    // A chunk can carry both reasoning_content and text content (or thought_delta first)
    if (allowThinking) {
      if (typeof delta.reasoning_content === "string" && delta.reasoning_content.length > 0) {
        yield { type: "thought_delta", text: delta.reasoning_content };
      } else if (typeof delta.reasoning === "string" && delta.reasoning.length > 0) {
        yield { type: "thought_delta", text: delta.reasoning };
      } else if (typeof delta.thought === "string" && delta.thought.length > 0) {
        yield { type: "thought_delta", text: delta.thought };
      }
    }

    if (typeof delta.content === "string" && delta.content.length > 0) {
      yield { type: "text_delta", text: delta.content };
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
  const cachedTokens =
    usage?.prompt_tokens_details?.cached_tokens ??
    usage?.prompt_cache_hit_tokens ??
    usage?.cache_read_input_tokens ??
    0;

  yield {
    type: "message_delta",
    stopReason: hadToolCalls ? "tool_use" : finishReason === "stop" ? "end_turn" : finishReason,
    usage: usage
      ? {
          inputTokens: usage.prompt_tokens ?? 0,
          outputTokens: usage.completion_tokens ?? 0,
          cacheReadInputTokens: cachedTokens,
        }
      : undefined,
  };
}

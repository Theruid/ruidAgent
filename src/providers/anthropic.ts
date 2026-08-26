import type {
  CompletionRequest,
  LLMMessage,
  LLMProvider,
  ProviderConfig,
  StreamEvent,
} from "./types.js";
import { sseDataLines } from "./types.js";
import { fetchWithRetry } from "./retry.js";

const ANTHROPIC_DEFAULT_BASE = "https://api.anthropic.com";

export const ANTHROPIC_MODELS: string[] = [
  "claude-sonnet-5",
  "claude-opus-5",
  "claude-haiku-4-5-20251001",
  "claude-3-5-sonnet-latest",
  "claude-3-5-haiku-latest",
  "claude-3-opus-latest",
];

export async function listModels(config?: ProviderConfig): Promise<string[]> {
  const custom = config?.models ?? [];
  return [...new Set([...custom, ...ANTHROPIC_MODELS])];
}

export function createAnthropicProvider(config: ProviderConfig): LLMProvider {
  const apiKey =
    config.apiKey ??
    (config.apiKeyEnv ? process.env[config.apiKeyEnv] : undefined) ??
    process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error(
      `Anthropic provider needs an API key. Set apiKeyEnv in config or the ANTHROPIC_API_KEY env var.`,
    );
  }

  const baseUrl = (config.baseUrl ?? ANTHROPIC_DEFAULT_BASE).replace(/\/+$/, "");

  return {
    name: "anthropic",
    config,

    async *complete(req: CompletionRequest): AsyncIterable<StreamEvent> {
      let res: Response;
      try {
        res = await fetchWithRetry(
          `${baseUrl}/v1/messages`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-api-key": apiKey,
              "anthropic-version": "2023-06-01",
              ...config.headers,
            },
            body: JSON.stringify({
              model: req.model,
              max_tokens: 8192,
              system: req.system,
              messages: req.messages.map(translateMessage),
              tools: req.tools.map((t) => ({
                name: t.name,
                description: t.description,
                input_schema: t.parameters,
              })),
              stream: true,
            }),
          },
          { signal: req.signal }
        );
      } catch (err) {
        yield {
          type: "error",
          message: `Anthropic network connection failed: ${err instanceof Error ? err.message : String(err)}`,
        };
        return;
      }

      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => res.statusText);
        yield { type: "error", message: `Anthropic API ${res.status}: ${errText}` };
        return;
      }

      yield* parseStream(res.body);
    },
  };
}

// Our canonical shape maps ~1:1 onto Anthropic's wire format; tool_result
// blocks live inside user messages per the API contract.
function translateMessage(m: LLMMessage) {
  return {
    role: m.role,
    content: m.content.map((c) => {
      switch (c.type) {
        case "text":
          return { type: "text", text: c.text };
        case "tool_call":
          return { type: "tool_use", id: c.id, name: c.name, input: c.input };
        case "tool_result":
          return {
            type: "tool_result",
            tool_use_id: c.toolCallId,
            content: c.content,
            ...(c.isError ? { is_error: true } : {}),
          };
      }
    }),
  };
}

async function* parseStream(body: ReadableStream<Uint8Array>): AsyncIterable<StreamEvent> {
  let usage: { inputTokens: number; outputTokens: number } | undefined;
  let stopReason: string | null = null;

  // tool_use blocks stream their JSON args in fragments; accumulate until
  // the block closes, then emit one complete tool_call event.
  let openTool: { id: string; name: string; json: string } | null = null;

  for await (const payload of sseDataLines(body)) {
    let evt: any;
    try {
      evt = JSON.parse(payload);
    } catch {
      continue;
    }

    switch (evt.type) {
      case "message_start":
        if (evt.message?.usage) {
          usage = {
            inputTokens: evt.message.usage.input_tokens ?? 0,
            outputTokens: evt.message.usage.output_tokens ?? 0,
          };
        }
        break;

      case "content_block_start":
        if (evt.content_block?.type === "tool_use") {
          openTool = {
            id: evt.content_block.id,
            name: evt.content_block.name,
            json: "",
          };
        }
        break;

      case "content_block_delta": {
        const d = evt.delta;
        if (d?.type === "text_delta") {
          yield { type: "text_delta", text: d.text };
        } else if (d?.type === "input_json_delta" && openTool) {
          openTool.json += d.partial_json;
        }
        break;
      }

      case "content_block_stop":
        if (openTool) {
          let input: unknown = {};
          if (openTool.json.trim()) {
            try {
              input = JSON.parse(openTool.json);
            } catch {
              yield {
                type: "error",
                message: `Malformed tool arguments for ${openTool.name}: ${openTool.json.slice(0, 200)}`,
              };
            }
          }
          yield { type: "tool_call", id: openTool.id, name: openTool.name, input };
          openTool = null;
        }
        break;

      case "message_delta":
        stopReason = evt.delta?.stop_reason ?? stopReason;
        if (evt.usage) {
          usage = {
            inputTokens: evt.usage.input_tokens ?? usage?.inputTokens ?? 0,
            outputTokens: evt.usage.output_tokens ?? 0,
          };
        }
        break;

      case "error":
        yield { type: "error", message: evt.error?.message ?? "unknown stream error" };
        return;
    }
  }

  yield { type: "message_delta", stopReason, usage };
}

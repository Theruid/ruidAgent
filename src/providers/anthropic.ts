import type {
  CompletionRequest,
  LLMMessage,
  LLMProvider,
  ModelCapabilities,
  ProviderConfig,
  StreamEvent,
  SystemPromptBlock,
  Usage,
} from "./types.js";
import { sseDataLines } from "./types.js";
import { fetchWithRetry } from "./retry.js";
import { resolveModelCapabilities } from "./capabilities.js";

const ANTHROPIC_DEFAULT_BASE = "https://api.anthropic.com";

export const ANTHROPIC_MODELS: string[] = [
  "claude-sonnet-5",
  "claude-opus-5",
  "claude-haiku-4-5-20251001",
  "claude-3-7-sonnet-latest",
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

    capabilities(model?: string): ModelCapabilities {
      const targetModel = model ?? config.defaultModel ?? "claude-sonnet-5";
      return resolveModelCapabilities("anthropic", targetModel, config);
    },

    async *complete(req: CompletionRequest): AsyncIterable<StreamEvent> {
      let res: Response;
      const caps = resolveModelCapabilities("anthropic", req.model, config);

      // Format system prompt as block array with cache control if available
      let systemPayload: any = req.system;
      if (Array.isArray(req.system)) {
        systemPayload = req.system.map((block: SystemPromptBlock) => ({
          type: "text",
          text: block.text,
          ...(block.cacheControl ? { cache_control: block.cacheControl } : {}),
        }));
      }

      // Deterministically sort tools so prompt cache prefix remains stable
      const sortedTools = [...req.tools].sort((a, b) => a.name.localeCompare(b.name));

      // Add cache_control to the last tool definition to cache the static tool prefix
      const toolsPayload: any[] = sortedTools.map((t, idx) => {
        const isLastTool = idx === sortedTools.length - 1;
        const cacheControl = t.cacheControl ?? (isLastTool ? { type: "ephemeral" as const } : undefined);
        return {
          name: t.name,
          description: t.description,
          input_schema: t.parameters,
          ...(cacheControl ? { cache_control: cacheControl } : {}),
        };
      });

      // Handle structured output schema via synthetic tool choice constraint
      let toolChoicePayload: any = undefined;
      if (req.responseFormat?.type === "json_schema") {
        const schemaDef = req.responseFormat.jsonSchema;
        const toolName = schemaDef.name || "structured_output";
        toolsPayload.push({
          name: toolName,
          description: schemaDef.description || "Output structured JSON matching this schema",
          input_schema: schemaDef.schema,
        });
        toolChoicePayload = { type: "tool", name: toolName };
      }

      // Prepare messages with rolling cache control at stable N-2 index
      const messagesPayload = req.messages.map((m, mIdx) => {
        const isRollingCacheTurn = req.messages.length >= 3 && mIdx === req.messages.length - 2 && m.role === "user";
        return translateMessage(m, isRollingCacheTurn);
      });

      // Configure thinking parameters
      const thinkingEnabled = caps.supportsThinking && req.thinking?.type === "enabled";
      const thinkingBudget = thinkingEnabled ? req.thinking?.budgetTokens ?? 2048 : undefined;
      const maxTokens = req.maxTokens ?? (thinkingBudget ? Math.max(8192, thinkingBudget + 4096) : 8192);

      const requestBody: Record<string, unknown> = {
        model: req.model,
        max_tokens: maxTokens,
        system: systemPayload,
        messages: messagesPayload,
        tools: toolsPayload.length > 0 ? toolsPayload : undefined,
        tool_choice: toolChoicePayload,
        stream: true,
      };

      if (thinkingEnabled) {
        requestBody.thinking = {
          type: "enabled",
          budget_tokens: thinkingBudget,
        };
        // Anthropic requires temperature to be 1 or omitted when thinking is enabled
      } else if (typeof req.temperature === "number") {
        requestBody.temperature = req.temperature;
      }

      try {
        res = await fetchWithRetry(
          `${baseUrl}/v1/messages`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-api-key": apiKey,
              "anthropic-version": "2023-06-01",
              "anthropic-beta": "prompt-caching-2024-07-31",
              ...config.headers,
            },
            body: JSON.stringify(requestBody),
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

      yield* parseStream(res.body, thinkingEnabled);
    },
  };
}

// Our canonical shape maps ~1:1 onto Anthropic's wire format; tool_result
// blocks live inside user messages per the API contract.
export function translateMessage(m: LLMMessage, addCacheControl = false) {
  const contentBlocks = m.content.map((c, cIdx) => {
    const isLastBlock = cIdx === m.content.length - 1;
    const cache_control = addCacheControl && isLastBlock ? { type: "ephemeral" as const } : undefined;

    switch (c.type) {
      case "text":
        return {
          type: "text",
          text: c.text,
          ...(c.cacheControl ? { cache_control: c.cacheControl } : cache_control ? { cache_control } : {}),
        };
      case "tool_call":
        return { type: "tool_use", id: c.id, name: c.name, input: c.input };
      case "tool_result":
        return {
          type: "tool_result",
          tool_use_id: c.toolCallId,
          content: c.content,
          ...(c.isError ? { is_error: true } : {}),
          ...(c.cacheControl ? { cache_control: c.cacheControl } : cache_control ? { cache_control } : {}),
        };
    }
  });

  return {
    role: m.role,
    content: contentBlocks,
  };
}

export async function* parseStream(
  body: ReadableStream<Uint8Array>,
  allowThinking = true
): AsyncIterable<StreamEvent> {
  let usage: Usage | undefined;
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
            cacheCreationInputTokens: evt.message.usage.cache_creation_input_tokens ?? 0,
            cacheReadInputTokens: evt.message.usage.cache_read_input_tokens ?? 0,
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
        } else if (allowThinking && d?.type === "thinking_delta" && typeof d.thinking === "string") {
          yield { type: "thought_delta", text: d.thinking };
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
            outputTokens: evt.usage.output_tokens ?? usage?.outputTokens ?? 0,
            cacheCreationInputTokens: evt.usage.cache_creation_input_tokens ?? usage?.cacheCreationInputTokens ?? 0,
            cacheReadInputTokens: evt.usage.cache_read_input_tokens ?? usage?.cacheReadInputTokens ?? 0,
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

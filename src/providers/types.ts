// Core provider abstraction. The agent loop talks only to this interface —
// swapping models means swapping adapters, never touching loop/tool code.

export type Role = "user" | "assistant";

export interface CacheControl {
  type: "ephemeral";
}

export interface TextContent {
  type: "text";
  text: string;
  cacheControl?: CacheControl;
}

export interface ToolCallContent {
  type: "tool_call";
  id: string;
  name: string;
  input: unknown; // raw JSON from the model; validated by the tool registry
}

export interface ToolResultContent {
  type: "tool_result";
  toolCallId: string;
  content: string;
  isError?: boolean;
  cacheControl?: CacheControl;
}

export type AssistantContent = TextContent | ToolCallContent;

// A user-role message holds prompts and tool results; an assistant-role
// message holds text and tool calls.
export interface LLMMessage {
  role: Role;
  content: (AssistantContent | ToolResultContent)[];
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
  cacheControl?: CacheControl;
}

export interface SystemPromptBlock {
  type: "text";
  text: string;
  cacheControl?: CacheControl;
}

export type StreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "thought_delta"; text: string }
  // Emitted once per call, only after its full argument JSON has arrived.
  | { type: "tool_call"; id: string; name: string; input: unknown }
  | { type: "message_delta"; stopReason: string | null; usage?: Usage }
  | { type: "error"; message: string };

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
}

export interface ModelCapabilities {
  supportsTools: boolean;
  supportsStreaming: boolean;
  supportsThinking: boolean;
  supportsStructuredOutput: boolean;
  supportsPromptCaching: boolean;
  contextWindow: number;
  maxOutputTokens: number;
  defaultTemperature?: number;
  supportsReasoningEffort?: boolean;
}

export interface ThinkingConfig {
  type: "enabled" | "disabled";
  budgetTokens?: number;
  reasoningEffort?: "low" | "medium" | "high";
}

export type ResponseFormat =
  | { type: "text" }
  | { type: "json_object" }
  | {
      type: "json_schema";
      jsonSchema: {
        name?: string;
        description?: string;
        schema: Record<string, unknown>;
        strict?: boolean;
      };
    };

export interface CompletionRequest {
  system: string | SystemPromptBlock[];
  messages: LLMMessage[];
  tools: ToolDef[];
  signal?: AbortSignal;
  model: string;
  temperature?: number;
  maxTokens?: number;
  thinking?: ThinkingConfig;
  responseFormat?: ResponseFormat;
}

export interface ProviderConfig {
  type: "anthropic" | "openai";
  baseUrl?: string;
  apiKeyEnv?: string;
  apiKey?: string; // inline key (not recommended, but supported)
  headers?: Record<string, string>;
  defaultModel?: string;
  models?: string[];
  capabilities?: Partial<ModelCapabilities>;
}

export interface LLMProvider {
  readonly name: string;
  readonly config: ProviderConfig;
  capabilities(model?: string): ModelCapabilities;
  complete(req: CompletionRequest): AsyncIterable<StreamEvent>;
}

// Shared SSE line-splitting helper for both adapters
export async function* sseDataLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      buffer += decoder.decode();
      if (buffer.trim()) {
        const lines = buffer.split("\n");
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith("data:")) {
            const payload = trimmed.slice(5).trim();
            if (payload && payload !== "[DONE]") yield payload;
          }
        }
      }
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("data:")) {
        const payload = trimmed.slice(5).trim();
        if (payload && payload !== "[DONE]") yield payload;
      }
    }
  }
}

// Core provider abstraction. The agent loop talks only to this interface —
// swapping models means swapping adapters, never touching loop/tool code.

export type Role = "user" | "assistant";

export interface TextContent {
  type: "text";
  text: string;
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
}

export type StreamEvent =
  | { type: "text_delta"; text: string }
  // Emitted once per call, only after its full argument JSON has arrived.
  | { type: "tool_call"; id: string; name: string; input: unknown }
  | { type: "message_delta"; stopReason: string | null; usage?: Usage }
  | { type: "error"; message: string };

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface CompletionRequest {
  system: string;
  messages: LLMMessage[];
  tools: ToolDef[];
  signal?: AbortSignal;
  model: string;
}

export interface ProviderConfig {
  type: "anthropic" | "openai";
  baseUrl?: string;
  apiKeyEnv?: string;
  apiKey?: string; // inline key (not recommended, but supported)
  headers?: Record<string, string>;
}

export interface LLMProvider {
  readonly name: string;
  readonly config: ProviderConfig;
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

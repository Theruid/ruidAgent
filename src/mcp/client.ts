import type { MCPServerConfig } from "../config.js";
import { StdioTransport, SSETransport, type MCPTransport } from "./transport.js";

export interface MCPToolDef {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export class MCPClient {
  private transport?: MCPTransport;
  private requestId = 1;
  private pendingRequests = new Map<number, (res: any) => void>();

  constructor(readonly serverName: string, readonly config: MCPServerConfig) {}

  async connect(): Promise<void> {
    if (this.config.disabled) return;

    if (this.config.url) {
      this.transport = new SSETransport(this.config.url);
    } else if (this.config.command) {
      this.transport = new StdioTransport(this.config.command, this.config.args ?? [], this.config.env ?? {});
    } else {
      throw new Error(`MCP Server "${this.serverName}" must specify either command or url.`);
    }

    this.transport.onMessage((msg) => {
      const id = msg.id as number;
      if (typeof id === "number" && this.pendingRequests.has(id)) {
        const resolve = this.pendingRequests.get(id);
        this.pendingRequests.delete(id);
        resolve?.(msg);
      }
    });

    // Initialize handshake with 5s timeout
    await this.request("initialize", {
      protocolVersion: "2024-11-05",
      clientInfo: { name: "ruid", version: "0.2.6" },
      capabilities: {},
    });
  }

  private request(method: string, params: Record<string, unknown> = {}): Promise<any> {
    if (!this.transport) return Promise.reject(new Error("MCP transport not connected"));

    const id = this.requestId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`MCP request "${method}" timed out after 5000ms`));
      }, 5000);

      this.pendingRequests.set(id, (res) => {
        clearTimeout(timer);
        if (res.error) reject(new Error(res.error.message || "MCP RPC error"));
        else resolve(res.result);
      });

      this.transport!.send({ jsonrpc: "2.0", id, method, params }).catch(reject);
    });
  }

  async listTools(): Promise<MCPToolDef[]> {
    try {
      const res = await this.request("tools/list");
      return Array.isArray(res?.tools) ? res.tools : [];
    } catch {
      return [];
    }
  }

  async callTool(name: string, args: unknown): Promise<{ content: string; isError: boolean }> {
    try {
      const res = await this.request("tools/call", { name, arguments: args });
      if (res?.isError) {
        return { content: JSON.stringify(res.content ?? "Tool error"), isError: true };
      }
      const texts = Array.isArray(res?.content)
        ? res.content.map((c: any) => c.text || JSON.stringify(c)).join("\n")
        : JSON.stringify(res?.content ?? "(empty response)");
      return { content: texts, isError: false };
    } catch (e) {
      return { content: `MCP Tool Call Failed: ${e instanceof Error ? e.message : String(e)}`, isError: true };
    }
  }

  async close(): Promise<void> {
    await this.transport?.close();
  }
}

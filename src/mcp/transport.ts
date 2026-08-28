import { spawn, type ChildProcess } from "node:child_process";

export interface MCPTransport {
  send(message: Record<string, unknown>): Promise<void>;
  onMessage(handler: (message: Record<string, unknown>) => void): void;
  close(): Promise<void>;
}

export class StdioTransport implements MCPTransport {
  private child: ChildProcess;
  private messageHandler?: (message: Record<string, unknown>) => void;
  private buffer = "";

  constructor(command: string, args: string[] = [], env: Record<string, string> = {}) {
    const isWin = process.platform === "win32";
    let cmd = command;
    if (isWin && (cmd === "npx" || cmd === "npm")) {
      cmd = `${cmd}.cmd`;
    }

    this.child = spawn(cmd, args, {
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
      shell: isWin,
    });

    this.child.on("error", () => {
      // Prevent unhandled error crashes if binary is missing or fails to launch
    });

    this.child.stdout?.on("data", (data: Buffer) => {
      this.buffer += data.toString("utf8");
      const lines = this.buffer.split("\n");
      this.buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const json = JSON.parse(trimmed);
          this.messageHandler?.(json);
        } catch {}
      }
    });
  }

  async send(message: Record<string, unknown>): Promise<void> {
    const payload = JSON.stringify(message) + "\n";
    this.child.stdin?.write(payload);
  }

  onMessage(handler: (message: Record<string, unknown>) => void): void {
    this.messageHandler = handler;
  }

  async close(): Promise<void> {
    this.child.kill("SIGTERM");
  }
}

export class SSETransport implements MCPTransport {
  private messageHandler?: (message: Record<string, unknown>) => void;
  private abortController = new AbortController();

  constructor(private url: string) {
    this.initStream();
  }

  private async initStream() {
    try {
      const res = await fetch(this.url, {
        headers: { Accept: "text/event-stream" },
        signal: this.abortController.signal,
      });

      if (!res.body) return;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith("data:")) {
            try {
              const data = JSON.parse(trimmed.slice(5).trim());
              this.messageHandler?.(data);
            } catch {}
          }
        }
      }
    } catch {}
  }

  async send(message: Record<string, unknown>): Promise<void> {
    await fetch(this.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
      signal: this.abortController.signal,
    });
  }

  onMessage(handler: (message: Record<string, unknown>) => void): void {
    this.messageHandler = handler;
  }

  async close(): Promise<void> {
    this.abortController.abort();
  }
}

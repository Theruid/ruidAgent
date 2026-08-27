# ruid (`@theruid/ruid`)

A fast, standalone CLI coding agent that works with any LLM provider — Anthropic, OpenAI, DeepSeek, Groq, OpenRouter, Ollama, LM Studio, or any OpenAI-compatible endpoint.

## Installation

```bash
npm install -g @theruid/ruid
```

## Quick Start

```bash
ruid
```

On first launch, run `/setup` to connect your API key or local model endpoint.

## Usage

Launch the interactive coding environment:

```bash
ruid
```

Configure providers, API keys, or endpoints at any time using the setup wizard:

```bash
ruid setup
```

---

## Operating Modes

Switch modes at any time by pressing **`Tab`** in the prompt or typing `/mode <mode>`:

- **`[CODE]` Mode** (Default): Standard safe mode. Read-only tools are auto-approved; mutating tools (`write_file`, `edit_file`, `bash`) require human confirmation (`y`/`n`/`a`).
- **`[PLAN]` Mode**: Read-only architecture mode. Mutating file tools are disallowed; the agent explores code and uses task tracking to build step-by-step plans.
- **`[AUTO]` Mode**: Autonomous execution. All tools are pre-approved without prompts for fast iteration.

---

## Keyboard Shortcuts & Commands

| Shortcut / Command | Action |
|---|---|
| `Tab` (in prompt) | Cycle operating mode (`[CODE]` → `[PLAN]` → `[AUTO]`) |
| `Ctrl+Enter` | Insert newline for multi-line prompts |
| `@<filename>` | File picker autocomplete & auto-attach file content |
| `PageUp` / `PageDown` | Scroll chat transcript |
| `Ctrl+C` | Interrupt running turn (press twice to exit) |
| `/tasks` or `/plan` | View currently active plan and tasks |
| `/mcp` | List connected Model Context Protocol (MCP) servers & tools |
| `/rollback [turn]` | Revert file modifications back to pre-turn state |
| `/new` | Start a new chat session |
| `/resume` or `/sessions` | Open session picker to resume conversations |
| `/setup` | Provider setup wizard |
| `/providers` | List configured providers and connection state |
| `/connect <name>` | Switch active provider |
| `/model <id>` | Switch model (no argument = show current) |
| `/clear` | Clear conversation history |
| `/exit`, `/quit` | Save and exit |
| `/help` | List commands |

---

## Model Context Protocol (MCP)

Add external MCP tools directly in `~/.ruid/config.json`:

```json
{
  "mcpServers": {
    "memory": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-memory"]
    },
    "context7": {
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp"]
    }
  }
}
```

Run `/mcp` in the terminal to inspect active servers and tools.

---

## License

Apache-2.0

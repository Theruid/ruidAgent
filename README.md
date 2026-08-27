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

### Interactive TUI Mode

```bash
ruid
```

### One-Shot Mode (Non-interactive)

```bash
ruid -p "explain what this repository does"
ruid -p "fix the failing test in src/utils.ts" --provider deepseek --model deepseek-chat
ruid -p "list open issues" --provider ollama --model llama3.2
```

### CLI Options

```
ruid                       Interactive terminal UI
ruid -p "<prompt>"         One-shot command execution
ruid setup                 Interactive provider setup wizard

Options:
  -p, --prompt <text>      Run a single prompt and exit
      --provider <name>    Provider name from config
      --model <id>         Model ID override
      --base-url <url>     Custom OpenAI-compatible endpoint URL
      --api-key <key>      API key for custom endpoint
      --list-models        Query endpoint /models and list model IDs
  -h, --help               Show help
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

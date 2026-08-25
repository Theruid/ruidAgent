# CodingAgent

A standalone CLI coding agent that works with **any LLM provider** — Anthropic, OpenAI, DeepSeek, Groq, OpenRouter, Ollama, LM Studio, or any OpenAI-compatible endpoint. Written in TypeScript with zero framework lock-in: the agent core is a pure library you can embed in a VS Code extension or editor fork.

## Features

- **Any provider** — one `LLMProvider` interface; adapters normalize both Anthropic's native Messages API and every OpenAI-compatible endpoint to it.
- **Fullscreen terminal UI** — Ink/React TUI with streaming output, markdown rendering, syntax highlighting, scrollback (PageUp/PageDown), live cost tracking, and an inline permission prompt.
- **Agentic loop** — stream → tool calls → validated results → repeat, up to 40 iterations per turn by default.
- **Sandboxed tools** — all file access is confined to the workspace root; mutating tools require confirmation (`y` / `n` / `a` = always allow this session).
- **Session persistence** — conversations autosave after each turn and can be resumed from a picker.
- **Bring-your-own endpoint** — point at any base URL + key via CLI flags without touching config.

## Requirements

- Node.js >= 20

## Setup

```bash
npm install
npm run build
```

No first-time setup step is required — on a fresh install the REPL starts in setup mode and tells you to run `/setup`. The wizard adds an endpoint, key, and model (fetched live from the endpoint) and connects immediately without a restart.

Providers live in `~/.codingagent/config.json` (created on demand; sensible defaults included). API keys are read from the env var named by `apiKeyEnv` — local servers (Ollama on `localhost:11434`, LM Studio on `localhost:1234`) need no key:

```json
{
  "providers": {
    "anthropic": { "type": "anthropic", "apiKeyEnv": "ANTHROPIC_API_KEY" },
    "deepseek":  { "type": "openai", "baseUrl": "https://api.deepseek.com", "apiKeyEnv": "DEEPSEEK_API_KEY" },
    "ollama":    { "type": "openai", "baseUrl": "http://localhost:11434/v1" }
  },
  "default": { "provider": "anthropic", "model": "claude-sonnet-5" }
}
```

You can also run the wizard before launching:

```bash
node dist/index.js setup
```

## Usage

```bash
npm run dev                  # run from source via tsx
node dist/index.js           # interactive TUI
node dist/index.js -p "..."  # one-shot mode (prints answer, exits)
```

### CLI options

```
codingagent                 Interactive TUI
codingagent -p "<prompt>"   One-shot mode (non-interactive)
codingagent setup           Interactive provider setup wizard

-p, --prompt <text>     Run a single prompt and exit
    --provider <name>   Provider name from config
    --model <id>        Model ID override for this run
    --base-url <url>    Bring-your-own OpenAI-compatible endpoint
                        (e.g. https://api.deepseek.com or http://localhost:11434/v1)
    --api-key <key>     API key for the endpoint (prefer env vars over inline keys)
    --list-models       Query the endpoint's /models and print available model IDs
-h, --help              Show this help
```

Examples:

```bash
node dist/index.js --list-models --base-url https://api.deepseek.com --api-key sk-...
node dist/index.js -p "explain what this repo does"
node dist/index.js -p "fix the failing test" --provider deepseek --model deepseek-chat
node dist/index.js --provider ollama --model llama3.2
```

One-shot mode requires a TTY-free environment only for `-p`; interactive mode needs a real terminal (or set `CODINGAGENT_FORCE_TUI=1` to override, used by tests).

### TUI commands

| Command | Action |
|---|---|
| `/new` | Start a new chat (autosaves the current one) |
| `/resume` or `/sessions` | Open the session picker |
| `/setup` | Provider setup wizard (connects immediately) |
| `/providers` | List configured providers and connection state |
| `/connect <name>` | Switch provider mid-session |
| `/model <id>` | Switch model (no argument = show current) |
| `/clear` | Clear history without saving |
| `/exit`, `/quit` | Save and exit |
| `/help` | List commands |

Keyboard: PageUp/PageDown scroll, Ctrl+arrows fine-scroll, Ctrl+C aborts the running turn (twice quickly exits).

## Tools & permissions

| Tool | Purpose | Permission |
|---|---|---|
| `read_file` | Read a text file (line numbers, 512 KB cap, binary sniffing) | auto-approved |
| `list_dir` | Directory listing | auto-approved |
| `glob` | Filename pattern search | auto-approved |
| `grep` | Regex content search | auto-approved |
| `write_file` | Create/overwrite a file | prompts |
| `edit_file` | Exact-match string replace | prompts |
| `bash` | Shell command in workspace root (2 min default timeout, 200 KB output cap) | prompts |

When prompted: `y` approves once, `n` denies (the model is told not to retry), `a` whitelists the tool for the rest of the session.

All file paths resolve inside the workspace root (the directory you launched from) — escapes are rejected. Bash runs through `cmd.exe /c` on Windows, `/bin/sh -c` elsewhere, with color forced off.

Per-session defaults can be tuned in config:

```json
{
  "permissions": { "autoApprove": ["grep"], "alwaysAsk": [] },
  "maxIterations": 40
}
```

## Project structure

```
src/
├── index.ts              CLI entry: arg parsing, provider resolution, mode dispatch
├── config.ts             ~/.codingagent/config.json loading, defaults, usability checks
├── configWizard.ts       Setup-wizard backend: read/save config, fetch model lists
├── permissions.ts        Deferred permission manager (promise parked until keypress)
├── sessions.ts           Session save/load/list/delete under ~/.codingagent/sessions/
├── providers/
│   ├── types.ts          LLMProvider interface, message/stream types, SSE line splitter
│   ├── anthropic.ts      Native Anthropic Messages API adapter (SSE streaming)
│   └── openai.ts         OpenAI-compatible chat-completions adapter + /models listing
├── agent/
│   ├── loop.ts           Agentic loop: stream → tool calls → dispatch → repeat
│   └── systemPrompt.ts   System prompt builder (workspace path, platform, guidelines)
├── tools/
│   ├── registry.ts       Tool registry: zod validation, dispatch, permission flags
│   ├── fs.ts             Workspace sandbox + read/write/edit/list/glob tools
│   ├── search.ts         grep tool (regex content search)
│   └── bash.ts           Shell execution tool
└── ui/
    ├── controller.tsx    TUI orchestrator: wires loop events into the store,
    │                     slash commands, session autosave/resume
    ├── App.tsx           Root component + global key routing
    ├── store.ts          Framework-free observable store (useSyncExternalStore)
    ├── components/
    │   ├── MessageList.tsx      Chat transcript with tool badges
    │   ├── InputBox.tsx         Text input
    │   ├── StatusBar.tsx        Connection, model, token usage, cost
    │   ├── PermissionPrompt.tsx Inline y/n/a confirmation
    │   ├── SessionPicker.tsx    Resume-session list
    │   ├── SetupWizard.tsx      Provider setup flow
    │   ├── Welcome.tsx          Landing screen
    │   └── CommandPalette.tsx   Command palette
    └── utils/
        ├── markdown.ts     Markdown → terminal rendering
        ├── syntax.ts       Syntax highlighting
        ├── diff.ts         Diff helpers
        ├── pricing.ts      Token cost calculation per model
        ├── toolSummary.ts  Compact tool-call badges
        └── wrap.ts         Text wrapping to terminal width
```

### Design notes

**Provider abstraction** — [types.ts](src/providers/types.ts) defines a single `LLMProvider` interface (`complete()` returning an async iterable of `StreamEvent`s). Both wire adapters normalize to it (tool calls arrive as complete validated events), so the agent loop never knows which model is running. Adding a provider = one new adapter file + a config entry.

**Agent loop** — [loop.ts](src/agent/loop.ts) accumulates streamed content blocks and pushes them back into history verbatim, so multi-turn conversations replay exactly what was shown. Tool inputs arrive as raw JSON and are zod-validated at dispatch time; failures return as error tool-results the model can react to. Empty responses get a nudge instead of spinning; hitting max iterations injects a wrap-up instruction.

**Permissions** — [permissions.ts](src/permissions.ts) parks a promise per pending request; the TUI resolves it from a keypress. This keeps the async loop untouched — `check()` simply awaits human input.

**UI store** — [store.ts](src/ui/store.ts) is a plain observable class, so non-React code (loop callbacks) pushes events without prop drilling or stale closures. React subscribes via `useSyncExternalStore`.

**Workspace sandbox** — [fs.ts](src/tools/fs.ts) normalizes mixed separators (Windows quirk) and rejects any resolved path outside the root, so absolute paths and `../` traversal can't wander the filesystem.

## Data locations

| Path | Contents |
|---|---|
| `~/.codingagent/config.json` | Providers, default model, permission overrides, maxIterations |
| `~/.codingagent/sessions/*.json` | Autosaved conversations (one JSON file per session) |

## Development

```bash
npm run dev            # run from source via tsx
npm run typecheck      # tsc --noEmit
npm run build          # emit dist/
npm start              # node dist/index.js
```

Test scripts spin up mock HTTP servers and run offline against `dist/` (build first):

```bash
node scripts/test-workspace.mjs           # path-sandbox escape attempts
node scripts/test-loop-e2e.mjs            # full agentic cycle with a scripted mock model, no API key
node scripts/test-setup.mjs               # setup wizard flow against a mock endpoint
node scripts/test-custom-endpoint.mjs     # --base-url/--api-key + /models listing
node scripts/test-anthropic-adapter.mjs   # Anthropic SSE parsing
```

### Adding a new tool

1. Create the tool object in `src/tools/` (name, description, JSON Schema `parameters`, zod `schema`, async `execute`).
2. Register it in `buildRegistry()` ([registry.ts](src/tools/registry.ts)) with the right `requiresPermission` flag.
3. Add it to the auto-approve set in [loop.ts:42](src/agent/loop.ts) if it's read-only.

## License

Apache-2.0 — permissive with patent grant, safe for future commercial use.

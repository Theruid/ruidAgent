# CodingAgent

A standalone CLI coding agent that works with **any LLM provider** — Anthropic, OpenAI, DeepSeek, Groq, OpenRouter, Ollama, LM Studio, or any OpenAI-compatible endpoint. Written in TypeScript with zero framework lock-in: the agent core is a pure library you can later embed in a VS Code extension or editor fork.

## Setup

Requires Node.js >= 20.

```bash
npm install
npm run build
```

Configure providers in `~/.codingagent/config.json` (optional — sensible defaults included):

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

API keys are read from the env var named by `apiKeyEnv`. Local servers (Ollama on `localhost:11434`, LM Studio on `localhost:1234`) need no key.

## Usage

Just run it — no first-time setup step required. On a fresh install the REPL starts in setup mode and tells you to run `/setup`:

```bash
npm run dev        # interactive REPL (or node dist/index.js after building)
```

Then inside the REPL, `/setup` walks you through adding an endpoint, key, and model (fetched live from the endpoint). It connects immediately — no restart needed. You can also run `codingagent setup` before starting, if you prefer.

Useful REPL commands: `/setup`, `/providers` (list config), `/connect <name>` (switch provider), `/model <id>`, `/clear`, `/save`, `/load`, `/exit`.

Bring-your-own endpoint without touching config:

```bash
node dist/index.js --list-models --base-url https://api.deepseek.com --api-key sk-...
node dist/index.js -p "explain this repo" --base-url http://localhost:11434/v1 --model qwen2.5-coder:7b
```

One-shot mode:

```bash
node dist/index.js -p "explain what this repo does"
node dist/index.js --provider deepseek --model deepseek-chat -p "fix the failing test"
```

Interactive mode:

```bash
node dist/index.js
node dist/index.js --provider ollama --model llama3.2
```

REPL commands: `/clear` (reset history), `/model <id>` (switch model), `/save`, `/load`, `/exit`.

## Setup

The wizard is available two ways: in-session via `/setup` (recommended — connects right away), or before launching:

```bash
node dist/index.js setup
```

It adds OpenAI-compatible providers (base URL + API key), fetches the model list from the endpoint so you pick from real IDs, and sets the default provider/model. Everything is stored in `~/.codingagent/config.json`.


## Tools

The agent can: `read_file`, `write_file`, `edit_file` (exact-match replace), `list_dir`, `glob`, `grep` (regex content search), and `bash`. Read-only tools run without prompting; writes and shell commands ask for permission first (`y` / `n` / `a` = always allow this session). All file paths are confined to the workspace root.

## Architecture

```
src/
├── index.ts          CLI entry
├── config.ts         ~/.codingagent/config.json loading
├── providers/        LLM adapters (anthropic.ts, openai.ts) behind one interface
├── agent/
│   ├── loop.ts       Agentic loop: stream → tool calls → results → repeat
│   └── systemPrompt.ts
├── tools/            Tool implementations + zod-validated registry
├── permissions.ts    Interactive confirmation policy
└── ui/               REPL + streaming terminal renderer
```

Key design point: `src/providers/types.ts` defines a single `LLMProvider` interface. Both wire adapters normalize to it (tool calls arrive as complete validated events), so the agent loop never knows which model is running. Adding a provider = one new adapter file + a config entry.

## Development

```bash
npm run dev -- -p "smoke test prompt"   # run from source via tsx
npm run typecheck                       # tsc --noEmit
npm run build                           # emit dist/

scripts/                                # offline tests (mock HTTP servers)
node scripts/test-setup.mjs             # setup UI flow against a mock endpoint
node scripts/test-custom-endpoint.mjs   # --base-url/--api-key + /models listing
node scripts/test-loop-e2e.mjs          # full agentic cycle, no API key needed
node scripts/test-anthropic-adapter.mjs
node scripts/test-workspace.mjs
```

## License

Apache-2.0 — permissive with patent grant, safe for future commercial use.

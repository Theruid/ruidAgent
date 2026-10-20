# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- **Build**: `npm run build` (runs `tsc`, outputs to `dist/`)
- **Typecheck**: `npm run typecheck` (`tsc --noEmit`)
- **Run all tests**: `npm test` (executes `scripts/test-runner.js` via `tsx --test`)
- **Run a single test file**: `npx tsx --test <path-to-test-file>` (e.g., `npx tsx --test src/permissions.test.ts`)
- **Run smoke audit**: `npm run audit:smoke` (runs `scripts/audit-smoke.ts`)
- **Run interactive dev CLI**: `npm run dev` (`tsx src/index.ts`)
- **Run headless prompt**: `npx tsx src/index.ts -p "<prompt>" [--json] [--model <model>] [--max-turns <N>]`

## Architecture Overview

`ruid` (`@theruid/ruid`) is a standalone CLI coding agent written in TypeScript (ES Modules, NodeNext) using React/Ink for the terminal UI and supporting multiple LLM backends (Anthropic, OpenAI, DeepSeek, Groq, Ollama, OpenRouter).

### Core Subsystems

- **Entry Point & CLI Routing (`src/index.ts`)**: Handles CLI arguments (`-p`/`--print` for headless execution, `setup` for interactive config wizard, `-v`/`--version`), initializes providers and permission managers, and launches either headless agent loop or interactive Ink TUI.
- **Agent Loop (`src/agent/loop.ts`)**: Central multi-turn loop (`runAgentLoop`). Orchestrates prompt assembly, LLM completion streaming, tool execution, turn checkpoints, permission checks, and loop events.
  - **Context Management (`src/agent/context.ts`)**: Token estimation, two-phase history compaction (micro-compacting older tool results and semantic LLM summarization).
  - **Structured System Prompts (`src/agent/systemPrompt.ts`)**: Builds hierarchical XML prompt blocks (`<system>`, `<environment>`, `<mode_guidelines>`, `<custom_instructions>`, `<repo_map>`, `<memory>`, `<skills>`) with ephemeral prompt caching control.
  - **Subagents & Orchestration (`src/agent/subagent.ts`, `src/agent/orchestration.ts`)**: Subagent primitives (`coder`, `planner`, `reviewer`), sequential pipelines (`pipeline`), concurrent batches (`parallel`), evaluator-optimizer loops, and DAG task workflows.
  - **Worktree Isolation (`src/agent/worktree.ts`)**: Creates temporary isolated Git worktrees for concurrent subagent file modifications.
  - **Stale State Recovery (`src/agent/staleState.ts`)**: Classifies tool execution failures (`stale_state`, `transient`, `fatal`) to enable automatic re-reading and retries.
  - **Repository Map (`src/agent/repomap.ts`)**: Symbol extractor for TypeScript/JavaScript/Python workspaces.
- **Provider Layer (`src/providers/`)**:
  - `types.ts`: Normalized message (`LLMMessage`), content (`AssistantContent`, `ToolResultContent`), and stream event interfaces.
  - `anthropic.ts`: Anthropic API adapter with SSE stream parsing, thinking token deltas, and cache control breakpoints.
  - `openai.ts`: OpenAI and OpenAI-compatible endpoint adapter with streaming and function/tool call formatting.
  - `capabilities.ts`: Detects model features (tools, reasoning effort, prompt caching, context window, output token limits).
  - `retry.ts`: Exponential backoff for rate limits and transient HTTP 5xx errors.
- **Permissions & Safety (`src/permissions.ts`)**:
  - Risk tier classification: Tier 0 (read-only), Tier 1 (workspace file mutation), Tier 2 (safe bash), Tier 3 (mutating/chained bash, MCP tools), Tier 4 (destructive commands, sensitive paths like `.env`, private keys).
  - Operating modes: `code` (prompts for mutations), `plan` (read-only, blocks file mutations), `auto` (autonomous execution with Tier 4 containment).
  - Secret redaction (`redactSecrets`) prevents credentials from leaking into session records or audit logs.
- **Tools System (`src/tools/`)**:
  - `registry.ts`: Tool registry building and Zod-schema validation/dispatch.
  - `fs.ts`: Safe workspace path resolution, file reading, writing, multi-patch editing with CRLF/LF match ladder, directory listing, and glob search.
  - `search.ts`: High-speed ripgrep searching via vendored `@vscode/ripgrep` binary with pure JS directory walker fallback.
  - `bash.ts`: Foreground shell execution and background `ProcessManager` (background daemons, output ring buffers, and prompt hang detection).
  - `git.ts`, `gitRollback.ts`, `snapshot.ts`: Git status/diff/log inspection, Git turn checkpoints, and disk-persisted turn snapshots for `/rollback`.
  - `tasks.ts`: Live session task store (`task_create`, `task_update`, `task_delete`, `task_list`).
  - `web.ts`: Safe zero-config search (`web_search`) and HTML-to-Markdown scraper (`web_fetch`).
  - `memory.ts`, `skill.ts`: Persistent memory and skill execution tool wrappers.
- **Configuration & Integrations**:
  - `src/config.ts`: Loads and merges `~/.ruid/config.json` (or `RUID_CONFIG_DIR`) with provider configs, defaults, MCP servers, and hooks.
  - `src/hooks.ts`: Pre-tool and post-tool lifecycle execution hooks (passes event JSON on `stdin`, env vars, exit code 2 rejection protocol).
  - `src/mcp/`: Model Context Protocol client supporting Stdio and SSE transports.
  - `src/memory/`: Workspace (`.ruid/memory/`) and global (`~/.ruid/memory/`) persistent memory with `MEMORY.md` indexing.
  - `src/skills/`: Markdown/YAML frontmatter skill loader (`.ruid/skills/` and global skills).
  - `src/sessions.ts`: Session serialization, v1-to-v2 migrations, and transcript search.
  - `src/audit/log.ts`: Append-only tamper-evident execution audit logging in `.ruid/audit.jsonl`.
- **Terminal UI (`src/ui/`)**:
  - Built with `ink` (React for CLI).
  - `store.ts`: Reactive state store for chat messages, streaming deltas, active tool states, mode toggles, task lists, and token pricing/usage telemetry.
  - `controller.tsx`: Connects keyboard events, terminal window resize listeners, and store actions to `runAgentLoop`.

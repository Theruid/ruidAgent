# ruid (`@theruid/ruid`) Roadmap & Architecture

This document tracks the current development status, completed milestones, and upcoming capabilities for `ruid`.

---

## 1. Status Overview

```
                                MILESTONE STATUS
 ┌───────────────────────────────────────────────────────────────────┬────────────┐
 │ Phase 1: Robustness, Context Management & Provider Resilience     │  COMPLETE  │
 ├───────────────────────────────────────────────────────────────────┼────────────┤
 │ Phase 2: Native Tooling, Git & Task Management                    │  COMPLETE  │
 ├───────────────────────────────────────────────────────────────────┼────────────┤
 │ Phase 3: Developer Experience, Modes, Rollback & Autocomplete     │  COMPLETE  │
 ├───────────────────────────────────────────────────────────────────┼────────────┤
 │ Phase 4.1: Sub-Agent Swarm Delegation Engine (Parallel Execution) │  COMPLETE  │
 ├───────────────────────────────────────────────────────────────────┼────────────┤
 │ Self-Update: In-place NPM Registry Auto-Updater & Semver Engine   │  COMPLETE  │
 ├───────────────────────────────────────────────────────────────────┼────────────┤
 │ Phase 4.2: Model Context Protocol (MCP) Client                    │  UPCOMING  │
 ├───────────────────────────────────────────────────────────────────┼────────────┤
 │ Phase 5: Web Search & External Docs Lookup                        │  UPCOMING  │
 └───────────────────────────────────────────────────────────────────┴────────────┘
```

---

## 2. Completed Milestones

### Phase 1: Robustness & Context Management
- [x] **Zero-Dependency Glob Engine**: Node >= 20 compatible recursive file walker with regex matching (no Node 22 `globSync` lock-in).
- [x] **Provider Resilience & Retries**: `fetchWithRetry` with exponential backoff and jitter for transient errors (`429`, `500`, `502`, `503`, `529`).
- [x] **Context Window Pruning**: Automated token estimation and large tool result compaction to keep multi-turn conversations inside context bounds.

### Phase 2: Tooling & Coding Capabilities
- [x] **Project Rules Auto-Loader**: Detects and injects `AGENT.md`, `CLAUDE.md`, `.agentrules`, `RUID.md` into the system prompt.
- [x] **Native Git Tools**: `git_status`, `git_diff`, `git_log` with automatic output caps (100KB).
- [x] **Task & Checklist Engine**: `task_create`, `task_update`, `task_list` tracking step-by-step progress.

### Phase 3: Developer Experience & TUI Enhancements
- [x] **Operating Modes**: `[CODE]` (safe default with permissions), `[PLAN]` (read-only architecture), `[AUTO]` (autonomous bypass).
- [x] **Tab Key Mode Cycling**: Press `Tab` in the empty prompt to switch modes on the fly.
- [x] **Live TaskPanel UI**: Dynamic checklist rendering real-time states (`✓`, `⠋`, `○`).
- [x] **Multi-line Input**: `Ctrl+Enter`, `Alt+Enter`, `Shift+Enter`, and trailing `\` for multi-line drafting.
- [x] **`@` File Mention & Fuzzy Search**: Workspace file indexing popup that auto-attaches file contents into the prompt.
- [x] **Turn Snapshots & `/rollback`**: File mutation checkpoints allowing instant rollback and prompt restoration without Git dependency.

### Phase 4.1: Sub-Agent Swarm Engine
- [x] **`subagent_spawn` Tool**: Orchestrator spawns isolated worker agents for research, coding, or adversarial reviews.
- [x] **Context Isolation**: Child tool executions stay in the worker sandbox and never bloat parent tokens.
- [x] **Parallel Execution**: Multiple sub-agents run concurrently via `Promise.all` with deadlock-safe sequential permission resolution.
- [x] **Ctrl+C Abort Propagation**: `AbortSignal` forwarded through sub-agent loops for clean cancellation without UI hangs.
- [x] **Reasoning Stream Separation**: `reasoning_content` isolated from the final answer stream for clean first-person responses.

### Self-Update Engine
- [x] **NPM Registry Checker**: Fast 2-second semver check on startup.
- [x] **Interactive UpdatePrompt**: One-click in-place `npm install -g @theruid/ruid@latest` with restart notifications.

---

## 3. What's Left to Implement

### Next Immediate Priority: Phase 4.2 — Model Context Protocol (MCP) Client
- [ ] **Config-Driven MCP Servers**:
  - Support `~/.ruid/config.json` or `.ruid/mcp.json` defining external MCP server connections:
    ```json
    {
      "mcpServers": {
        "postgres": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-postgres", "postgresql://localhost/db"] },
        "github": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"] }
      }
    }
    ```
- [ ] **Stdio JSON-RPC 2.0 Client**:
  - Spawn server processes, perform handshake (`initialize`), list tools (`tools/list`), and dynamically mount them into `buildRegistry()`.
- [ ] **MCP Tool Dispatch & Permissions**:
  - Route tool calls through `tools/call`, honoring active `CODE`/`PLAN`/`AUTO` permission policies.

---

### Future Enhancements: Phase 5 & Beyond
- [ ] **Web Search & Documentation Lookup**:
  - Built-in safe web search tool (Brave Search / DuckDuckGo / Tavily) for querying current library documentation.
- [ ] **Custom Provider Presets**:
  - Add quick setup presets in `/setup` for GitHub Models, OpenRouter, Together AI, and vLLM.
- [ ] **Session Search & History Filter**:
  - Full-text search across past session transcripts in `/resume`.

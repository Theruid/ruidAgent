# ruid (`@theruid/ruid`) Roadmap & Architecture

This document tracks the current development status, completed milestones, and upcoming capabilities for `ruid`.

---

## 1. Status Overview

```
                                MILESTONE STATUS
 ┌───────────────────────────────────────────────────────────────────┬────────────┐
 │ Phase 0: Tamper-Evident Audit Logging & Session Schema Versioning │  COMPLETE  │
 ├───────────────────────────────────────────────────────────────────┼────────────┤
 │ Phase 1: Structured Context XML & Ephemeral Prompt Caching        │  COMPLETE  │
 ├───────────────────────────────────────────────────────────────────┼────────────┤
 │ Phase 2: Native Ripgrep Integration & Fallback Search Engine      │  COMPLETE  │
 ├───────────────────────────────────────────────────────────────────┼────────────┤
 │ Phase 3: Granular Safety Tiers, Path Boundaries & Permissions     │  COMPLETE  │
 ├───────────────────────────────────────────────────────────────────┼────────────┤
 │ Phase 4: Sub-Agent Swarm, Schema Enforcement & Worktree Isolation │  COMPLETE  │
 ├───────────────────────────────────────────────────────────────────┼────────────┤
 │ Phase 5: Streaming Shell Runner & Background Process Manager      │  COMPLETE  │
 ├───────────────────────────────────────────────────────────────────┼────────────┤
 │ Phase 6: Two-Phase History Compaction & Semantic Summarization    │  COMPLETE  │
 ├───────────────────────────────────────────────────────────────────┼────────────┤
 │ Phase 7: Model Context Protocol (MCP) Client (Stdio & SSE)        │  COMPLETE  │
 ├───────────────────────────────────────────────────────────────────┼────────────┤
 │ Phase 8: Comprehensive Automated Test Suite (35+ Unit/Int Tests)  │  COMPLETE  │
 ├───────────────────────────────────────────────────────────────────┼────────────┤
 │ Phase 9: Web Search & External Docs Lookup                        │  COMPLETE  │
 ├───────────────────────────────────────────────────────────────────┼────────────┤
 │ Phase 10: Full-Text Session Search & Live Transcript Filtering    │  COMPLETE  │
 ├───────────────────────────────────────────────────────────────────┼────────────┤
 │ Phase 11: Interactive Terminal Process Management & Hang Control  │  COMPLETE  │
 ├───────────────────────────────────────────────────────────────────┼────────────┤
 │ Phase 12: AST-Aware Code Graph & Semantic Symbol Indexing         │  UPCOMING  │
 └───────────────────────────────────────────────────────────────────┴────────────┘
```

---

## 2. Completed Milestones

### Modern Architecture & Core Subsystems (v0.3.x)
- [x] **Tamper-Evident Audit Logging**: Append-only execution records in `.ruid/audit.jsonl` tracking tool sources, risk tiers, and execution latency.
- [x] **Session Schema Versioning & Migrations**: Schema v2 with backwards-compatible legacy session upgrader.
- [x] **Structured Context Layering**: Structured XML prompt hierarchy (`<system>`, `<environment>`, `<mode_guidelines>`, `<custom_instructions>`).
- [x] **Ephemeral Prompt Caching**: Client-side breakpoints for Anthropic and automatic server-side prefix caching for OpenAI/compatible providers with live StatusBar telemetry.
- [x] **Native Ripgrep Integration**: High-speed symbol and regex search powered by vendored `@vscode/ripgrep` binary with pure JS walker fallback.
- [x] **Granular Safety Risk Tiers (0-4)**: Comprehensive permission manager classifying commands, path containment, and sensitive file protections (`.env`, private keys).
- [x] **Sub-Agent Swarm & Orchestration**: Typed schema-enforced subagents, sequential `pipeline()` chains, concurrent `parallel()` sweeps, and Git worktree isolation.
- [x] **Process Manager & Streaming Shell**: Live foreground output streaming alongside detached background daemons (`process_status`, `process_logs`, `process_kill`).
- [x] **Two-Phase History Compaction**: Breakpoint-aligned micro-compaction (tool result truncation) and semantic LLM summarization.
- [x] **Model Context Protocol (MCP) Client**: Full JSON-RPC 2.0 client supporting stdio and SSE transports with default untrusted security boundaries.
- [x] **Web Search & Live Documentation Fetcher**: Built-in zero-config `web_search` and HTML-to-Markdown `web_fetch` documentation scraper.
- [x] **Interactive Terminal Hang Detection & Process Guard**: Non-interactive headless environment injection (Node/npm, Git, Pip, Python, Apt), rolling buffer prompt hang detector, 400ms quiet confirmation, and cross-platform process tree termination.
- [x] **Comprehensive Automated Test Suite**: 11 test suites covering all core modules with 45+ passing tests.

### Developer Experience & TUI
- [x] **Operating Modes**: `[CODE]` (safe default), `[PLAN]` (read-only architecture), `[AUTO]` (autonomous bypass) with `Tab` cycling.
- [x] **Live TaskPanel UI**: Dynamic checklist rendering real-time states (`✓`, `⠋`, `○`).
- [x] **Multi-line Input**: `Ctrl+Enter`, `Alt+Enter`, `Shift+Enter`, and trailing `\` for multi-line drafting.
- [x] **`@` File Mention & Fuzzy Search**: Workspace file indexing popup that auto-attaches file contents into the prompt.
- [x] **Turn Snapshots & `/rollback`**: File mutation checkpoints allowing instant rollback without Git dependency.
- [x] **Full-Text Session Search & Transcript Indexing**: Live interactive substring & entity search across all previous conversations in `/resume`.
- [x] **Self-Update Engine**: Fast semver check and one-click in-place `npm install -g @theruid/ruid@latest`.

---

## 3. What's Left to Implement

### Next Immediate Priority: Phase 12 — AST-Aware Code Graph & Semantic Symbol Indexing
- [ ] **AST-Aware Code Graph**:
  - Tree-sitter powered semantic code search, definition jumps, and cross-file reference mapping.

---

### Future Enhancements
- [ ] **Custom Provider Presets**:
  - Add quick setup presets in `/setup` for GitHub Models, OpenRouter, Together AI, and vLLM.

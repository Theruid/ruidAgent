# CodingAgent Roadmap & Architecture

This document outlines the current state of CodingAgent, key architectural decisions, and the phased development roadmap.

---

## 1. Implemented Features & Architecture

### Core Agent Engine
- **Agent Loop (`src/agent/loop.ts`)**:
  - Full multi-turn loop supporting streaming text deltas, tool calls, tool results, and usage tracking.
  - Turn iteration cap protection (defaults to 40 max iterations) with automated wrap-up prompts.
  - Empty response detection with auto-nudge recovery.
  - Conversation history accumulation with message serialization.
- **System Prompt (`src/agent/systemPrompt.ts`)**:
  - Contextual workspace path, host platform (`win32`, `linux`, `darwin`), search-first instructions, precision editing guidelines, and relative path resolution rules.

### Provider Abstraction Layer
- **Unified Provider Interface (`src/providers/types.ts`)**:
  - Common `LLMProvider` contract with async generator streaming (`StreamEvent`).
  - Standardized message formats (`LLMMessage`, `AssistantContent`, `ToolResult`).
  - SSE line parsing stream helper (`sseDataLines`).
- **Anthropic Adapter (`src/providers/anthropic.ts`)**:
  - Native Anthropic Messages API v1 streaming integration.
  - Tool calling protocol translation (`tool_use` / `tool_result`).
  - Streaming token usage accumulation.
- **OpenAI-Compatible Adapter (`src/providers/openai.ts`)**:
  - Universal `/chat/completions` client supporting DeepSeek, Groq, OpenRouter, Ollama, LM Studio, vLLM, and OpenAI.
  - Streaming tool arguments stitching across chunks.
  - Reasoning tokens extraction (`reasoning_content` / `reasoning`).
  - Live model discovery (`listModels()` against `/models`).

### Sandboxed Tooling
- **Filesystem Tools (`src/tools/fs.ts`)**:
  - `Workspace` path sandbox: path normalization, cross-platform root boundary enforcement, and path traversal block.
  - `read_file`: Line-offset/limit pagination, 512KB limit, and binary NUL-byte detection.
  - `write_file`: Recursive parent directory creation and file generation.
  - `edit_file`: Exact string replacement with context checking and `replace_all` support.
  - `list_dir`: Alphabetic sorting (directories grouped first) and empty directory handling.
  - `glob`: Built-in Node glob search capped at 200 items.
- **Search Tools (`src/tools/search.ts`)**:
  - `grep`: Regex-based fast search, ignore directory filtering (`node_modules`, `.git`, `dist`, `.cache`, etc.), extension filtering, binary sniffing, and match count capping.
- **Execution Tools (`src/tools/bash.ts`)**:
  - `bash`: Platform-aware command execution (`cmd.exe` on Windows, `/bin/sh` on Unix), output truncation (200KB limit), color stripping (`FORCE_COLOR=0`), and configurable timeout handling.
- **Tool Registry & Validation (`src/tools/registry.ts`)**:
  - Zod schema validation on tool inputs.
  - Structured JSON Schema export for LLM tool declarations.
  - Unified tool dispatching with standardized error formatting.

### Security & Permission System
- **Deferred Permissions (`src/permissions.ts`)**:
  - Promise-parking permission manager awaiting user interactive response.
  - Auto-approval set for read-only tools (`read_file`, `list_dir`, `glob`, `grep`).
  - Session-level whitelist escalation (`a` = allow for session).
  - Explicit user rejection forwarding to the model as an actionable error.

### Terminal UI (Ink / React)
- **State Store (`src/ui/store.ts`)**:
  - Observable store subscribing React components via `useSyncExternalStore`.
  - Stream delta batching (40ms timer) to prevent terminal flickering.
  - Live token usage and cost calculation matrix (`src/ui/utils/pricing.ts`).
- **Interactive Components**:
  - `App.tsx`: Fullscreen alternate screen buffer (`\x1b[?1049h`), dynamic terminal resize tracking, and global key routing.
  - `MessageList.tsx`: Virtualized scrollback viewport with PageUp/PageDown/Ctrl+Arrow scrolling.
  - `InputBox.tsx`: Single/multi-line prompt input with command detection.
  - `PermissionPrompt.tsx`: Inline permission prompt with visual diff preview for edits/writes and shell command inspection.
  - `StatusBar.tsx`: Active provider/model, connection state, turn counter, session token usage, USD cost, and latency meter.
  - `SetupWizard.tsx` & `Welcome.tsx`: First-time setup onboarding with live endpoint querying.
  - `SessionPicker.tsx`: Interactive session browser and resume picker.
  - `CommandPalette.tsx`: Interactive slash command modal.
- **Formatting Utilities**:
  - `markdown.ts`: Terminal markdown rendering.
  - `syntax.ts`: Syntax highlighting for code fences.
  - `diff.ts`: Unified diff computation with context lines.
  - `toolSummary.ts`: Formatted badge displays for active/completed tool executions.

### Session Management & Configuration
- **Sessions (`src/sessions.ts`)**:
  - Local JSON storage under `~/.codingagent/sessions/`.
  - Autosaving after every turn, title generation from initial user prompt, session loading, and cleanup.
- **Config (`src/config.ts`, `src/configWizard.ts`)**:
  - Global configuration storage at `~/.codingagent/config.json`.
  - Provider registration, default model selection, permission overrides, and usability validation.

---

## 2. Phased Roadmap

### Phase 1: Robustness & Context Management (Immediate Focus)
1. **Node 20 Compatible Fast Glob Engine**:
   - Zero-dependency recursive file walker with glob matching supporting Node >= 20 (fixing the runtime dependency on Node 22 `fs.globSync`).
2. **Robust Error Recovery & Provider Retries**:
   - Exponential backoff with jitter for HTTP rate limits (`429`) and server errors (`500`, `502`, `503`, `529`).
   - Graceful connection drop detection and friendly error reporting.
3. **Context Window Pruning & Compaction**:
   - Token budget estimation and management per turn.
   - Compact older large tool results into summary notes to avoid blowing context windows.
   - Sliding-window strategy for long-running multi-turn agent conversations.

### Phase 2: Tooling & Coding Agent Capabilities
1. **Native Git Integration**:
   - `git_status`, `git_diff`, `git_log`, `git_commit` built-in tools.
2. **Project Rules & Instruction Auto-loading**:
   - Auto-detect `AGENT.md`, `CLAUDE.md`, `.agentrules` in workspace and load them into the system prompt.
3. **Task & Step Checklist Management**:
   - Structured task management tools for multi-step refactoring workflows.
4. **Test & Diagnostic Runner**:
   - Automated test execution and failure extraction for popular test runners (Jest, Vitest, Pytest, Go test, Cargo).

### Phase 3: Developer Experience & TUI Enhancements
1. **Multi-line Input & External Editor Support**:
   - Multi-line editing and `$EDITOR` spawning in `InputBox`.
2. **Path & Command Autocomplete**:
   - Tab completion for file paths in workspace and slash commands in palette.
3. **Enhanced Interactive Diff & Rollback**:
   - Side-by-side / color-coded diff inspection in permission prompt with rollback capability.
4. **Session Export**:
   - `/export` command to export full session transcript to Markdown / HTML.

### Phase 4: Sub-Agents & Extensibility
1. **Model Context Protocol (MCP) Client**:
   - Connect to standard MCP servers over stdio/SSE to dynamically import tools.
2. **Sub-Agent Delegation**:
   - Isolated worker sub-agents for dedicated search, code review, or testing tasks.

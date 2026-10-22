# Changelog

All notable changes to `@theruid/ruid` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.49] - 2026-10-22

### Fixed
- Ctrl+C while an approval prompt is open no longer hangs the turn.
- Interrupted or failed turns keep the work they finished in the conversation, so the agent remembers edits it made; turns that produced nothing leave history unchanged.
- Parallel calls to the same tool no longer show each other's results or timings.
- Auto-approved tools no longer flash the approval prompt.
- `/rollback` steps back one more turn each time, and `/rollback <turn>` removes the matching conversation turns.
- `/clear` starts a new session instead of overwriting the saved one; a session's creation date is preserved.
- `@file` mentions respect workspace boundaries and never attach secrets such as `.env` files.
- The status bar's context % reflects the current prompt size; costs are priced per request, include Anthropic cache tokens, and unknown/local models no longer show a guessed price.
- PageUp/PageDown scroll the right distance, Home/End jump to the top/bottom, and scrolling stops at the top.
- `/model <id>` and session resume keep model capabilities.
- Layout accounts for multi-line input, notices, diffs and task panels, so the status bar stays on screen.
- The update banner no longer installs on a stray "y"; install with `/update`.
- Prompt history survives the pickers, pasted text keeps its line breaks, and the terminal is restored after a crash.
- Turns that hit the iteration limit end cleanly; the session JSONL log appends only new messages.

### Changed
- MCP count shows connected servers; `/help` lists every command; skill mode switches are announced and reverted after the skill.
- Landing page: progress bar, active-section highlighting, reveal-on-scroll, back-to-top, correct anchor offsets and lighter background effects.

## [0.3.22] - 2026-08-29

### Changed
- Enhanced git rollback diff comparison preventing unnecessary write-backs on unmodified pre-turn dirty files.

## [0.3.21] - 2026-08-29

### Added
- Git-backed working tree rollback engine (`src/tools/gitRollback.ts`) tracking turn checkpoints, removing created directories and files, and restoring modified/deleted tracked files.
- Tool execution hooks system (`src/hooks.ts`) supporting `preToolUse` and `postToolUse` rules with fail-closed security enforcement, stdin JSON delivery, and `/hooks` command.
- Disk persistence for turn snapshots with 25-turn rolling pruning, base64 binary file capture, and 1MB size bounds.
- Full task lifecycle management with `task_delete` tool and task list serialization into session history (`tasks?: AgentTask[]`).
- Dynamic `RUID_CONFIG_DIR` configuration override for deterministic test isolation without home directory contamination.
- GitHub Actions CI workflow (`.github/workflows/ci.yml`) triggering on push and pull requests with `typecheck` and `test` gates.
- Unified TypeScript test infrastructure consolidating all standalone test scripts into `src/**/*.test.ts`.
- Sub-agent and session crash recovery detection appending synthetic interrupted tool results on mid-execution kill.
- Side-effect reporting in turn snapshot rollback engine.
- Smoke tests for provider presets (Anthropic, OpenAI, DeepSeek, Groq, OpenRouter, Ollama, LM Studio).

### Changed
- Refactored `buildRegistry` parameter signature to a structured `BuildRegistryOptions` object.
- Extracted stale state failure classification and retry trackers into `src/agent/staleState.ts`.
- Updated DeepSeek API base URL to `https://api.deepseek.com`.
- Removed decommissioned `mixtral-8x7b-32768` model from Groq presets.
- Replaced silent catch blocks in `loop.ts` and `audit/log.ts` with debug-level diagnostic logging.

## [0.3.13] - 2026-08-28

### Added
- Interactive CLI prompt detection and hang control with rolling buffer and quiet confirmation timer.
- Model Context Protocol (MCP) support over stdio and SSE transports.
- Two-phase history compaction with micro-compaction and semantic LLM summarization.
- Full-text session search and live transcript filtering in `/resume`.

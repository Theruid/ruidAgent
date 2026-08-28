# Changelog

All notable changes to `@theruid/ruid` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Dynamic `RUID_CONFIG_DIR` configuration override for deterministic test isolation without home directory contamination.
- GitHub Actions CI workflow (`.github/workflows/ci.yml`) triggering on push and pull requests with `typecheck` and `test` gates.
- Unified TypeScript test infrastructure consolidating all 17 legacy standalone scripts into `src/**/*.test.ts`.
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

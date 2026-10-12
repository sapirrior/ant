# Changelog

All notable changes to `ant` are documented in this file.

## [0.1.0] - 2026-10-12

### Added
- **Headless Output Modes**:
  - Added `--output-format stream-json` / `-o stream-json` streaming NDJSON events (`init`, `text`, `tool_call`, `tool_result`, `step`, and terminal `result`).
  - Added strict Zod schemas for all emitted envelopes (`ResultSchema`, `StreamEventSchema`, `StreamResultEventSchema`).
  - Added `OutputSink` abstraction separating stdout event and result formatting from engine logic.
- **Signal & Lifecycle Hardening**:
  - Added `createLifecycle` managing `SIGINT`, `SIGTERM`, `SIGHUP`, and uncaught errors.
  - Added 8-second shutdown grace timer before forced teardown.
  - Added synchronous emergency cleanup registry releasing DB leases and killing spawned subprocesses.
  - Consolidated exit codes: 0 (completed), 1 (max_steps/truncated/empty), 2 (usage/config), 3 (model), 4 (timeout), 5 (internal), 129 (SIGHUP), 130 (SIGINT), 143 (SIGTERM).
- **Session & DB Integrity**:
  - Added SQLite migration 2 adding `last_status` and `last_exit_code` to threads table.
  - Added atomic step persistence using `recordStepMessages` in a single transaction.
  - Added automatic session repair on load (`repairHistory`) fixing orphan tool calls and enforcing role alternation.
  - Added content-addressed blob insertion inside checkpoint transactions.
- **CLI & Input Hardening**:
  - Added stdin idle timeout (`ANT_STDIN_TIMEOUT`, default 5 s) guarding against open pipe deadlocks.
  - Overrode Commander CLI error handling to guarantee exit code 2 and standard error prefixes.
  - Added support for `minimal` reasoning effort.
- **System Instructions**:
  - Enhanced instructions with autonomous engineering practices and file reference format (`path/file:line`).

### Changed
- Compact single-line JSON is now emitted in `-o json` mode for Unix utility compatibility.
- Fixed `tools.Bash.foregroundMs`, `tools.Bash.passEnv`, and per-tool enablement settings by passing settings into `buildTools`.
- Fixed color output detection to inspect `stdout.isTTY` and honor `NO_COLOR`.

### Removed
- Removed `AskUserTool` to keep `ant` strictly autonomous and headless, eliminating interactive readline deadlocks and TTY hijacking during automated runs.

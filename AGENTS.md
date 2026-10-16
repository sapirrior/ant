# Agent Rules & Guidelines

## Execution & Scope
- **Follow User Direction Strictly**: Only perform what the user explicitly instructs. Never assume features, requirements, or scope.
- **Granular Commits**: Make small, incremental, focused commits.
- **No Overengineering**: Favor simplicity and directness. Do not add boilerplate, excessive defensive checks, or speculative abstractions when a simple, clean solution suffices. If one line is enough, do not write 10 extra lines.
- **Practical Engineering**: Apply common-sense software design principles without unnecessary complexity.
- **Type Verification**: Always verify strict TypeScript types after making code changes.

## Engineering Rules & Invariants
- **Tool Filtering**: `--tools <filter>` controls exposed tools. An empty filter (`--tools ""` / `[]`) must fail closed and expose no tools.
- **Permission Precedence**: Explicit denies are always evaluated before allows or bypass rules.
- **Supported Permission Modes**: Only `default`, `plan`, `acceptEdits`, and `bypassPermissions`. Reject `auto` and `dontAsk`.
- **Centralized Safety**:
  - Always use `resolveWithinRoot` in `src/policy/paths.ts` for workspace path containment.
  - All tool executions must flow through centralized policy (`executeWithPolicy`).
  - Do not reimplement custom tool filtering or permission logic.
- **Stdout vs. Stderr Separation**:
  - **stdout**: Dedicated strictly to result data in the requested output format (`text`, `md`, `json`, `stream-json`).
  - **stderr**: Diagnostic summaries, error messages, and tool logs.

## Verification Checklist
Run after code changes:
1. `bun run typecheck`
2. Relevant focused tests (e.g. `bun test src/policy/`)
3. Full test suite: `bun test`

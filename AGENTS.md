# Agent Rules & Guidelines

## Execution & Scope

- **Follow User Direction Strictly**: Perform only what the user explicitly instructs. Never assume features, requirements, or scope.
- **Granular Commits**: Make small, incremental, focused commits.
- **Simplicity**: Write direct, minimal code. If one line suffices, do not write ten.
- **Single Source of Truth**: Keep authority in one place. Trust the environment (scripts, configs) over duplicate doc text.

## Engineering Invariants

- **Tool Filtering**: An empty tool filter (`--tools ""` or `[]`) must fail closed and expose no tools.
- **Permission Precedence**: Explicit denies (`disallowedTools`) evaluate first and override all allows and bypass rules.
- **Supported Permission Modes**: Only `default`, `plan`, `acceptEdits`, and `bypassPermissions` are valid. Reject all others with exit code 2.
- **Centralized Safety**:
  - Enforce workspace path containment via `resolveWithinRoot`.
  - All tool executions flow through centralized policy in `src/policy/`.
  - Never reimplement custom tool filtering or permission logic.
- **Stream Separation**:
  - `stdout`: Reserved strictly for machine-readable output results (`text`, `md`, `json`, `stream-json`).
  - `stderr`: Reserved strictly for diagnostics, warnings, and tool notices.

## Verification Checklist

Execute in order after making code changes:

1. `bun run typecheck`
2. `bun run schemas:check`
3. Relevant focused test: `bun test tests/<file>.test.ts`
4. Full test suite: `bun test`

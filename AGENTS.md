# Agent Rules & Guidelines

## Execution & Scope

- **Follow User Direction Strictly**: Only perform what the user explicitly instructs. Never assume features, requirements, or scope.
- **Granular Commits**: Make small, incremental, focused commits.
- **No Overengineering**: Favor simplicity and directness. Do not add boilerplate, excessive defensive checks, or speculative abstractions when a simple, clean solution suffices. If one line is enough, do not write 10 extra lines.
- **Practical Engineering**: Apply common-sense software design principles without unnecessary complexity.
- **Type Verification**: Always verify strict TypeScript types after making code changes.

## Engineering Rules & Invariants

- **Tool Filtering**: An empty tool filter must fail closed and expose no tools.
- **Permission Precedence**: Explicit denies are always evaluated before allows or bypass rules.
- **Supported Permission Modes**: Only `default`, `plan`, `acceptEdits`, and `bypassPermissions` are valid modes. Reject all other modes.
- **Centralized Safety**:
  - Always enforce workspace path containment.
  - All tool executions must flow through centralized policy.
  - Do not reimplement custom tool filtering or permission logic.
- **Stream Separation**:
  - stdout is reserved strictly for machine-readable output results.
  - stderr is reserved for diagnostics, warnings, and tool logs.

## Verification Checklist

Run after code changes:

1. `bun run typecheck`
2. Relevant focused tests
3. Full test suite: `bun test`

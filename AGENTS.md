# Ant Contributor & Agent Guidelines

## Execution & Scope
- **Follow User Direction Strictly**: Only perform what the user explicitly instructs. Never assume features, requirements, or scope.
- **Granular Commits**: Make small, incremental, focused commits.
- **No Overengineering**: Favor simplicity and directness. Do not add boilerplate, excessive defensive checks, or speculative abstractions when a simple, clean solution suffices. If one line is enough, do not write 10 extra lines.
- **Practical Engineering**: Apply common-sense software design principles without unnecessary complexity.
- **Type Verification**: Always verify strict TypeScript types after making code changes.

## Module Map & Responsibilities
- `src/main.ts`, `src/cli/*`: Command registration, CLI flags, option parsing, CLI dispatch. Must not own permission matching, AI SDK loops, or SQL queries.
- `src/config/*`: Settings schemas, disk read/write (`~/.ant/settings.json`), defaults, key operations, config precedence merge. Must not own tool execution or output rendering.
- `src/core/engine.ts`: Run orchestration, resource lifecycle (timers, signals, cleanup), dispatching events to sinks and loggers. Must not parse raw argv or contain low-level SQL details.
- `src/core/agent.ts`: AI SDK `streamText` loop, event conversion, usage/status mapping, persistence callbacks. Must not write directly to stdout/stderr or execute raw DB queries.
- `src/core/providers/*`: Provider/model construction and credential validation. Must not parse CLI args or make policy decisions.
- `src/policy/*`: Permission rules, allow/deny precedence, sensitive-path guards, path containment (`resolveWithinRoot`). Must not duplicate tool catalogues or tool implementations.
- `src/tools/*`: Tool schemas, prompts, and implementations. All tools execute via `executeWithPolicy`. Must not implement independent permission checks or path resolvers.
- `src/store/*`: SQLite schema, migrations, thread persistence, message history, checkpoints, history repair. Must not handle user formatting or CLI flags.
- `src/output/*`: Output sinks, stdout serialization (`text`, `md`, `json`, `stream-json`), Markdown rendering, stderr diagnostics and tool logs. Must not make model execution or policy decisions.
- `src/mcp/*`: MCP configuration parsing, client connections, tool transport. Must not duplicate settings precedence or permission logic.

## Data & Request Flow
```
CLI (src/cli/run.ts)
  │
  ▼
Config Resolution (CLI flags > Env vars > Settings > Defaults)
  │
  ▼
Core Engine (src/core/engine.ts)
  ├── Session/Thread Lifecycle (src/store/*)
  ├── Tool Catalogue & Policy (src/policy/*, src/tools/*)
  ├── Agent Loop (src/core/agent.ts) ──> AI SDK & Providers (src/core/providers/*)
  └── Output Sinks (stdout) & Diagnostics Logger (stderr) (src/output/*)
```

## Config Precedence & Aliases
Precedence order:
1. Explicit CLI flag (`--model`, `--output-format`, etc.)
2. Supported Environment Variables (`ANT_MODEL`, `ANT_OUTPUT`, `ANT_LOG_LEVEL`, etc.)
3. Persistent User Settings (`~/.ant/settings.json`)
4. System Defaults

Legacy aliases preserved: `ANT_OUTPUT` for output format, `ANT_MAX_STEPS` for turns, `effort`/`reasoning` for reasoning effort.

## Tool Filtering vs. Policy Invariants
- `--tools <filter>` controls which tools are exposed to the model. An explicit empty filter (`--tools ""` / `[]`) must fail closed and expose no tools.
- `--allowed-tools` / `--disallowed-tools` dictate whether an exposed tool execution is approved.
- Explicit denies are always evaluated before allows or bypass rules.
- Permission modes: `default`, `plan`, `acceptEdits`, `bypassPermissions`. Do not add Claude `auto` or `dontAsk` modes.

## Stdout vs. Stderr Separation
- **stdout**: Dedicated strictly to result data in the requested output format (`text`, `md`, `json`, `stream-json`). Must stay machine-readable in JSON/stream-json modes.
- **stderr**: Diagnostic summaries, progress notices, error messages, and tool-call lifecycle logs (`tool:start`, `tool:end`).

## Explicit "Do Not Reimplement" Rules
- **Do not reimplement tool filtering**: Use effective permissions and the centralized catalogue.
- **Do not reimplement permission checks**: All tool executions must flow through `executeWithPolicy`.
- **Do not reimplement path containment**: Always use `resolveWithinRoot` in `src/policy/paths.ts` for workspace confinement.
- **Do not reimplement settings parsing**: Use schemas and resolvers in `src/config/`.
- **Do not hand-build divergent output payloads**: Adhere strictly to canonical schemas in `src/output/schema.ts`.

## Verification Commands
After code changes:
1. `bun run typecheck` (verify strict TypeScript types)
2. Relevant focused tests (e.g. `bun test src/policy/...`)
3. Full test suite: `bun test`

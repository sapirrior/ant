# ant: Headless Runner Hardening Plan

Audience: a Coder agent. Execute phases in order. Every phase ends with a green `bun test` and a typecheck.
Priorities: (1) developers running `ant` directly in a terminal, (2) scripts and pipes, (3) CI.

Source of findings: static review of the `ant_wit.xml` snapshot (77 files). Claims below are marked:
- **[V]** verified by reading the code in the snapshot
- **[U]** NOT verifiable from the snapshot. Verify first (Phase 0), then adapt the step if reality differs.

Reference behaviors borrowed from the Claude Code and Antigravity headless docs: one JSON envelope with session id, status, usage and duration; NDJSON streaming with an `init` event, step events and exactly one terminal `result` event; stdout is machine data, stderr is diagnostics; documented exit codes; defined SIGTERM and SIGINT semantics; permission requests that cannot be answered are denied, never hang.

---

## 0. Phase 0: Baseline and verification (do not skip)

0.1 Read `package.json` and `tsconfig.json`. Record the test, typecheck and lint commands. Run them; the baseline must be green before any change. Fix nothing yet.

0.2 Verify each **[U]** item and write the result as a comment block at the top of the matching new file. Do not guess.

| # | Question | How to verify |
|---|---|---|
| U1 | Exact AI SDK v7 API used in `agent.ts` (`streamText` options `instructions`, `stopWhen: isStepCount`, `timeout.firstChunkMs`, `result.stream`, `result.finalStep`, `onStepEnd`) and the shape of `ModelMessage` tool-call / tool-result parts | Read `node_modules/ai` type definitions and `.agents/skills/migrate-ai-sdk-v6-to-v7/SKILL.md` |
| U2 | How to pass reasoning effort per provider (top-level option, or `providerOptions`) for `@ai-sdk/anthropic`, `@ai-sdk/google`, `@ai-sdk/openai-compatible` | Read each package's type definitions and docs in `node_modules`. Candidates only, not facts: anthropic `thinking {type, budgetTokens}`, google `thinkingConfig`, openai-compatible `reasoningEffort` |
| U3 | `AbortController.abort(reason)` on Bun: `signal.reason` round-trips a string; `AbortSignal.any` exists | 5-line `bun -e` script |
| U4 | Does a SIGINT delivered while `readSync` on `/dev/tty` blocks (Bash confirm, `promptAskTTY`) run the JS handler, return EINTR, or hang? | Manual test in a real terminal, and a pty test via `script` |
| U5 | `src/core/prompt.ts`, `src/core/grants.ts` (`resolveGrants`), `README.md`, `output/markdown.ts` `StreamingMarkdownRenderer`, `output/color.ts` `detectColorLevel` were not read in full | Read them before touching the steps that reference them |
| U6 | `ant [prompt]` as the root default command alongside subcommands `threads`, `config`, `checkpoints`: does `ant threads` ever get parsed as a prompt? | `bun src/main.ts threads --help` and a test |

---

## 1. Verified findings (what the plan fixes)

**Reported bugs**
- **B1 [V]** `settings.ts` `KNOWN_TOP_KEYS` contains model, maxSteps, timeout, retries, streamRetries, output, logLevel, theme, allow and tools, but **not `reasoning`**. `KEYS.reasoning` and `KEYS.effort` both write `s.reasoning`, so `ant config set effort ...` produces a file that the next `loadSettings()` warns about. The warning goes straight to `process.stderr`, bypassing `--log-level`.
- **B1b [V]** Worse: `config.effort` is **never used**. `agent.ts` builds `streamText({...})` with no reasoning or provider options. Even after the warning is fixed, `--effort` is a silent no-op.
- **B2 [V]** `engine.ts` `setupSignalHandler` does `(controller.signal as any).reason = 'SIGINT'`. `signal.reason` is read-only, so it throws `TypeError` inside the signal handler, before `abort()` runs. The same pattern is used for `'timeout'` (inside the `setTimeout` callback) and SIGTERM. `agent.ts` then reads `(signal as any).reason`.

**Session and data integrity**
- **I1 [V]** `onStepPersist` in `engine.ts` calls `appendMessage` once per message (a separate transaction each), then a separate `UPDATE threads` for tokens. A kill between them leaves a message set and counters out of sync. `recordStepMessages` in `store/threads.ts` already does it atomically (messages, steps, tokens in one transaction) and is **unused**. `threads.steps` is therefore never incremented.
- **I2 [V]** `createThread` runs before the "No instruction provided" check. A prompt-less run leaves an orphan empty thread row.
- **I3 [V]** Interrupted-run repair only handles "last stored message is `user`". If the last stored message is a `tool` message, or an assistant message with tool-calls lacking results (SIGKILL, crash), the next `-r` run sends an invalid history. No repair on load.
- **I4 [V]** `recordCheckpoint` inserts blobs outside the transaction (harmless garbage but impure). File mutation then checkpoint is synchronous with no `await` between them, so SIGINT cannot interleave; only SIGKILL or power loss can leave a mutated file without a checkpoint. Treat as low risk, hardened in 2.9.
- **I5 [V]** Second SIGINT does `process.exit(130)` directly. This skips the engine `finally`: background tasks (spawned `detached: true`) are orphaned, the lease is not released (recovered later by the dead-pid takeover, but only after the next run) and the `db` is not closed.
- **I6 [V]** No SIGHUP, uncaughtException or unhandledRejection handlers. Closing the terminal or dropping SSH kills the process without cleanup.
- **I7 [V]** On abort, `agent.ts` returns `text: ''`, discarding streamed partial text. The persisted history only gets the synthetic marker.
- **I8 [V]** `openDb()` is called outside the `try`. If it throws, signal handlers and the timeout timer are never cleaned (the process exits anyway, but tests and embedding would leak).
- **I9 [V]** `setTimeout(config.timeoutMs)`: values above 2^31-1 ms fire immediately. `parseDurationMs` is not verified to cap.

**Headless contract**
- **H1 [V]** Errors never reach stdout in `json` mode. `engine.run` catch and `run.ts` catch only write to stderr, so a consumer parsing stdout gets empty output on any pre-run failure (bad model, lease conflict, missing prompt).
- **H2 [V]** `Status` includes `internal_error` but nothing returns it. `engine.run` maps every thrown error to exit 2 (usage). DB failures, lease conflicts and real bugs are indistinguishable.
- **H3 [V]** No streaming machine format. `-o json` is a single pretty-printed object at the end. Non-TTY `text` and `md` print only the final text.
- **H4 [V]** `renderOutcome` for `md` calls `detectColorLevel()` with no argument, which defaults to `process.stderr.isTTY`. Piping stdout to a file while stderr is a TTY writes ANSI escapes into the file. **[U5]** confirm `NO_COLOR` handling.
- **H5 [V]** `readPipedStdin` does `for await (process.stdin)` whenever stdin is a FIFO or file. A parent process that leaves a pipe open and never closes it (CI runners, `spawn` with `stdio: 'pipe'`) hangs `ant -p "x"` forever. It also runs before any signal handler exists.
- **H6 [V]** Commander's own errors (unknown flag, missing argument value) exit 1, conflicting with the documented usage code 2.
- **H7 [V]** `tool-result` events are marked `isError` only for AI-SDK `tool-error` parts. Tools return `{ ok:false, error }` objects through `executeWithPolicy`, so failed tool calls are logged as `done`.
- **H8 [V]** `toolCallId` is never set in `ToolExecutionContext` (the tools' `execute` ignores its second argument), so every checkpoint stores `tool_call_id = NULL`.
- **H9 [V]** `buildTools(toolContext)` is called without `settings`, so `settings.tools.<Name>.enabled` is ignored by `ant`. `streamRetries` from settings is also never read; `agent.ts` hardcodes `streamRetries: 1`. `ToolExecutionContext.passEnv` is never populated.
- **H10 [V]** `tool-error` event: `output: part.error` is an `Error` object, which JSON-serializes as `{}`.

**AskUser**
- **A1 [V]** `tools/index.ts` always registers `AskUser`. `AskUserTool.ts` reads `process.stdin` through `readline`, which conflicts with already-consumed piped stdin, ignores the abort signal (Ctrl+C during the question hangs until a second Ctrl+C), and writes the prompt to stderr. `promptAskTTY` exists in `output/tty.ts` and is unused.

---

## 2. Phase 1: P0 bug fixes (small, ship first)

### 2.1 Fix signal reason (B2)
- New file `src/core/signals.ts`:
  - `export type AbortReason = 'SIGINT' | 'SIGTERM' | 'SIGHUP' | 'timeout'`
  - `export function abortReasonOf(signal: AbortSignal): AbortReason | undefined` (returns `signal.reason` if it is one of the known strings, else `undefined`).
- Replace every `(controller.signal as any).reason = X; controller.abort()` with `controller.abort(X)` (engine: SIGINT, SIGTERM, timeout).
- Replace every `(signal as any).reason` read in `agent.ts` with `abortReasonOf(signal)`.
- Extend `ExitCode` and `mapStatusToExitCode` handling: SIGINT 130, SIGTERM 143, SIGHUP 129, timeout 4. Consolidate the duplicated abort-outcome block in `agent.ts` into one `abortOutcome(signal, stepsExecuted, partialText)` helper.
- **Test** (`src/core/signals.test.ts`): abort with each reason; assert no throw and `abortReasonOf` result. Regression test for the exact TypeError.

### 2.2 Fix `reasoning` setting and wire effort (B1, B1b)
- `settings.ts`: add `'reasoning'` and `'effort'` to `KNOWN_TOP_KEYS`. Also add any other key present in `Settings` or `KEYS` but missing from the set. Derive the set from `Object.keys(DEFAULT_SETTINGS)` plus a typed explicit list so they cannot drift again; add a test asserting every `KEYS[...]` root key is in the known set.
- `loadSettings` unknown-key warning: keep, but emit once per run through a `warn` callback instead of raw `process.stderr.write`, so `--log-level error` and the future JSON modes control it (pass warnings up; `run.ts` replays them through `StderrLogger.warning`). Make `loadSettings` return `{ settings, warnings }` or accept a `warn` option. Update all callers (`cli/config.ts` included).
- New `src/core/effort.ts`: `buildReasoningOptions(provider, modelId, effort): { providerOptions?: ...; warning?: string }`.
  - `undefined` or `'provider-default'` returns `{}`.
  - Table-driven mapping per provider, based on U2 results. Keep the mapping data in one object so adding a provider is one entry.
  - Unsupported combination (for example `max` on a provider without it, or a model that rejects the option): degrade to the nearest supported level and return a `warning` string; never throw. `none` maps to explicitly disabling reasoning where the provider supports that.
- `agent.ts`: call `buildReasoningOptions`, spread the result into `streamText`, and emit any warning through a new `RunEvent` type `warning`.
- **Tests**: unit tests per provider and level (snapshot of produced options); settings round trip `config set effort high` then `loadSettings` yields no warning; `--effort` flag beats env beats settings.

Acceptance: `ant config set reasoning high && ant -p hi` prints no warning, and a debug log line shows the effective effort options.

---

## 3. Phase 2: Lifecycle and shutdown guarantees

Goal: after any exit path (normal, SIGINT, SIGTERM, SIGHUP, timeout, thrown error, crash), the DB is consistent, the lease is released, background processes are dead, and stdout holds a complete record in machine modes.

### 2.1 Run-scoped lifecycle object
Create `src/core/lifecycle.ts` exporting `createLifecycle()` that owns: the `AbortController`, the signal handlers (SIGINT, SIGTERM, SIGHUP), `uncaughtException` and `unhandledRejection` handlers, a registry of cleanup callbacks (`onCleanup(fn)`), and `emergencyExit(code)`.

Behavior:
1. First signal: `controller.abort(reason)`; start a **grace timer** (default 8 s, constant `SHUTDOWN_GRACE_MS`) after which cleanup is forced even if the agent loop has not returned.
2. Second signal (any of the three): run **synchronous** emergency cleanup (kill all tasks with SIGKILL, release lease, close db, each in its own try/catch), then `process.exit(code)`. Never call `process.exit` without running the registry first.
3. `uncaughtException` / `unhandledRejection`: log to stderr, run emergency cleanup, exit 5.
4. Handlers are removed in `dispose()`, idempotent.
- Move `setupSignalHandler` out of `engine.ts` into this module (keep a thin re-export if tests import it).
- Install the lifecycle **before** reading stdin (see 5.2) so Ctrl+C during stdin read is handled uniformly with the right exit code.

### 2.2 Engine restructure
- Move `openDb()` inside the `try`; initialize `db` as `let db: Database | undefined`; `finally` null-checks it (I8).
- Validate that a prompt or stdin exists **before** `createThread` or any DB mutation (I2). Better: validate in `run.ts` before the engine is created and throw a `UsageError`.
- Register cleanups in order: clear timeout timer; `tasks.shutdown()` (SIGTERM, then SIGKILL after 3 s, awaiting exit with a cap; sync `killAll` stays for the emergency path); release lease; `db.close()`.
- Clamp timeout: `Math.min(timeoutMs, 2_147_483_647)`; reject non-finite or negative in `parseDurationMs` with a usage error (I9). `0` means no timeout (keep).

### 2.3 Error taxonomy
New `src/core/errors.ts`: `class AntError extends Error { code: ErrorCode; status: Status }` with subclasses or factories: `UsageError` (status `usage_error`, exit 2), `ThreadLockedError` (`usage_error`, exit 2, code `thread_locked`), `ThreadNotFoundError`, `StoreError` (status `internal_error`, exit 5), `ConfigError` (usage). `engine.run` catch maps `AntError` to its status; unknown errors become `internal_error` (exit 5) (H2). Replace bare `throw new Error(...)` at the user-input sites in `run.ts`, `engine.ts`, `store/db.ts` (`acquireLease`), `store/threads.ts` (`resolveThreadId`).
- Result: every failure produces a `ModelOutcome`-shaped value so the output layer (Phase 4) can always emit a terminal record.

### 2.4 Preserve partial output on abort (I7)
- In `agent.ts` accumulate `partialText` from `text-delta`; the abort outcome returns it as `text` (status stays `cancelled` or `timeout`).
- In `engine.ts` the synthetic assistant message after a non-completed run becomes: partial text (if any) plus `\n[ant: run ended with <status>: <error>]`. Append it whenever the last stored message is **not** an assistant message with plain content (extend the existing `user`-only condition, see 2.6).

### 2.5 Atomic step persistence (I1)
- `onStepPersist` calls `recordStepMessages(db, threadId, stepMessages, 1, usage)`; delete the per-message `appendMessage` loop and the separate token UPDATE. Keep `appendMessage` for the user message.
- Create the thread and its first user message in **one** transaction (new `createThreadWithMessage` or a `db.transaction` wrapper in the engine).
- Migration 2 (append to `MIGRATIONS`, never edit migration 1): `ALTER TABLE threads ADD COLUMN last_status TEXT; ALTER TABLE threads ADD COLUMN last_exit_code INTEGER;`. Update `ThreadRecord`, `mapRow`, and `ant threads` listing to show the last status. Engine writes them in the `finally` path (in a try/catch; failure to write must not mask the real exit code).
- Update `db.test.ts` for the new `user_version` and an upgrade-from-v1 test.

### 2.6 History repair on load (I3)
New `src/store/repair.ts`: `repairHistory(messages): { messages, repaired: string[] }`, applied after `getMessages` on `-r` / `-c` and persisted if changed (one transaction).
Rules (finalize after U1 shows exact part shapes):
1. Assistant message with tool-call parts and no following matching tool-result: append a `tool` message with an error result per orphan call ("interrupted before completion").
2. History ending in `user`: append the synthetic assistant marker (so the new user message does not follow another user message).
3. Never delete or rewrite existing content.
- Log a one-line `info` notice when repairs happen. **Tests**: each rule, plus idempotence (repair twice yields no change).

### 2.7 Lease robustness
- Keep pid check. Add `lock_at` staleness only as a tie-breaker note in docs; do not add heartbeats (YAGNI).
- `releaseLease` already guards by pid; keep. Ensure it is invoked in both the normal and emergency paths.

### 2.8 Background tasks on exit
- `TaskManagerRegistry.shutdown(graceMs)`: SIGTERM to each running group, wait for `close` up to `graceMs`, then SIGKILL. `killAll()` stays for the sync emergency path. Add tests with a real `sleep 60` child.

### 2.9 Checkpoint hardening (I4)
- `recordCheckpoint`: move blob inserts **inside** the transaction. Keep the `files.length === 0` early return.
- Optional, lower priority: write order "checkpoint intent first". For WriteFile and EditFile the final content is known before mutation, so record the checkpoint (with `after` computed from the intended content) and then `atomicWrite`; if the write throws, delete that checkpoint row in the same call. This closes the SIGKILL window. Apply only after tests pass for the simple fix, and keep `DeleteFile` and Bash flows consistent with whatever they do today.
- Set `toolCallId` correctly (H8): in each tool's `execute: async (input, options)`, build the per-call context `{...context, toolCallId: options.toolCallId}` **[U1]**. Add an assertion test that a WriteFile checkpoint row has a non-null `tool_call_id`.

**Phase 2 acceptance tests** (use a fake model, see Phase 6):
- SIGINT during a streaming response: exit 130, partial text persisted, `ant -r <id>` works and the history alternates correctly, lease is NULL, no `bun:sqlite` errors.
- SIGINT during a long Bash tool: child group dead, tool result recorded, exit 130.
- Double SIGINT: exit 130, lease released, no orphan `sleep`.
- SIGTERM: exit 143. SIGHUP: exit 129. Timeout: exit 4.
- `kill -9` mid-run, then `-r`: repair rules produce a valid history and the run proceeds.

---

## 4. Phase 3: AskUser only with `--allow-ask`

Verified current behavior: A1 above.

3.1 Capability: add `'user.ask'` to `Capability` in `core/types.ts`; update `resolveGrants` in `policy/grants.ts` (**[U5]** read it first) and `grants.test.ts`.
3.2 CLI and settings: `run.ts` add `--allow-ask` / `--no-allow-ask`; resolve like the other grants (CLI flag, then `settings.allow.ask`, then false; never env). Add `allow.ask` to `Settings`, `DEFAULT_SETTINGS`, `KEYS` (with `parseBool`), and `settings.test.ts`.
3.3 Registration: `tools/index.ts` registers `AskUser` only if `grants.has('user.ask')` **and** the settings `tools.AskUser.enabled` is not false **and** a controlling terminal is available (`/dev/tty` can be opened, checked once at startup via a helper in `output/tty.ts`). If `--allow-ask` is given but no tty exists, log one warning ("--allow-ask ignored: no controlling terminal") and do not register it, so the model never sees a tool it cannot use.
3.4 Prompt text: `core/prompt.ts` and `tools/AskUserTool/prompt.ts` must not mention AskUser when it is not registered **[U5]**. Add a line to the system prompt only when it is registered ("use AskUser sparingly").
3.5 Tool implementation: use `promptAskTTY`-style `/dev/tty` I/O instead of `process.stdin`, so piped stdin is never involved. Make it abort-aware **[U4]**: if `/dev/tty` reads cannot be interrupted synchronously, switch to an async read on a `/dev/tty` stream with `signal`, resolving `{ answer:'', skipped:true, reason:'aborted' }` on abort. Print the prompt to the tty, not stdout.
3.6 Header: include `ask` in `allowedCaps` in the engine header and in the machine-mode `init` event.
3.7 Bash confirmation: leave its behavior unchanged (deny when no tty), but route it through the same tty helper so it is also abort-safe. **Open question for the owner**: should the Bash destructive confirmation also require `--allow-ask`? Default in this plan: no.
3.8 **Tests**: tool absent without the flag (`Object.keys(buildTools(ctx))`); present with the flag and a tty stub; absent with the flag and no tty; settings round trip.

---

## 5. Phase 4: Output contract (stream-json, schemas, stdout rules)

### 4.1 Rules (document in README; enforce in code and tests)
1. In `json` and `stream-json` modes **stdout contains only JSON**: nothing else, ever (no ANSI, no logs, no warnings).
2. Diagnostics go to stderr only. `--log-level` controls stderr; it never affects stdout.
3. Machine modes always end with exactly one terminal `result` record, **including** usage errors, lease conflicts, missing model, aborts and internal errors (H1). A pre-run failure still emits a `result` with `status` and `error`.
4. Every record carries `schemaVersion` (start at `1`). Additive changes keep the version; breaking changes bump it.
5. Exit code always matches `result.exitCode`.

### 4.2 Schemas
New `src/output/schema.ts` with zod schemas as the single source of truth plus exported TS types (`z.infer`):
- `ResultSchema` (final envelope; keeps all existing `json` fields for backward compatibility): `schemaVersion, status, exitCode, text, threadId, steps, usage{inputTokens,outputTokens,totalTokens}|null, checkpoints:number[], error:string|null`. Additive: `errorCode:string|null, model:string|null, effort:string|null, durationMs:number, toolCalls:number, interrupted:{signal:string}|null, warnings:string[]`. **Do not change `error` into an object**; that breaks existing consumers.
- Stream events (discriminated union on `type`), each with `schemaVersion`, `seq` (monotonic from 0) and `ts` (ISO 8601):
  - `init`: `threadId, model, provider, cwd, effort, grants[], tools[], resumed:boolean, antVersion`
  - `text`: `delta`
  - `tool_call`: `callId, name, input` (input capped, see 4.4)
  - `tool_result`: `callId, name, ok, error|null, durationMs, output` (capped)
  - `step`: `stepNumber, finishReason, usage?`
  - `warning`: `message, code?`
  - `result`: same shape as `ResultSchema` plus `type:'result'`
- Export a generated JSON Schema file: `docs/schema/result.schema.json` and `docs/schema/stream-event.schema.json` (script `bun run schema`, drift checked in a test; use zod's JSON-schema conversion if the installed zod version has it **[U]**, otherwise hand-maintain and test with `safeParse`).

### 4.3 Formats and flags
- `OutputFormat` becomes `'text' | 'md' | 'json' | 'stream-json'`. Validate in `run.ts`; accept `--output-format` as an alias of `-o`. Update `settings.ts` `output` key validation and help strings.
- `stream-json` writes one compact JSON object per line, flushed per event, regardless of TTY. `json` stays buffered until the end (pretty-printed today; switch to compact single-line to match the Antigravity and Claude conventions, and note it in the changelog; `ant -o json | jq` still works).
- Terminal `text-delta` rendering for `text` and `md` in a TTY stays as is.

### 4.4 Implementation
- New `src/output/sink.ts`: `interface OutputSink { onEvent(e: RunEvent): void; finish(outcome, meta): void }` with implementations `TextSink`, `MarkdownSink` (move the current inline TTY logic out of `engine.ts`), `JsonSink`, `StreamJsonSink`. The engine only talks to the sink, which removes the `isStdoutTTY` / `isJsonOutput` branching from `engine.ts`.
- `StreamJsonSink` truncates large `input`/`output` payloads (default 64 KiB each, with `truncated:true` and original size) so one tool result cannot produce a gigantic line. Serialize errors properly (H10: `Error` becomes `{name, message}` string).
- Fix tool error flag (H7): `ok = output?.ok !== false && !isErrorPart`; set `isError` accordingly so `logger.toolEnd` prints the failure (and the error text at `info` level).
- Pre-run failures: build the sink **first** (it only needs the validated output format), so catch blocks in `run.ts` and `engine.ts` can call `sink.finish(errorOutcome)`. If the format itself is invalid, fall back to plain stderr.
- `md` color (H4): `renderOutcome` and the streaming renderer decide color from **stdout** `isTTY` and `NO_COLOR` / `FORCE_COLOR`, not stderr **[U5]**. Add `detectColorLevel(stream)` parameterization and tests. Non-TTY stdout means no ANSI.
- stdout write hardening: a `safeWrite` that handles `EPIPE` (consumer closed early, for example `| head`) by aborting the run with reason `SIGPIPE` semantics (exit 141 is conventional; map it as `cancelled`, exit 141) rather than throwing an uncaught error; and awaits drain before exit so large results are not truncated when `process.exit` is used in the emergency path (use `fs.writeSync(1, ...)` there).

### 4.5 Tests
- Golden tests for every event type validated by `ResultSchema` / event schema `.parse`.
- A test that runs the CLI as a subprocess with `-o stream-json` against a fake model and asserts: every stdout line parses as JSON, first event is `init`, last is `result`, exactly one `result`, `seq` strictly increasing.
- Error-path tests: no model configured, thread locked, missing prompt, all produce a valid `result` on stdout in machine modes and a non-zero exit code matching `result.exitCode`.

---

## 6. Phase 5: CLI and config hardening

5.1 **Commander errors** (H6): in `main.ts` call `program.exitOverride()` and `configureOutput({ writeErr })` (apply to subcommands too), and map `CommanderError` to exit code 2 and the `[ant] error:` format. Keep `--help` and `--version` exit 0.
5.2 **Stdin handling** (H5): read stdin only when it is not a TTY **and** (no prompt was given, or `-` was passed as the prompt or `--stdin` was set). Add `--no-stdin`. When a prompt is given and stdin is a pipe, current behavior (append as `[Piped Input]`) requires the explicit `--stdin` flag, or document and keep it but add a read **idle timeout** (default 5 s without any data and no EOF, configurable by `ANT_STDIN_TIMEOUT`), returning a clear usage error. Decide with the owner; default in this plan: keep appending piped input when a prompt is given, but with the idle timeout and `--no-stdin` escape hatch. Install the lifecycle first (2.1) so Ctrl+C works while reading.
5.3 **Settings validation** (H9): validate the parsed settings object with a zod schema (types and ranges) and report all problems at once as a `ConfigError` with the file path. Keep unknown-key handling as warnings. Then **wire**: `settings.tools.<Name>.enabled` into `buildTools` (add `toolSettings` to `Config` and pass it through `agent.ts`), `streamRetries` into `streamText` (flag `--stream-retries` optional, default stays 1), and `passEnv` (`settings.bash.passEnv` or the existing key if present) into the tool context. Where a setting does not exist yet in `Settings`, add it with a test; do not invent behavior beyond wiring what the types already promise.
5.4 **Prompt sources**: move all prompt and flag validation (both `-p` and positional, `--continue` with `--resume`, empty prompt) into one `validateInvocation()` called before any I/O. **[U6]** ensure `ant threads` and other subcommand names are never parsed as a prompt; add a test.
5.5 **Thread resume model mismatch**: the engine silently updates `threads.model`. Keep, but record it in the `init` event (`modelChangedFrom`).
5.6 **Exit code table** (README): 0 completed; 1 `max_steps` / `truncated` / `empty_response`; 2 usage or config; 3 model or provider error; 4 timeout; 5 internal; 129 SIGHUP; 130 SIGINT; 141 broken pipe; 143 SIGTERM.

---

## 7. Phase 6: Test infrastructure

Add real coverage for the flows this plan changes. Unit tests alone did not catch B2.
- **Fake model**: use the AI SDK's test model utilities if present in the installed version (**[U1]**, look for a mock language model under `ai/test`); otherwise a small `src/test/fakeModel.ts` that streams scripted chunks with controllable delays. Allow injecting it through an env-gated provider `ANT_MODEL=fake/<script>` available **only when `NODE_ENV=test`** or a dedicated `ANT_TEST_PROVIDER=1`, so subprocess tests can drive the real CLI.
- **Subprocess harness** (`src/test/cli.ts`): spawn `bun src/main.ts ...` with a temp `ANT_HOME` and cwd, capture stdout, stderr, exit code, send signals at given moments, optionally under a pty (`script -qc`) for TTY behaviors.
- Required scenarios are listed in Phase 2 acceptance, Phase 3.8, Phase 4.5. Add a `bun run test:e2e` script separate from fast unit tests if the suite becomes slow.
- Every bug in section 1 gets a named regression test (B1, B1b, B2, I1, I2, I3, I5, H1, H5, H7, H8).

---

## 8. Phase 7: Documentation

- README: new "Headless usage" section: output modes, the stdout/stderr contract, schemas (link to `docs/schema/*.json`), exit code table, signal behavior (what SIGINT, SIGTERM, SIGHUP guarantee about the session and checkpoints), `--allow-ask`, stdin behavior, CI example (`ant -p ... -o json` with `jq` status check), session resume after interruption.
- `CHANGELOG.md` (create if missing): note the compact `json` output, the new `stream-json` format, additive `result` fields, `AskUser` now opt-in (**breaking** for anyone relying on it), stdin idle timeout.
- Bump `version` in `main.ts` and `package.json` consistently (read the version from `package.json` rather than a literal).

---

## 9. Execution order and gates

| Order | Phase | Gate to proceed |
|---|---|---|
| 1 | Phase 0 | baseline green, all U1-U6 answered in writing |
| 2 | Phase 1 (2.1, 2.2) | bugs B1, B1b, B2 have failing-then-passing regression tests |
| 3 | Phase 2 (lifecycle, engine, taxonomy, persistence, repair, tasks, checkpoint) | all signal and kill scenarios pass |
| 4 | Phase 3 (AskUser) | tests in 3.8 pass |
| 5 | Phase 4 (output contract) | subprocess stream-json test and error-path tests pass |
| 6 | Phase 5 (CLI and config) | stdin hang test and commander exit code tests pass |
| 7 | Phase 6 and 7 | docs complete; full `bun test` and typecheck green |

Commit per numbered step with a message referencing the finding id (for example `fix(engine): abort with reason instead of assigning signal.reason (B2)`).

## 10. Definition of done

- `Ctrl+C` at any point in a run: no stack trace, exit 130, thread resumable, no lease left, no child process left, checkpoints intact.
- `ant -e high -p "..."` produces no warning and demonstrably changes provider request options (verified by a unit test on the generated options).
- Without `--allow-ask`, the model is never offered `AskUser`.
- In `json` and `stream-json` modes, stdout is always valid JSON ending in one `result` record, on success and on every failure path; exit code equals `result.exitCode`.
- All findings in section 1 are either fixed with a regression test or explicitly recorded as deferred with a reason in the CHANGELOG.

## 11. Out of scope (do not do)

Interactive UI, new tools, new providers, input stream-json (`--input-format`), `--json-schema` structured model output, cost budgets, and background-session management. These are good follow-ups once this plan lands.


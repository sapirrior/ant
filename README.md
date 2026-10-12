# ant

A fast, daily-use, streaming, model-agnostic AI agent CLI for developers. Built on [Bun](https://bun.sh) with atomic SQLite storage, content-addressed CAS file checkpoints, allowlist Bash security policy, and background task management.

`ant` is engineered to do one thing and do it extremely well: execute developer instructions autonomously in the terminal and in automated workflows, streaming diagnostics to `stderr` and clean machine or human outputs to `stdout`.

---

## Key Features

* **Autonomous Execution:** Designed for non-blocking terminal runs, automation, subagents, and headless CI pipelines. Never blocks or deadlocks on unanswerable interactive prompts.
* **Model Agnostic:** Works with Anthropic (`anthropic/...`), Google (`google/...`), OpenRouter (`openrouter/...`), and custom OpenAI-compatible endpoints (`custom/...`). Preflight credential validation checks keys before creating threads.
* **Storage & Threads (`ant threads`):** SQLite (`$ANT_HOME/ant.db`) in WAL mode with process-level leases (`lock_pid`). Multi-turn sessions persist AI SDK messages verbatim with automatic interrupted session repair on load.
* **Content-Addressed CAS Checkpoints (`ant checkpoints`):** Every file modification (`WriteFile`, `EditFile`, `DeleteFile`) snapshots contents with SHA-256 before mutating. Conflicted workspace edits prevent accidental overwrites unless `--force` is provided. Rewind cleanly with `ant checkpoints restore <n>`.
* **Safe Bash Policy & TaskManager:** Allowlist command classifier (`safe`, `ask`, `blocked`). Commands taking longer than the foreground window automatically migrate to background tasks (`TaskManager`) with non-blocking output cursors and graceful shutdown.
* **Web Tools (`WebSearch` & `WebFetch`):** Public informational web searches via DuckDuckGo and readable HTML-to-markdown chunked fetching.
* **Reasoning Control:** Configure thinking effort (`provider-default`, `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`) via `--effort <level>` or `ant config set effort <level>`.
* **Headless Streaming & Machine Envelopes:** Real-time event streaming (`-o stream-json`) emitting compact NDJSON lines (`init`, `text`, `tool_call`, `tool_result`, `step`, and terminal `result`), or compact single-line JSON (`-o json`).

---

## Installation

### Prerequisites
* [Bun](https://bun.sh) >= 1.2
* Linux or macOS

```bash
git clone https://github.com/your-username/ant.git
cd ant

# Install dependencies (use npm on Android/Termux environments)
npm install

# Run typecheck and tests
bun run typecheck
bun test

# Build compiled standalone binary
bun run build
```

---

## Configuration & Precedence

Precedence order:
1. **CLI flags** (`--model`, `--timeout`, `--effort`, etc.)
2. **Environment variables** (`ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `ANT_HOME`)
3. **Persisted settings** (`$ANT_HOME/settings.json`, default `~/.ant/settings.json`)

### Settings CLI (`ant config`)

```bash
# View path to settings.json
ant config path

# View all active settings
ant config get

# Set persistent default model and reasoning effort
ant config set model google/gemini-2.5-flash
ant config set effort medium

# Set capability defaults and timeout
ant config set allow.read true
ant config set allow.bash true
ant config set timeout 10m

# Remove a setting
ant config unset timeout
```

---

## Usage & Workflows

### 1. Direct Instructions
```bash
# Ask a direct question
ant "Explain the difference between interface and type in TypeScript"

# Inspect files in the workspace
ant --allow-read "Find all failing tests in this project"

# Make surgical file edits
ant --allow-edit "Fix the typo in src/main.ts"

# Run shell commands
ant --allow-bash "Run tests and summarize failures"

# Search web and fetch reference documentation
ant "Find the latest release notes for Bun and summarize them"
```

### 2. Multi-Turn Sessions & Resuming
```bash
# Turn 1
ant --allow-read "Inspect package.json and list direct dependencies"

# Turn 2: Continues previous thread in the current working directory
ant --continue "Which of these are outdated?"

# Resume a specific thread by ID
ant --resume <thread_id> "What was the last change we discussed?"

# Manage threads
ant threads list
ant threads show <id> --messages
ant threads rename <id> "Refactor task"
ant threads delete <id> -y
```

### 3. Checkpoints & Workspace Rewind
```bash
# Inspect checkpoints created by file operations
ant checkpoints list

# Preview rewinding to before checkpoint #2
ant checkpoints restore 2 --dry-run

# Restore workspace files to before checkpoint #2
ant checkpoints restore 2
```

---

## Headless & Pipeline Integration

`ant` is purpose-built for Unix pipes, scripts, subagents, and CI runners:
- Diagnostics, warnings, and tool status stream to `stderr`.
- Result text or structured machine data emits cleanly to `stdout`.

### Single JSON Output (`-o json`)
Emits a single-line JSON envelope upon completion:
```bash
ant -p "Summarize package.json" --allow-read -o json | jq '.status, .text'
```

### Streaming NDJSON Events (`-o stream-json`)
Streams one JSON event per line as execution progresses:
```bash
ant -p "Run tests" --allow-bash -o stream-json
```

Event lifecycle:
1. `init`: Emitted immediately with session ID, model, cwd, and active capabilities.
2. `text`: Delta chunks for generated text.
3. `tool_call`: When a tool is invoked (inputs > 64 KiB truncated).
4. `tool_result`: Tool execution outcome, duration, and output.
5. `step`: Step completion metadata and token usage.
6. `result`: Exactly one terminal envelope containing exit code, final status, total steps, and usage.

---

## CLI Options

| Flag | Description |
|---|---|
| `-p, --prompt <text>` | Instruction prompt for the agent |
| `-m, --model <id>` | Language model (`provider/model-id`) |
| `-e, --effort <level>` | Reasoning effort (`provider-default`, `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`) |
| `-c, --continue` | Continue the latest thread in current directory |
| `-r, --resume <id>` | Resume a specific thread by ID or prefix |
| `--allow-read` | Grant `fs.read` capability |
| `--allow-edit` | Grant `fs.read` and `fs.write` capabilities |
| `--allow-bash` | Grant `shell.run` capability |
| `--allow-destructive-bash` | Grant `shell.destructive` capability (skips prompts) |
| `-t, --timeout <dur>` | Hard execution timeout (e.g. `30s`, `10m`) |
| `-s, --max-steps <num>` | Maximum tool execution steps (default: 30) |
| `-o, --output <format>` | Output format (`text`, `md`, `json`, `stream-json`) |
| `-l, --log-level <level>` | Log verbosity (`error`, `info`, `debug`) |
| `--theme <theme>` | Terminal theme (`auto`, `dark`, `light`, `ansi`) |

---

## Exit Codes

| Code | Status | Meaning |
|---|---|---|
| `0` | `completed` | Run finished successfully |
| `1` | `max_steps` / `truncated` / `empty_response` | Model hit step cap, length cap, or empty response |
| `2` | `usage_error` | Invalid arguments or configuration error |
| `3` | `model_error` | Provider API error after retries |
| `4` | `timeout` | Wall-clock execution timeout reached |
| `5` | `internal_error` | Unexpected internal failure |
| `129` | `cancelled` | Terminal disconnect or hangup (SIGHUP) |
| `130` | `cancelled` | Interrupted by user signal (SIGINT / Ctrl-C) |
| `143` | `cancelled` | Terminated by system signal (SIGTERM) |

---

## Security Model & Guidelines

1. **Bash Classifier:** Command tokens are verified against an AST allowlist. Mutating or ambiguous operations require explicit capabilities (`--allow-destructive-bash`). Prompt injections can still run allowed commands; do not grant shell access on untrusted repositories.
2. **File Mutation Checkpoints:** Content snapshots protect against unintended edits via `WriteFile`, `EditFile`, and `DeleteFile`. Modifications made directly by shell commands or external tools are detected as conflicts during restoration.
3. **Subprocess Scoping:** Background tasks launched via `TaskManager` terminate cleanly with `ant` during graceful teardown or emergency signals.
4. **Secrets Protection:** Sensitive files (`.env`, `*.pem`, `id_rsa`, `.ssh/*`) are denied by file tools. Tool results are recorded locally in `$ANT_HOME/ant.db` (file mode `0600`).
5. **Supported OS:** Supported on Linux and macOS. Windows is not supported.

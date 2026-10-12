# ant

A fast, daily-use, streaming, model-agnostic AI agent CLI for developers. Built on [Bun](https://bun.sh) with atomic SQLite storage, content-addressed CAS file checkpoints, allowlist Bash security policy, and background task management.

`ant` runs directly in your terminal, executes tools safely with capability-based security, streams diagnostics to `stderr`, and writes clean final answers to `stdout` for Unix piping.

---

## Highlights

* **Model Agnostic:** Works with Anthropic (`anthropic/...`), Google (`google/...`), OpenRouter (`openrouter/...`), and custom endpoints (`custom/...`). Preflight key validation checks credentials before creating threads.
* **Storage & Threads (`ant threads`):** SQLite (`$ANT_HOME/ant.db`) in WAL mode with process-level leases (`lock_pid`). Multi-turn sessions persist AI SDK `ModelMessage[]` verbatim.
* **Rewindable Checkpoints (`ant checkpoints`):** Every file modification (`WriteFile`, `EditFile`, `DeleteFile`) records a SHA-256 content-addressed snapshot. Rewind cleanly with `ant checkpoints restore <n>`.
* **Safe Bash Policy & TaskManager:** AST/token allowlist classifier (`safe`, `ask`, `blocked`). Slow foreground commands automatically hand off to background tasks (`TaskManager`) with streaming output cursors.
* **Web Tools (`WebSearch` & `WebFetch`):** Production-grade DuckDuckGo HTML scraping and readable HTML-to-markdown chunked fetching.
* **Reasoning Control:** Configure thinking effort via `--effort <level>` or `ant config set effort <level>`.
* **Unix Pipe Friendly:** Streams real-time tool logs to `stderr`. Final answers emit cleanly to `stdout` without ANSI clutter.

---

## Installation

### Prerequisites
* [Bun](https://bun.sh) >= 1.2
* Linux or macOS

```bash
git clone https://github.com/your-username/ant.git
cd ant

# Install dependencies (use npm, not bun install on Android/Termux environments)
npm install

# Run typecheck and tests
bun run typecheck
bun test

# Build compiled binary
bun run build
```

---

## Configuration & Precedence

Settings precedence:
1. **CLI flags** (`--model`, `--timeout`, `--effort`, etc.)
2. **Environment variables** (`ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `ANT_HOME`)
3. **Persisted settings** (`$ANT_HOME/settings.json`, default `~/.ant/settings.json`)

### Settings CLI (`ant config`)

```bash
# View path to settings.json
ant config path

# View all settings
ant config get

# Set persistent default model and reasoning effort
ant config set model google/gemini-2.5-flash
ant config set effort medium

# Set permissions and timeouts
ant config set allow.read true
ant config set timeout 10m

# Remove a setting
ant config unset timeout
```

---

## Usage & Commands

### 1. Run Instructions
```bash
# Ask a direct question
ant "Explain the difference between interface and type in TypeScript"

# Inspect files in workspace
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
ant --allow-read "Inspect package.json and list our direct dependencies"

# Turn 2: Continues previous thread in the current working directory
ant --continue "Which of these are outdated?"

# Manage threads
ant threads list
ant threads show <id> --messages
ant threads rename <id> "New thread title"
ant threads delete <id> -y
```

### 3. Checkpoints & Rewind
```bash
# Inspect checkpoints created by tool edits
ant checkpoints list

# Dry-run rewinding to before checkpoint #2
ant checkpoints restore 2 --dry-run

# Restore files to state before checkpoint #2
ant checkpoints restore 2
```

---

## CLI Options

| Flag | Description |
|---|---|
| `-p, --prompt <text>` | User prompt or instruction |
| `-m, --model <id>` | Language model (`provider/model-id`) |
| `--effort <level>` | Reasoning effort (`none`, `low`, `medium`, `high`, etc.) |
| `-c, --continue` | Continue the latest thread in current directory |
| `-r, --resume <id>` | Resume a specific thread by ID or prefix |
| `--allow-read` | Grant `fs.read` capability |
| `--allow-edit` | Grant `fs.read` and `fs.write` capabilities |
| `--allow-bash` | Grant `shell.run` capability |
| `--allow-destructive-bash` | Grant `shell.destructive` capability (skips prompts) |
| `--timeout <dur>` | Hard execution timeout (e.g. `30s`, `10m`) |
| `--output <format>` | Output format (`text`, `md`, `json`) |
| `--log-level <level>` | Verbosity (`error`, `info`, `debug`) |
| `--theme <theme>` | Terminal theme (`auto`, `dark`, `light`, `ansi`) |

---

## Exit Codes

| Code | Status | Meaning |
|---|---|---|
| `0` | `completed` | Run finished successfully |
| `1` | `max_steps` / `truncated` / `empty_response` | Model hit step cap, length cap, or empty output |
| `2` | `usage_error` | Invalid arguments or configuration error |
| `3` | `model_error` | Provider API error after retries |
| `4` | `timeout` | Wall-clock execution timeout reached |
| `5` | `internal_error` | Unexpected application failure |
| `130` | `cancelled` | Interrupted by user signal (SIGINT / Ctrl-C) |
| `143` | `cancelled` | Terminated by system signal (SIGTERM) |

---

## Security Model & Known Limits

1. **Bash is not a sandbox:** The bash classifier checks command tokens against an allowlist and prompts for mutating operations. Prompt injections can still run unintended allowed commands. Do not run `ant` with `--allow-bash` on untrusted repositories.
2. **Checkpoints track file tools only:** Checkpoints capture `WriteFile`, `EditFile`, and `DeleteFile`. Modifications caused by Bash commands or external git tools are not recorded; `restore` detects external changes as conflicts and refuses to overwrite them without `--force`.
3. **Background tasks lifetime:** Background processes started via `TaskManager` run as child processes and terminate when `ant` exits. They do not run as persistent daemons.
4. **Secrets at rest:** File tools deny sensitive files (`.env`, `*.pem`, `id_rsa`, `.ssh/*`). However, tool execution outputs are persisted in `$ANT_HOME/ant.db` (file mode `0600`).
5. **Operating Systems:** Supported on Linux and macOS (`/dev/tty`, POSIX process groups). Windows is not supported.

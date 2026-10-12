# ant

A fast, daily-use, streaming, model-agnostic AI agent CLI for developers.

`ant` runs directly in your terminal, executes tools safely with capability-based security, streams diagnostics to `stderr`, and writes clean final answers to `stdout` for seamless Unix piping.

---

## Highlights

* **Model Agnostic:** Works with Anthropic (`anthropic/claude-3-7-sonnet-20250219`), Google (`google/gemini-2.5-flash`), OpenRouter (`openrouter/...`), and custom OpenAI-compatible endpoints (`custom/...`).
* **Unix Pipe Friendly:** Streams real-time tool logs and token metrics to `stderr`. The final answer is emitted cleanly to `stdout` without ANSI clutter.
* **Capability-Based Security:** Strict **default-deny** policy. Granular flags (`--allow-read`, `--allow-edit`, `--allow-bash`, `--allow-destructive-bash`) unlock capabilities explicitly.
* **Non-Interactive Multi-Turn:** Resume conversations cleanly without complex TUIs via `--continue` or `--resume <thread_id>`.
* **Predictable Tool Execution:** Parallel tool calls from the model are serialized sequentially through an internal execution queue, preventing race conditions.
* **Human-in-the-Loop (`AskUser`):** Prompts for input on genuine ambiguity, and degrades gracefully in non-interactive CI/piped environments.

---

## Installation

### Prerequisites
* [Node.js](https://nodejs.org) >= 22 or [Bun](https://bun.com) >= 1.2

### Setup
```bash
# Clone the repository
git clone https://github.com/your-username/ant.git
cd ant

# Install dependencies
npm install

# Build standalone binary (optional)
bun run build
```

---

## Quickstart

### 1. Set Your Provider API Key
Set your provider key in your shell environment:

```bash
# Anthropic
export ANTHROPIC_API_KEY="your-anthropic-key"

# Or Google Gemini
export GEMINI_API_KEY="your-gemini-key"

# Or OpenRouter
export OPENROUTER_API_KEY="your-openrouter-key"
```

### 2. Configure Default Model
Persist your preferred default model in `~/.ant/settings.json`:

```bash
ant config set model google/gemini-2.5-flash
```

### 3. Run Instructions
```bash
# Ask a direct question
ant "Explain the difference between interface and type in TypeScript"

# Inspect files in the current workspace
ant "Find all failing tests in this project" --allow-read

# Make targeted file edits
ant "Fix the typo in src/main.ts" --allow-edit

# Run shell commands
ant "Run tests and summarize failures" --allow-read --allow-bash
```

---

## Workflows

### Piping Input
Pipe terminal output directly into `ant`:

```bash
git diff | ant "Write a conventional git commit message for these changes"
cat build.log | ant "Explain why this build failed"
```

### Multi-Turn Conversations
Continue from your last session without leaving the command line:

```bash
# Turn 1
ant "Inspect package.json and list our direct dependencies" --allow-read

# Turn 2: Picks up context from the previous turn
ant --continue "Which of these are outdated?"
```

### JSON Output for Automation
```bash
ant "Count all export statements in src/main.ts" --allow-read --output json
```

---

## CLI Reference

### Commands
```text
ant [options] [prompt]    Run an instruction prompt (default action)
ant config                View current settings in ~/.ant/settings.json
ant config get <key>      Get a specific configuration value
ant config set <key> <val>Set a persistent configuration value
```

### Options
| Flag | Description |
|---|---|
| `-p, --prompt <text>` | Instruction prompt for the agent |
| `--model <provider/id>` | Model identifier (`provider/model-id`) |
| `--allow-read` | Allow reading files and directory listing (`fs.read`) |
| `--allow-edit` | Allow editing, writing, and deleting files (`fs.write`) |
| `--allow-bash` | Allow running safe shell commands (`shell.run`) |
| `--allow-destructive-bash` | Allow destructive shell commands (`shell.destructive`) |
| `--max-steps <num>` | Maximum tool execution loop iterations (default: `30`) |
| `--timeout <duration>` | Wall-clock execution timeout e.g. `30m`, `10s` (default: `30m`) |
| `--output <format>` | Output format: `text`, `md`, or `json` (default: `text`) |
| `--log-level <level>` | Log level: `error`, `info`, `debug` (default: `info`) |
| `--continue` | Continue the latest conversation thread |
| `--resume <thread_id>` | Resume a specific conversation thread by ID |
| `-h, --help` | Show help and options |
| `-V, --version` | Show version |

---

## License
MIT

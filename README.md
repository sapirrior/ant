# ant 🐜

> **A fast, model-agnostic AI agent CLI built for your daily terminal workflow.**

`ant` is an autonomous developer companion designed for speed, safety, and scripting. It runs your terminal tasks, inspects code, edits files, and connects to any AI provider—streaming output in real time without getting stuck on interactive prompts.

---

## ✨ Why ant?

* ⚡ **Model Agnostic** — Switch seamlessly between Anthropic, Google Gemini, OpenRouter, or custom OpenAI-compatible models.
* 🛡️ **Built-in Safety & Reversible Edits** — Automatic file snapshots before any modification. Made a mistake? Rewind with `ant checkpoints restore`.
* 🔒 **Safe Shell Execution** — Allowlist-based command analyzer prevents accidental or rogue destructive commands.
* 🔄 **Multi-turn Context & Resumable Sessions** — Continue conversations right where you left off in any repository.
* 🌐 **Built-in Search & Web Fetch** — Search the web and read documentation directly within the agent loop.
* 🤖 **Pipe & Automation Friendly** — Clean `stdout` for pipes and scripts (`-o json` or `-o stream-json`), with rich diagnostics sent to `stderr`.

---

## 🚀 Quickstart

### 1. Install

```bash
git clone https://github.com/your-username/ant.git
cd ant
npm install
bun run build
```

*(Prerequisites: [Bun](https://bun.sh) >= 1.2 on Linux or macOS)*

### 2. Configure Your Model

Set your API key and default model once:

```bash
# Google Gemini
export GEMINI_API_KEY="your-api-key"
ant config set model google/gemini-2.5-flash

# Or Anthropic Claude
export ANTHROPIC_API_KEY="your-api-key"
ant config set model anthropic/claude-3-7-sonnet-20250219
```

### 3. Run Your First Command

```bash
# Ask a direct question
ant "Explain how to write a custom middleware in Hono"

# Let ant inspect and fix your code
ant --allow-edit "Fix the failing tests in src/auth.ts"
```

---

## 💡 Daily Workflows & Examples

### 🔍 Codebase Inspection
```bash
ant --allow-read "Find all endpoints in this project and check for missing error handling"
```

### 🛠️ Surgical Edits & Refactoring
```bash
ant --allow-edit "Migrate all imports in src/ from CommonJS to ES modules"
```

### 💻 Autonomous Shell Runs & Testing
```bash
ant --allow-bash "Run test suite, find why tests failed, and give me a summary"
```

### 🔄 Multi-turn Conversations
```bash
# Start a task
ant --allow-read "Inspect package.json and list outdated dependencies"

# Follow up in the same thread
ant --continue "Which of these have breaking major version changes?"

# Resume a specific thread later
ant --resume <thread_id> "Let's proceed with upgrading the first package"
```

### ⏪ Instant Undo with Checkpoints
Every edit is backed up automatically:
```bash
# View recent changes made by ant
ant checkpoints list

# Preview rollback
ant checkpoints restore 1 --dry-run

# Restore files to before the change
ant checkpoints restore 1
```

---

## ⚙️ Configuration

Settings are saved in `~/.ant/settings.json` and can be managed with `ant config`:

```bash
ant config get                       # View current configuration
ant config set model <provider/id>   # Set default model
ant config set allow.read true       # Enable read permission by default
ant config set allow.bash true       # Enable bash permission by default
ant config set effort medium         # Set reasoning effort (low, medium, high)
ant config set timeout 10m           # Set default task timeout
```

**Precedence:** CLI flags > Environment variables > Saved settings.

---

## 🔌 Headless & Scripting (CI/CD)

Integrate `ant` into your shell scripts, editors, or CI pipelines:

```bash
# Single JSON result to stdout
ant -p "Summarize git diff" --allow-read -o json | jq -r '.text'

# Real-time event stream (NDJSON)
ant -p "Build project" --allow-bash -o stream-json
```

### 🐜 Dogfooding: `ant` Releases `ant`

We believe in using what we build. In our GitHub Actions release pipeline, `ant` runs autonomously to draft its own release notes:
1. Whenever a version tag (e.g. `v0.1.1`) is pushed, CI cross-compiles all binaries and extracts the git diff.
2. `ant` is called in headless mode with `google/gemini-flash-lite-latest` to read the commits and diff stats.
3. `ant` synthesizes executive summaries, highlights, and categorized changelogs directly into GitHub Releases.

Every release note you see on the [Releases page](https://github.com/sapirrior/ant/releases) was written by `ant` itself! 🚀

---

## 📖 CLI Reference

| Flag | Description |
|---|---|
| `-p, --prompt <text>` | Instruction prompt (or pass as argument / pipe via stdin) |
| `-m, --model <id>` | Target model (`google/...`, `anthropic/...`, `openrouter/...`) |
| `-e, --effort <level>` | Reasoning effort (`none`, `low`, `medium`, `high`, `max`) |
| `--allow-read` | Allow reading files and directories |
| `--allow-edit` | Allow editing and writing files |
| `--allow-bash` | Allow running safe shell commands |
| `--allow-destructive-bash` | Allow destructive shell commands |
| `-c, --continue` | Continue the latest session in the current directory |
| `-r, --resume <id>` | Resume a specific session by thread ID |
| `-o, --output <format>` | Output format: `text`, `md`, `json`, `stream-json` |
| `-t, --timeout <dur>` | Execution timeout (e.g. `30s`, `10m`) |
| `-s, --max-steps <num>` | Maximum tool execution steps (default: 30) |

---

## 📄 License

MIT

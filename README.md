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
* 🔌 **Model Context Protocol (MCP)** — Seamlessly connect stdio or HTTP/SSE servers globally (`~/.ant/mcp.json`) or per project (`.ant/mcp.json`).
* 🤖 **Pipe & Automation Friendly** — Clean `stdout` for pipes and scripts (`-o json` or `-o stream-json`), with rich diagnostics sent to `stderr`.

---

## 🚀 Quickstart

### 1. Install

**Using the official installer (Recommended):**
```bash
curl -fsSL https://raw.githubusercontent.com/sapirrior/ant/main/installer/install.sh | bash
```

**Or build from source:**
```bash
git clone https://github.com/sapirrior/ant.git
cd ant
npm install
bun run build
```

### 2. Configure Your Model

`ant` features a modular provider adapter architecture powered by the Vercel AI SDK. Set your API key and default model once:

```bash
# Google Gemini (with developer-grade safety thresholds)
export GEMINI_API_KEY="your-api-key"
ant config set model google/gemini-2.5-flash

# Anthropic Claude (with automatic ephemeral prompt caching)
export ANTHROPIC_API_KEY="your-api-key"
ant config set model anthropic/claude-3-7-sonnet-20250219

# OpenAI (with automatic server-side prefix caching)
export OPENAI_API_KEY="your-api-key"
ant config set model openai/gpt-4o

# Groq (Ultra-fast LPU inference)
export GROQ_API_KEY="your-api-key"
ant config set model groq/llama-3.3-70b-versatile

# xAI Grok
export XAI_API_KEY="your-api-key"
ant config set model xai/grok-2-1212

# DeepSeek (Reasoner & automatic context caching)
export DEEPSEEK_API_KEY="your-api-key"
ant config set model deepseek/deepseek-chat

# OpenRouter (Multi-model gateway)
export OPENROUTER_API_KEY="your-api-key"
ant config set model openrouter/openrouter/free

# Ollama (Local, offline, zero API key required by default)
ant config set model ollama/llama3
# Optional custom base URL & key: export OLLAMA_BASE_URL="http://192.168.1.50:11434/v1"

# Custom OpenAI-Compatible Endpoints
export ANT_CUSTOM_BASE_URL="http://localhost:8000/v1"
ant config set model custom/my-model
```

### ⚡ Built-in Provider Optimizations
- **Anthropic Prompt Caching**: System instructions and conversation context automatically receive ephemeral cache breakpoints (`cacheControl: { type: 'ephemeral' }`), cutting input costs by up to 90% and slashing latency on multi-turn sessions.
- **Google Developer Safety Settings**: Gemini models run with developer-tuned safety thresholds (`BLOCK_ONLY_HIGH`) to avoid false-positive refusals during codebase inspection, bash scripts, and regex audits.
- **OpenAI & DeepSeek Prefix Caching**: Prompt structure and tool declarations maintain strict deterministic ordering for optimal server-side prefix cache hit rates.

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

### 🔌 Model Context Protocol (MCP)
Extend `ant` with external tools via MCP:

```bash
# Add a local stdio MCP server (e.g., SQLite, Git, Filesystem)
ant mcp add git --command "mcp-server-git" --args "--repository" "."

# Add a remote HTTP/SSE MCP server
ant mcp add browserless --url "https://mcp.browserless.io/mcp" --header "Authorization=Bearer <token>"

# Add to global config (~/.ant/mcp.json) instead of project
ant mcp add my-tool --command "npx" --args "-y" "my-mcp-tool" --global

# List configured servers across project and global scopes
ant mcp list

# Enable or disable servers without deleting them
ant mcp disable git
ant mcp enable git

# Pre-authorize MCP tools during run (or use interactive confirmation)
ant "Analyze git log" --allow-mcp "git/*"

# Explicitly deny specific MCP tools during run
ant "Analyze repo" --deny-mcp "git/delete_repo"
```

---

## ⚙️ Configuration

Settings are saved in `~/.ant/settings.json` and can be managed with `ant config`:

```bash
ant config                           # View current configuration
ant config get model                 # Get specific configuration value
ant config set model <provider/id>   # Set default model
ant config set allow.read true       # Enable read permission by default
ant config set allow.bash true       # Enable bash permission by default
ant config set allow.mcp "git/*"     # Pre-authorize MCP tools by default
ant config set deny.mcp "git/delete" # Deny specific MCP tools by default
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
| `--allow-mcp <patterns...>` | Pre-authorize MCP tools (e.g. `github/*`, `db/query`, or `*`) |
| `--deny-mcp <patterns...>` | Explicitly deny MCP tools during execution |
| `-c, --continue` | Continue the latest session in the current directory |
| `-r, --resume <id>` | Resume a specific session by thread ID |
| `-o, --output <format>` | Output format: `text`, `md`, `json`, `stream-json` |
| `-t, --timeout <dur>` | Execution timeout (e.g. `30s`, `10m`) |
| `-s, --max-steps <num>` | Maximum tool execution steps (default: 30) |

---

## 📄 License

MIT

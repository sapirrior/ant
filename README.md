<div align="center">

# 🐜 ant

### **The post-modern autonomous print agent.**

*Terminal-native. Model-agnostic. Headless by design. Instant time-travel rollback.*

[![Version](https://img.shields.io/badge/version-0.10.0-blue.svg?style=flat-square)](package.json)
[![Runtime](https://img.shields.io/badge/runtime-Bun%20Only-black.svg?style=flat-square)](https://bun.sh)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg?style=flat-square)](LICENSE)

```bash
git diff | ant "Review this patch for edge cases and regressions"
```

</div>

---

## ⚡ What is `ant`?

Most AI engineering agents want to be your chat room. They lock your terminal behind full-screen TUIs, demand manual interactive approvals for every single file edit, trap you in proprietary provider ecosystems, and leave no trace when an autonomous edit goes wrong.

**`ant` is built differently.**

Designed around the Unix philosophy, `ant` runs as a high-velocity, headless **print agent**. It executes one-shot tasks, performs multi-file surgical refactors, connects to external tools via MCP, and emits clean text or structured streams directly to `stdout`—while keeping all diagnostics, live progress, and headers on `stderr`.

No interactive prompts. No `/dev/tty` blocking. Just pure terminal autonomy.

---

## 🌟 Superpowers

```
                                  ┌───────────────────────────┐
                                  │   ant -p "Fix auth bug"   │
                                  └─────────────┬─────────────┘
                                                │
                 ┌──────────────────────────────┼──────────────────────────────┐
                 ▼                              ▼                              ▼
      ┌─────────────────────┐        ┌─────────────────────┐        ┌─────────────────────┐
      │   Model Agnostic    │        │ Time-Travel Rollback│        │  Unix Composability │
      │ Gemini, Claude,     │        │ Instant CAS snapshot│        │ stdout: Clean result│
      │ OpenAI, DeepSeek,   │        │ before every edit   │        │ stderr: Diagnostics │
      │ Ollama (Local)      │        │ ant checkpoints undo│        │ pipes cleanly to jq │
      └─────────────────────┘        └─────────────────────┘        └─────────────────────┘
```

### 1. 🖨️ True Print-Native Execution
Feed it a prompt directly (`ant "Fix auth bug"` or `ant -p "Fix auth bug"`), stream results in real time, and let your scripts inspect standard POSIX exit codes (`0` for success, non-zero for failures). `-p/--print` is supported for backward compatibility, but optional—positional prompts run immediately. Perfect for local CLI aliases, git hooks, and unattended CI/CD runners.

### 2. ⏪ Time-Travel Checkpoints (Instant Undo)
Never worry about an autonomous agent corrupting your codebase. Before modifying, creating, or deleting a file, `ant` creates content-addressed snapshots in a lightweight local SQLite store. If an edit wasn't what you wanted, preview and rewind instantly:
```bash
ant checkpoints restore 1
```

### 3. 🌐 Zero Provider Lock-In
Switch models with a single flag. Powered by the Vercel AI SDK, `ant` comes out of the box with tuned adapters for:
* **Anthropic** (automatic ephemeral prompt caching)
* **Google Gemini** (developer-grade safety settings)
* **OpenAI & DeepSeek** (server-side prefix cache alignment)
* **Groq & xAI** (ultra-fast inference)
* **Ollama** (offline, 100% private local models)
* **OpenAI-Compatible** custom gateways

### 4. 🛡️ Deterministic Permission Policies
Unattended runs should never hang waiting for a human to press `[y/N]`. Tool access is governed by strict, declarative modes:
* `default` — Safe read-only inspection. Workspace file edits and Bash commands require explicit allow rules.
* `acceptEdits` — Auto-approves workspace file edits (`WriteFile`, `EditFile`, `DeleteFile`); isolates shell commands.
* `plan` — Pure reconnaissance; mutating tools are hidden from the model.
* `bypassPermissions` — Full autonomous execution (can still be bounded with `--disallowed-tools`).

### 5. 🔄 Resumable Sessions & Context Continuation
Continue a multi-turn conversation thread seamlessly (`ant -p -c "Now write unit tests"`), swap the model mid-session, or run fully ephemeral runs with `--no-session-persistence`.

---

## 🚀 Quickstart in 30 Seconds

### 1. Install

```bash
# Instant installer
curl -fsSL https://raw.githubusercontent.com/sapirrior/ant/main/installer/install.sh | bash

# Or build from source
git clone https://github.com/sapirrior/ant.git && cd ant
bun install && bun run build
```

### 2. Configure Your Provider

Set your key and default model once:

```bash
# Google Gemini
export GEMINI_API_KEY="your-api-key"
ant config set model google/gemini-2.5-flash

# Anthropic
export ANTHROPIC_API_KEY="your-api-key"
ant config set model anthropic/claude-3-7-sonnet-20250219

# OpenAI
export OPENAI_API_KEY="your-api-key"
ant config set model openai/gpt-4o

# Local Ollama (zero API key required)
ant config set model ollama/llama3
```

### 3. Run

```bash
# Ask questions directly (rendered Markdown in terminal, plain text in pipes)
ant "Explain the design patterns used in src/core"

# Autonomous coding with safe file edits
ant "Refactor src/utils/format.ts to export visibleWidth" --permission-mode acceptEdits

# Allow specific shell test commands
ant "Fix the failing test in agent.test.ts" --permission-mode acceptEdits --allowed-tools "Bash(bun test *)"
```

---

## 🛡️ Declarative Permission System

In `ant`, tool security is governed by a single, transparent declarative permission system. There are no hidden classifiers or unexpected prompts.

### Evaluation Order (Deterministic)
1. **Disallowed Rules (`--disallowed-tools`)**: If any deny rule matches, the tool is immediately **denied**. Deny rules always win, even over `--dangerously-skip-permissions`.
2. **Bypass Mode (`bypassPermissions`)**: If `--dangerously-skip-permissions` is active, the tool is allowed.
3. **Allowed Rules (`--allowed-tools`)**: If an explicit allow rule matches, the tool is allowed.
4. **Mode Defaults**:
   - `default`: Read-only tools (`ReadFile`, `ListDir`, `Grep`, `WebSearch`, `WebFetch`) and `TaskManager` are allowed. Edits and Bash require explicit rules.
   - `acceptEdits`: Local workspace file mutations (`WriteFile`, `EditFile`, `DeleteFile`) are also auto-approved. Shell commands require explicit rules.
   - `plan`: Pure reconnaissance mode. Mutating tools are hidden from the model.
5. **Deny with Actionable Fix**: If no rule or mode default permits the tool, it is denied with a message telling you the exact rule needed:
   `"Permission denied: Bash(git status) not allowed in mode default. Allow with --allowed-tools 'Bash(git status)'."`

### Pattern Syntax
| Tool | Target Matched | Pattern Syntax | Examples |
| :--- | :--- | :--- | :--- |
| `Bash` | Command string | Token-boundary prefix matching. **Compound chaining (`; & \| \n \` $()` is strictly rejected** on scoped allow rules. | `Bash(git *)`, `Bash(bun test *)`, `Bash(ant --version)` |
| Filesystem (`ReadFile`, `WriteFile`, `EditFile`, `DeleteFile`, `Grep`) | POSIX path normalized relative to workspace root | High-performance `Bun.Glob`. `*` matches files in root directory; `**` matches recursively. Sensitive files (`.env`, `id_rsa`) require explicit rules. | `ReadFile(*)`, `WriteFile(src/**/*)`, `EditFile(*.json)`, `ReadFile(.env)` |
| `WebFetch` | URL hostname | Glob match on hostname. Private/loopback IPs (SSRF) strictly prohibited. | `WebFetch(*.github.com)`, `WebFetch(bun.sh)` |
| `McpTool` | `server/tool` | Glob match on server name and tool name. | `McpTool(github/*)`, `McpTool(context7/get_*)` |

### Managing Persistent Rules
You can manage permissions in `~/.ant/settings.json` using the `ant config` subcommands:
```bash
# Add a rule to the allowed list
ant config add allowedTools "Bash(git *)"
ant config add allowedTools "Bash(bun test *)"

# Remove a specific rule
ant config remove allowedTools "Bash(git *)"

# Deny dangerous commands permanently
ant config add disallowedTools "Bash(rm *)"

# Clear all rules
ant config unset allowedTools
```

---

## 💡 Real-World Recipes

### 🔍 Pipe Git Diffs for Instant Code Review
```bash
git diff main | ant "Review this patch for memory leaks, performance bugs, and edge cases"
```

### 📊 Extract Structured JSON for CI Automation
```bash
ant "List all exported functions in src/tools/index.ts" -o json | jq -r '.result'
```

### ⚡ Stream Real-Time NDJSON Events
```bash
ant "Build project and inspect compiler output" -o stream-json | grep --line-buffered '"type":"tool-call"'
```

### 🔄 Multi-turn Iteration
```bash
# Start a task
ant "Inspect package.json and identify dependencies that have major version bumps"

# Follow up in the same thread
ant -c "Which of those major updates introduce breaking changes?"

# Resume any past session by ID
ant -r th_1792139027_b1efa8d0 "Let's begin upgrading the first package"
```

### ⏪ Checkpoint Rewind (Undo Mistakes)
```bash
# View all recent changes made by ant
ant checkpoints list

# Dry-run preview of what rolling back checkpoint #1 would do
ant checkpoints restore 1 --dry-run

# Restore files to exact state before the change
ant checkpoints restore 1
```

---

## 🎛️ CLI Reference

```
Usage: ant [options] [prompt]

The post-modern autonomous print agent

Arguments:
  prompt                                Instruction prompt for the agent (optional; runs immediately)

Options:
  -p, --print                           Run non-interactively in print mode (optional)
  --permission-mode <mode>              default | plan | acceptEdits | bypassPermissions
  --allowed-tools <rule>                Allow tool rule (e.g. "Bash(git *)", "WriteFile(src/*)")
  --disallowed-tools <rule>             Deny tool rule (overrides allow rules)
  --dangerously-skip-permissions        Bypass all tool permission checks
  --tools <names>                       Filter exposed tools (e.g. "default" or "ReadFile,EditFile")
  -o, --output-format <format>          text | md | json | stream-json
  -m, --model <provider/model-id>       Model override (e.g. google/gemini-2.5-flash)
  -s, --max-turns <number>              Maximum interaction turns before stopping (default: 30)
  -t, --timeout <duration>              Wall-clock timeout e.g. "30m", "10s" (default: 30m)
  -e, --effort <level>                  Reasoning effort: none | minimal | low | medium | high | xhigh | max
  --bare                                Suppress ambient ~/.ant/settings.json and project MCP
  --no-session-persistence             Run ephemerally without saving history or snapshots
  -c, --continue                        Continue the latest conversation thread
  -r, --resume <thread_id>              Resume a specific conversation thread by ID
  -l, --log-level <level>               Log level: error | info | debug (default: info)
  --verbose                             Emit diagnostic progress to stderr
  --theme <theme>                       auto | dark | light | ansi (default: auto)
  -v, --version                         Output version number
  -h, --help                            Display help
```

---

## 📄 License

MIT © [sapirrior](https://github.com/sapirrior)

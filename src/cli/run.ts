import { realpathSync } from 'node:fs'
import { Command } from 'commander'
import { readPipedStdin } from '../core/input.ts'
import { resolveGrants } from '../policy/grants.ts'
import { Engine } from '../core/engine.ts'
import { resolveLanguageModel } from '../core/model.ts'
import { loadSettings, parseDurationMs, parseReasoning } from '../settings.ts'
import { parseIntStrict } from '../utils/number.ts'
import { notice } from '../output/notice.ts'
import type { Config, LogLevel, OutputFormat, Theme } from '../core/types.ts'

const collectMcp = (v: string, prev: string[]) => [
  ...prev,
  ...v.split(',').map((s) => s.trim()).filter(Boolean),
]

export function resolveOutputFormat(
  flagOutput?: string,
  envOutput?: string,
  settingsOutput?: string,
  isStdoutTTY: boolean = Boolean(process.stdout.isTTY)
): OutputFormat {
  const chosen = flagOutput ?? envOutput ?? settingsOutput
  if (chosen) {
    if (chosen !== 'text' && chosen !== 'md' && chosen !== 'json' && chosen !== 'stream-json') {
      throw new Error(`Invalid output format: "${chosen}". Allowed: text, md, json, stream-json`)
    }
    return chosen as OutputFormat
  }
  return isStdoutTTY ? 'md' : 'text'
}

export function registerRunCommand(program: Command): void {
  program
    .argument('[prompt]', 'Instruction prompt for the agent')
    .option('-p, --prompt <text>', 'Instruction prompt for the agent')
    .option('--allow-read', 'Grant capability to read files and list directories (fs.read)')
    .option('--no-allow-read', 'Deny capability to read files and list directories')
    .option('--allow-edit', 'Grant capability to write and edit files (fs.write)')
    .option('--no-allow-edit', 'Deny capability to write and edit files')
    .option('--allow-bash', 'Grant capability to run shell commands (shell.run)')
    .option('--no-allow-bash', 'Deny capability to run shell commands')
    .option('--allow-destructive-bash', 'Grant capability to run destructive shell commands (shell.destructive)')
    .option('--allow-sensitive', 'Grant capability to read sensitive files (fs.sensitive)')
    .option('--allow-mcp <pattern>', 'Pre-authorize MCP tool calls (e.g. "github/*", "db/query", or "*")', collectMcp, [])
    .option('--deny-mcp <pattern>', 'Explicitly deny MCP tool calls (e.g. "github/*", "db/query", or "*")', collectMcp, [])
    .option('-m, --model <provider/model-id>', 'Model to use (format: provider/model-id)')
    .option('-s, --max-steps <number>', 'Maximum tool execution steps')
    .option('-t, --timeout <duration>', 'Wall-clock timeout e.g. "30m", "10s"')
    .option('--retries <number>', 'Number of API request retries (0-10)')
    .option('-o, --output <format>', 'Output format: text | md | json | stream-json')
    .option('-l, --log-level <level>', 'Log level: error | info | debug')
    .option('--theme <theme>', 'Theme: auto | dark | light | ansi')
    .option('-e, --effort <level>', 'Reasoning effort: provider-default | none | minimal | low | medium | high | xhigh | max')
    .option('--reasoning <level>', 'Alias for --effort')
    .option('-c, --continue', 'Continue the latest conversation thread')
    .option('-r, --resume <thread_id>', 'Resume a specific conversation thread by ID')
    .action(async (positionalPrompt: string | undefined, options) => {
      try {
        if (options.continue && options.resume) {
          throw new Error('Cannot specify both --continue and --resume')
        }
        if (options.prompt && positionalPrompt) {
          throw new Error('Cannot specify both -p/--prompt flag and positional prompt')
        }

        const userSettings = loadSettings()
        const env = process.env
        const prompt = options.prompt ?? positionalPrompt

        // 2. Resolve model: CLI flag > env > settings.json (no hardcoded default)
        const rawModel = options.model ?? env.ANT_MODEL ?? userSettings.model
        if (!rawModel) {
          throw new Error(
            'No model configured. Specify --model <provider/model-id>, set ANT_MODEL, or run "ant config set model <provider/model-id>".'
          )
        }
        // Preflight model and credentials check
        resolveLanguageModel(rawModel, env)
        const model = rawModel

        // 3. Resolve maxSteps: CLI > env > settings > 30
        let maxSteps = 30
        if (options.maxSteps !== undefined) {
          maxSteps = parseIntStrict('--max-steps', options.maxSteps, { min: 1 })
        } else if (env.ANT_MAX_STEPS) {
          maxSteps = parseIntStrict('ANT_MAX_STEPS', env.ANT_MAX_STEPS, { min: 1 })
        } else if (userSettings.maxSteps !== undefined && userSettings.maxSteps > 0) {
          maxSteps = userSettings.maxSteps
        }

        // 4. Resolve timeout: CLI > env > settings > 30m
        const rawTimeout = options.timeout ?? env.ANT_TIMEOUT ?? userSettings.timeout ?? '30m'
        const timeoutMs = parseDurationMs(rawTimeout)

        // 5. Resolve retries: CLI > env > settings > 4
        let retries = 4
        if (options.retries !== undefined) {
          retries = parseIntStrict('--retries', options.retries, { min: 0, max: 10 })
        } else if (env.ANT_RETRIES) {
          retries = parseIntStrict('ANT_RETRIES', env.ANT_RETRIES, { min: 0, max: 10 })
        } else if (userSettings.retries !== undefined) {
          retries = userSettings.retries
        }

        // 6. Resolve output: CLI > env > settings > context-sensitive default (md on TTY, else text)
        const outputFormat = resolveOutputFormat(
          options.output,
          env.ANT_OUTPUT,
          userSettings.output,
          Boolean(process.stdout.isTTY)
        )

        // 7. Resolve logLevel: CLI > env > settings > info
        const logLevel = (options.logLevel ?? env.ANT_LOG_LEVEL ?? userSettings.logLevel ?? 'info') as LogLevel
        if (logLevel !== 'error' && logLevel !== 'info' && logLevel !== 'debug') {
          throw new Error(`Invalid log-level: "${logLevel}". Allowed: error, info, debug`)
        }

        // 8. Resolve theme: CLI > env > settings > auto
        const theme = (options.theme ?? env.ANT_THEME ?? userSettings.theme ?? 'auto') as Theme
        if (theme !== 'auto' && theme !== 'dark' && theme !== 'light' && theme !== 'ansi') {
          throw new Error(`Invalid theme: "${theme}". Allowed: auto, dark, light, ansi`)
        }

        // 9. Resolve reasoning effort: CLI > env > settings > undefined
        const rawEffort = options.effort ?? options.reasoning ?? env.ANT_EFFORT ?? env.ANT_REASONING ?? userSettings.reasoning
        const effort = rawEffort ? parseReasoning(String(rawEffort)) : undefined

        // 10. Resolve capability grants: CLI flag > settings > false (never env vars)
        const allowRead = options.allowRead !== undefined ? Boolean(options.allowRead) : Boolean(userSettings.allow?.read)
        const allowEdit = options.allowEdit !== undefined ? Boolean(options.allowEdit) : Boolean(userSettings.allow?.edit)
        const allowBash = options.allowBash !== undefined ? Boolean(options.allowBash) : Boolean(userSettings.allow?.bash)
        const allowDestructiveBash = options.allowDestructiveBash !== undefined ? Boolean(options.allowDestructiveBash) : Boolean(userSettings.allow?.destructiveBash)
        const allowSensitive = options.allowSensitive !== undefined ? Boolean(options.allowSensitive) : Boolean(userSettings.allow?.sensitive)

        const grants = resolveGrants({
          allowRead,
          allowEdit,
          allowBash,
          allowDestructiveBash,
          allowSensitive,
        })

        const allowedMcp = Array.isArray(options.allowMcp) && options.allowMcp.length > 0
          ? (options.allowMcp as string[])
          : undefined

        const deniedMcp = Array.isArray(options.denyMcp) && options.denyMcp.length > 0
          ? (options.denyMcp as string[])
          : undefined

        let workspaceRoot = process.cwd()
        try {
          workspaceRoot = realpathSync(process.cwd())
        } catch {}

        const stdinInput = await readPipedStdin()
        if (!prompt && !stdinInput && !options.continue && !options.resume) {
          throw new Error('No instruction provided. Pass a prompt via -p "..." or pipe input via stdin.')
        }

        const config: Config = {
          prompt,
          stdinInput,
          model,
          maxSteps,
          timeoutMs,
          retries,
          outputFormat,
          logLevel,
          theme,
          effort,
          grants,
          cwd: workspaceRoot,
          continueLatest: Boolean(options.continue),
          resumeThreadId: options.resume,
          allowedMcp,
          deniedMcp,
          settings: userSettings,
        }

        const engine = new Engine()
        const exitCode = await engine.run(config)
        process.exitCode = exitCode
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        notice.error(message)
        process.exitCode = 2
      }
    })
}

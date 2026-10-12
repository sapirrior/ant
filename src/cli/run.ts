import { Command } from 'commander'
import { readPipedStdin } from '../core/input.ts'
import { resolveGrants } from '../policy/grants.ts'
import { Engine } from '../core/engine.ts'
import { resolveLanguageModel } from '../core/model.ts'
import { loadSettings, parseDurationMs, parseReasoning } from '../settings.ts'
import type { Config, LogLevel, OutputFormat, Theme } from '../core/types.ts'

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
    .option('--no-allow-destructive-bash', 'Deny capability to run destructive shell commands')
    .option('-m, --model <provider/model-id>', 'Model to use (format: provider/model-id)')
    .option('-s, --max-steps <number>', 'Maximum tool execution steps')
    .option('-t, --timeout <duration>', 'Wall-clock timeout e.g. "30m", "10s"')
    .option('--retries <number>', 'Number of API request retries (0-10)')
    .option('-o, --output <format>', 'Output format: text | md | json')
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

        const stdinInput = await readPipedStdin()
        const userSettings = loadSettings()
        const env = process.env

        // 1. Resolve prompt
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
          const n = Number.parseInt(options.maxSteps, 10)
          if (Number.isNaN(n) || n <= 0) throw new Error(`Invalid --max-steps value: "${options.maxSteps}". Must be a positive integer.`)
          maxSteps = n
        } else if (env.ANT_MAX_STEPS) {
          const n = Number.parseInt(env.ANT_MAX_STEPS, 10)
          if (Number.isNaN(n) || n <= 0) throw new Error(`Invalid ANT_MAX_STEPS: "${env.ANT_MAX_STEPS}". Must be a positive integer.`)
          maxSteps = n
        } else if (userSettings.maxSteps !== undefined && userSettings.maxSteps > 0) {
          maxSteps = userSettings.maxSteps
        }

        // 4. Resolve timeout: CLI > env > settings > 30m
        const rawTimeout = options.timeout ?? env.ANT_TIMEOUT ?? userSettings.timeout ?? '30m'
        const timeoutMs = parseDurationMs(rawTimeout)

        // 5. Resolve retries: CLI > env > settings > 4
        let retries = 4
        if (options.retries !== undefined) {
          const n = Number.parseInt(options.retries, 10)
          if (Number.isNaN(n) || n < 0 || n > 10) throw new Error(`Invalid --retries value: "${options.retries}". Must be between 0 and 10.`)
          retries = n
        } else if (env.ANT_RETRIES) {
          const n = Number.parseInt(env.ANT_RETRIES, 10)
          if (Number.isNaN(n) || n < 0 || n > 10) throw new Error(`Invalid ANT_RETRIES: "${env.ANT_RETRIES}". Must be between 0 and 10.`)
          retries = n
        } else if (userSettings.retries !== undefined) {
          retries = userSettings.retries
        }

        // 6. Resolve output: CLI > env > settings > text
        const outputFormat = (options.output ?? env.ANT_OUTPUT ?? userSettings.output ?? 'text') as OutputFormat
        if (outputFormat !== 'text' && outputFormat !== 'md' && outputFormat !== 'json') {
          throw new Error(`Invalid output format: "${outputFormat}". Allowed: text, md, json`)
        }

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

        const grants = resolveGrants({
          allowRead,
          allowEdit,
          allowBash,
          allowDestructiveBash,
        })

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
          cwd: process.cwd(),
          continueLatest: Boolean(options.continue),
          resumeThreadId: options.resume,
        }

        const engine = new Engine()
        const exitCode = await engine.run(config)
        process.exitCode = exitCode
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        process.stderr.write(`[ant] error: ${message}\n`)
        process.exitCode = 2
      }
    })
}

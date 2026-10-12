import { Command } from 'commander'
import { readPipedStdin } from '../cli/stdin.ts'
import { resolveGrants } from '../cli/grants.ts'
import { Engine } from '../engine/engine.ts'
import {
  loadSettings,
  parseDurationMs,
  validateModelString,
} from '../settings/settings.ts'
import type { Config, LogLevel, OutputFormat } from '../types/config.ts'

export const DEFAULT_MAX_STEPS = 30
export const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000 // 30 minutes
export const DEFAULT_MODEL = 'anthropic/claude-3-7-sonnet-20250219'
export const DEFAULT_OUTPUT_FORMAT: OutputFormat = 'text'
export const DEFAULT_LOG_LEVEL: LogLevel = 'info'

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
    .option('--model <provider/model-id>', 'Model to use (format: provider/model-id)')
    .option('--max-steps <number>', 'Maximum tool execution steps')
    .option('--timeout <duration>', 'Wall-clock timeout e.g. "30m", "10s"')
    .option('--output <format>', 'Output format: text | md | json')
    .option('--log-level <level>', 'Log level: error | info | debug')
    .option('--continue', 'Continue the latest conversation thread')
    .option('--resume <thread_id>', 'Resume a specific conversation thread by ID')
    .action(async (positionalPrompt: string | undefined, options) => {
      try {
        const stdinInput = await readPipedStdin()
        const userSettings = loadSettings()
        const env = process.env

        // 1. Resolve prompt: -p flag > positional argument
        const prompt = options.prompt ?? positionalPrompt

        // 2. Resolve model: explicit CLI flag > settings.json > env > default
        const rawModel = options.model ?? userSettings.model ?? env.ANT_MODEL ?? DEFAULT_MODEL
        validateModelString(rawModel)
        const model = rawModel

        // 3. Resolve maxSteps: explicit CLI flag > settings.json > env > default
        let maxSteps: number | undefined
        if (options.maxSteps !== undefined) {
          const parsed = Number.parseInt(options.maxSteps, 10)
          if (Number.isNaN(parsed) || parsed <= 0) {
            throw new Error(`Invalid --max-steps value: "${options.maxSteps}". Must be a positive integer.`)
          }
          maxSteps = parsed
        } else if (userSettings.maxSteps !== undefined && userSettings.maxSteps > 0) {
          maxSteps = userSettings.maxSteps
        } else if (env.ANT_MAX_STEPS) {
          const parsed = Number.parseInt(env.ANT_MAX_STEPS, 10)
          if (!Number.isNaN(parsed) && parsed > 0) {
            maxSteps = parsed
          }
        }
        maxSteps = maxSteps ?? DEFAULT_MAX_STEPS

        // 4. Resolve timeout: explicit CLI flag > settings.json > env > default
        let timeoutMs = DEFAULT_TIMEOUT_MS
        const timeoutSource = options.timeout ?? userSettings.timeout ?? env.ANT_TIMEOUT
        if (timeoutSource !== undefined) {
          timeoutMs = parseDurationMs(timeoutSource)
        }

        // 5. Output format & Log level: explicit CLI flag > settings.json > env > default
        const outputFormat = options.output ?? userSettings.outputFormat ?? DEFAULT_OUTPUT_FORMAT
        if (outputFormat !== 'text' && outputFormat !== 'md' && outputFormat !== 'json') {
          throw new Error(`Invalid --output value: "${outputFormat}". Allowed: text, md, json`)
        }

        const logLevel = options.logLevel ?? userSettings.logLevel ?? (env.ANT_LOG_LEVEL as LogLevel) ?? DEFAULT_LOG_LEVEL
        if (logLevel !== 'error' && logLevel !== 'info' && logLevel !== 'debug') {
          throw new Error(`Invalid --log-level value: "${logLevel}". Allowed: error, info, debug`)
        }

        // 6. Capability grants: explicit CLI flag > settings.json > default (false)
        const allowRead = options.allowRead !== undefined ? Boolean(options.allowRead) : Boolean(userSettings.allowRead)
        const allowEdit = options.allowEdit !== undefined ? Boolean(options.allowEdit) : Boolean(userSettings.allowEdit)
        const allowBash = options.allowBash !== undefined ? Boolean(options.allowBash) : Boolean(userSettings.allowBash)
        const allowDestructiveBash = options.allowDestructiveBash !== undefined ? Boolean(options.allowDestructiveBash) : Boolean(userSettings.allowDestructiveBash)

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
          outputFormat,
          logLevel,
          grants,
          cwd: process.cwd(),
          continueLatest: Boolean(options.continue),
          resumeThreadId: options.resume,
        }

        const engine = new Engine()
        const exitCode = await engine.run(config)
        process.exit(exitCode)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        process.stderr.write(`[ant] error: ${message}\n`)
        process.exit(2)
      }
    })
}

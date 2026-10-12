import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Config, LogLevel, OutputFormat } from '../types/config.ts'
import type { ParsedCliArgs } from './argv.ts'
import { resolveGrants } from './grants.ts'

export const DEFAULT_MAX_STEPS = 30
export const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000 // 30 minutes
export const DEFAULT_MODEL = 'anthropic/claude-3-7-sonnet-20250219'
export const DEFAULT_OUTPUT_FORMAT: OutputFormat = 'text'
export const DEFAULT_LOG_LEVEL: LogLevel = 'info'

export interface UserFileConfig {
  readonly model?: string
  readonly maxSteps?: number
  readonly timeout?: string
  readonly outputFormat?: OutputFormat
  readonly logLevel?: LogLevel
  readonly allowRead?: boolean
  readonly allowEdit?: boolean
  readonly allowBash?: boolean
  readonly allowDestructiveBash?: boolean
}

export function parseDurationMs(durationStr: string): number {
  const trimmed = durationStr.trim().toLowerCase()
  if (/^\d+$/.test(trimmed)) {
    return Number.parseInt(trimmed, 10)
  }

  const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h)$/)
  if (!match) {
    throw new Error(`Invalid duration format: "${durationStr}". Use e.g. "30s", "10m", "1h", or milliseconds.`)
  }

  const value = Number.parseFloat(match[1]!)
  const unit = match[2]

  switch (unit) {
    case 'ms':
      return Math.round(value)
    case 's':
      return Math.round(value * 1000)
    case 'm':
      return Math.round(value * 60 * 1000)
    case 'h':
      return Math.round(value * 60 * 60 * 1000)
    default:
      throw new Error(`Unsupported duration unit: "${unit}"`)
  }
}

export function validateModelString(model: string): void {
  if (model.includes(':')) {
    throw new Error(`Invalid model format: "${model}". Colons are not allowed. Use "provider/model-id" format (e.g. "anthropic/claude-3-7-sonnet-20250219").`)
  }
  const slashIdx = model.indexOf('/')
  if (slashIdx <= 0 || slashIdx === model.length - 1) {
    throw new Error(`Invalid model format: "${model}". Must follow "provider/model-id" format (e.g. "anthropic/claude-3-7-sonnet-20250219").`)
  }
}

export function getSettingsPath(customPath?: string): string {
  return customPath ?? join(homedir(), '.ant', 'settings.json')
}

export function loadUserFileConfig(customPath?: string): UserFileConfig {
  const settingsPath = getSettingsPath(customPath)
  if (!existsSync(settingsPath)) {
    return {}
  }

  try {
    const raw = readFileSync(settingsPath, 'utf-8')
    return JSON.parse(raw) as UserFileConfig
  } catch (error) {
    throw new Error(`Failed to read user settings at ${settingsPath}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export function saveUserSettings(settings: UserFileConfig, customPath?: string): void {
  const settingsPath = getSettingsPath(customPath)
  mkdirSync(dirname(settingsPath), { recursive: true })
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8')
}

export function buildConfig(
  cliArgs: ParsedCliArgs,
  stdinInput?: string,
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
  fileConfig: UserFileConfig = loadUserFileConfig()
): Config {
  // 1. Model resolution: CLI flag > OS env var > ~/.ant/settings.json > default
  const rawModel = cliArgs.model ?? env.ANT_MODEL ?? fileConfig.model ?? DEFAULT_MODEL
  validateModelString(rawModel)
  const model = rawModel

  // 2. Max steps: CLI flag > OS env var > ~/.ant/settings.json > default
  let maxSteps = cliArgs.maxSteps
  if (maxSteps === undefined && env.ANT_MAX_STEPS) {
    const envNum = Number.parseInt(env.ANT_MAX_STEPS, 10)
    if (!Number.isNaN(envNum) && envNum > 0) {
      maxSteps = envNum
    }
  }
  if (maxSteps === undefined && fileConfig.maxSteps !== undefined && fileConfig.maxSteps > 0) {
    maxSteps = fileConfig.maxSteps
  }
  maxSteps = maxSteps ?? DEFAULT_MAX_STEPS

  // 3. Timeout: CLI flag > OS env var > ~/.ant/settings.json > default
  let timeoutMs = DEFAULT_TIMEOUT_MS
  const timeoutSource = cliArgs.timeout ?? env.ANT_TIMEOUT ?? fileConfig.timeout
  if (timeoutSource !== undefined) {
    timeoutMs = parseDurationMs(timeoutSource)
  }

  // 4. Output format & Log level
  const outputFormat = cliArgs.outputFormat ?? fileConfig.outputFormat ?? DEFAULT_OUTPUT_FORMAT
  const logLevel = cliArgs.logLevel ?? (env.ANT_LOG_LEVEL as LogLevel) ?? fileConfig.logLevel ?? DEFAULT_LOG_LEVEL

  // 5. Capability grants: CLI flags override file config defaults
  const grants = resolveGrants({
    allowRead: cliArgs.allowRead || Boolean(fileConfig.allowRead),
    allowEdit: cliArgs.allowEdit || Boolean(fileConfig.allowEdit),
    allowBash: cliArgs.allowBash || Boolean(fileConfig.allowBash),
    allowDestructiveBash: cliArgs.allowDestructiveBash || Boolean(fileConfig.allowDestructiveBash),
  })

  return {
    prompt: cliArgs.prompt,
    stdinInput,
    model,
    maxSteps,
    timeoutMs,
    outputFormat,
    logLevel,
    grants,
    cwd,
    continueLatest: cliArgs.continueLatest,
    resumeThreadId: cliArgs.resumeThreadId,
  }
}

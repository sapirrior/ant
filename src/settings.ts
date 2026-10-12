import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { LogLevel, OutputFormat } from './core/types.ts'

export interface UserSettings {
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

export function loadSettings(customPath?: string): UserSettings {
  const settingsPath = getSettingsPath(customPath)
  if (!existsSync(settingsPath)) {
    return {}
  }

  try {
    const raw = readFileSync(settingsPath, 'utf-8')
    return JSON.parse(raw) as UserSettings
  } catch (error) {
    throw new Error(`Failed to read user settings at ${settingsPath}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export function saveSettings(settings: UserSettings, customPath?: string): void {
  const settingsPath = getSettingsPath(customPath)
  mkdirSync(dirname(settingsPath), { recursive: true })
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8')
}

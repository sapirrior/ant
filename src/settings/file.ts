import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { notice } from '../output/notice.ts'
import { getAntHome } from '../paths.ts'
import { writeAtomicJsonFile } from '../utils/atomicJson.ts'
import { DEFAULT_SETTINGS, settingsSchema, type Settings } from './schema.ts'
import { KNOWN_TOP_KEYS } from './keys.ts'

export function getSettingsPath(): string {
  return join(getAntHome(), 'settings.json')
}

export function getSettingsLockPath(): string {
  return join(getAntHome(), 'settings.json.lock')
}

export interface LoadSettingsOptions {
  warn?: (message: string) => void
}

export function loadRawSettings(): Settings {
  const path = getSettingsPath()
  if (!existsSync(path)) {
    return {}
  }

  let raw: string
  try {
    raw = readFileSync(path, 'utf-8')
  } catch (err) {
    throw new Error(
      `Failed to read settings from ${path}: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new Error(
      `Settings file at ${path} is malformed JSON: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Settings file at ${path} must contain a JSON object.`)
  }

  const validation = settingsSchema.safeParse(parsed)
  if (!validation.success) {
    const issue = validation.error.issues[0]
    const pathStr = issue?.path.join('.') || 'root'
    throw new Error(`Invalid settings in ${path}: "${pathStr}" ${issue?.message}`)
  }

  const validated = validation.data as Settings
  if (validation.data.effort && !validated.reasoning) {
    validated.reasoning = validation.data.effort
  }
  return validated
}

export function loadSettings(options?: LoadSettingsOptions): Settings {
  const path = getSettingsPath()
  if (!existsSync(path)) {
    return {}
  }

  let raw: string
  try {
    raw = readFileSync(path, 'utf-8')
  } catch (err) {
    throw new Error(
      `Failed to read settings from ${path}: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new Error(
      `Settings file at ${path} is malformed JSON: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Settings file at ${path} must contain a JSON object.`)
  }

  const warnFn = options?.warn ?? ((msg: string) => notice.warning(msg))

  for (const k of Object.keys(parsed)) {
    if (!KNOWN_TOP_KEYS.has(k)) {
      warnFn(`ignoring unknown setting "${k}"`)
    }
  }

  if (parsed.allow !== undefined) {
    warnFn('ignoring deprecated setting "allow"')
  }
  if (parsed.deny !== undefined) {
    warnFn('ignoring deprecated setting "deny"')
  }

  const validation = settingsSchema.safeParse(parsed)
  if (!validation.success) {
    const issue = validation.error.issues[0]
    const pathStr = issue?.path.join('.') || 'root'
    throw new Error(`Invalid settings in ${path}: "${pathStr}" ${issue?.message}`)
  }

  const validated = validation.data as Settings
  if (validation.data.effort && !validated.reasoning) {
    validated.reasoning = validation.data.effort
  }

  return {
    ...DEFAULT_SETTINGS,
    ...validated,
    tools: {
      ...DEFAULT_SETTINGS.tools,
      ...validated.tools,
    },
  }
}

export function saveSettings(settings: Settings): void {
  writeAtomicJsonFile(getSettingsPath(), settings)
}

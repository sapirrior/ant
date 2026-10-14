import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import { notice } from './output/notice.ts'

import type { ReasoningEffort } from './core/types.ts'

export type { ReasoningEffort }

export const toolSettingsSchema = z.strictObject({
  enabled: z.boolean().optional(),
  foregroundMs: z.number().int().positive().optional(),
  passEnv: z.array(z.string()).optional(),
})

export const settingsSchema = z.object({
  model: z.string().optional(),
  maxSteps: z.number().int().min(1).optional(),
  timeout: z.union([z.string(), z.number().int().min(0)]).optional(),
  retries: z.number().int().min(0).optional(),
  streamRetries: z.number().int().min(0).optional(),
  output: z.enum(['text', 'md', 'json', 'stream-json']).optional(),
  reasoning: z.enum(['none', 'low', 'medium', 'high', 'max']).optional(),
  effort: z.enum(['none', 'low', 'medium', 'high', 'max']).optional(),
  logLevel: z.enum(['error', 'info', 'debug']).optional(),
  theme: z.enum(['auto', 'dark', 'light', 'ansi']).optional(),
  allow: z.strictObject({
    read: z.boolean().optional(),
    edit: z.boolean().optional(),
    bash: z.boolean().optional(),
    destructiveBash: z.boolean().optional(),
    sensitive: z.boolean().optional(),
    mcp: z.array(z.string()).optional(),
  }).optional(),
  deny: z.strictObject({
    mcp: z.array(z.string()).optional(),
  }).optional(),
  tools: z.record(z.string(), toolSettingsSchema).optional(),
})

export interface ToolSettings {
  enabled?: boolean
  foregroundMs?: number
  passEnv?: string[]
}

export interface Settings {
  model?: string
  maxSteps?: number
  timeout?: string
  retries?: number
  streamRetries?: number
  output?: 'text' | 'md' | 'json' | 'stream-json'
  reasoning?: ReasoningEffort
  logLevel?: 'error' | 'info' | 'debug'
  theme?: 'auto' | 'dark' | 'light' | 'ansi'
  allow?: {
    read?: boolean
    edit?: boolean
    bash?: boolean
    destructiveBash?: boolean
    sensitive?: boolean
    mcp?: string[]
  }
  deny?: {
    mcp?: string[]
  }
  tools?: Record<string, ToolSettings>
}

export const DEFAULT_SETTINGS: Settings = {
  maxSteps: 30,
  timeout: '30m',
  retries: 4,
  streamRetries: 1,
  output: 'text',
  logLevel: 'info',
  theme: 'auto',
  allow: {
    read: false,
    edit: false,
    bash: false,
    destructiveBash: false,
    mcp: [],
  },
  deny: {
    mcp: [],
  },
  tools: {
    ReadFile: { enabled: true },
    ListDir: { enabled: true },
    Grep: { enabled: true },
    WriteFile: { enabled: true },
    EditFile: { enabled: true },
    DeleteFile: { enabled: true },
    Bash: { enabled: true, foregroundMs: 10000, passEnv: [] },
    TaskManager: { enabled: true },
    WebSearch: { enabled: true },
    WebFetch: { enabled: true },
    McpTool: { enabled: true },
  },
}

export function parseDurationMs(durationStr: string): number {
  const trimmed = durationStr.trim().toLowerCase()
  if (/^\d+$/.test(trimmed)) {
    const ms = Number.parseInt(trimmed, 10)
    if (ms > 0 && ms < 1000) {
      throw new Error(`Timeout "${durationStr}" is less than 1000ms. Did you mean "${durationStr}s"? Use "0" for no timeout.`)
    }
    return ms
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

export { getAntHome } from './paths.ts'
import { getAntHome } from './paths.ts'

export function getSettingsPath(): string {
  return join(getAntHome(), 'settings.json')
}

export function getSettingsLockPath(): string {
  return join(getAntHome(), 'settings.json.lock')
}

export { withFileLock } from './utils/fileLock.ts'

export const KNOWN_TOP_KEYS = new Set([
  ...Object.keys(DEFAULT_SETTINGS),
  'model',
  'reasoning',
  'effort',
])

export interface LoadSettingsOptions {
  warn?: (message: string) => void
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
    throw new Error(`Failed to read settings from ${path}: ${err instanceof Error ? err.message : String(err)}`)
  }

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new Error(`Settings file at ${path} is malformed JSON: ${err instanceof Error ? err.message : String(err)}`)
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
    allow: {
      ...DEFAULT_SETTINGS.allow,
      ...validated.allow,
    },
    deny: {
      ...DEFAULT_SETTINGS.deny,
      ...validated.deny,
    },
    tools: {
      ...DEFAULT_SETTINGS.tools,
      ...validated.tools,
    },
  }
}

export function saveSettings(settings: Settings): void {
  const path = getSettingsPath()
  const dir = dirname(path)
  mkdirSync(dir, { recursive: true, mode: 0o700 })

  const tmpPath = `${path}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`
  try {
    writeFileSync(tmpPath, JSON.stringify(settings, null, 2) + '\n', { mode: 0o600 })
    renameSync(tmpPath, path)
  } catch (err) {
    try {
      if (existsSync(tmpPath)) unlinkSync(tmpPath)
    } catch {}
    throw err
  }
}

// Key parsing & management
export interface KeyDefinition {
  key: string
  describe: string
  parse(val: string): unknown
  get(s: Settings): unknown
  set(s: Settings, val: unknown): void
  unset(s: Settings): void
}

function parseBool(val: string, keyName: string): boolean {
  if (val === 'true') return true
  if (val === 'false') return false
  throw new Error(`Setting "${keyName}" must be true or false (got "${val}")`)
}

function parsePositiveInt(val: string, keyName: string): number {
  const n = Number.parseInt(val, 10)
  if (Number.isNaN(n) || n <= 0) {
    throw new Error(`Setting "${keyName}" must be a positive integer (got "${val}")`)
  }
  return n
}

export const VALID_REASONING: readonly ReasoningEffort[] = [
  'provider-default',
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]

export function parseReasoning(val: string): ReasoningEffort {
  const norm = val.trim().toLowerCase()
  if (norm === 'default') return 'provider-default'
  if (VALID_REASONING.includes(norm as ReasoningEffort)) {
    return norm as ReasoningEffort
  }
  throw new Error(
    `Setting "reasoning" must be one of: provider-default, default, none, minimal, low, medium, high, xhigh, max (got "${val}")`
  )
}

export const KEYS: Record<string, KeyDefinition> = {
  model: {
    key: 'model',
    describe: 'Model in provider/model-id format',
    parse: (v) => {
      const trimmed = v.trim()
      const slashIdx = trimmed.indexOf('/')
      if (slashIdx <= 0 || slashIdx === trimmed.length - 1) {
        throw new Error(`Invalid model format: "${v}". Use "provider/model-id" format.`)
      }
      return trimmed
    },
    get: (s) => s.model,
    set: (s, v) => { s.model = v as string },
    unset: (s) => { delete s.model },
  },
  maxSteps: {
    key: 'maxSteps',
    describe: 'Maximum agent execution steps (positive integer)',
    parse: (v) => parsePositiveInt(v, 'maxSteps'),
    get: (s) => s.maxSteps,
    set: (s, v) => { s.maxSteps = v as number },
    unset: (s) => { delete s.maxSteps },
  },
  timeout: {
    key: 'timeout',
    describe: 'Wall-clock timeout e.g. "30m", "10s"',
    parse: (v) => {
      parseDurationMs(v)
      return v.trim()
    },
    get: (s) => s.timeout,
    set: (s, v) => { s.timeout = v as string },
    unset: (s) => { delete s.timeout },
  },
  retries: {
    key: 'retries',
    describe: 'Number of API request retries (0-10)',
    parse: (v) => {
      const n = Number.parseInt(v, 10)
      if (Number.isNaN(n) || n < 0 || n > 10) {
        throw new Error(`Setting "retries" must be an integer between 0 and 10 (got "${v}")`)
      }
      return n
    },
    get: (s) => s.retries,
    set: (s, v) => { s.retries = v as number },
    unset: (s) => { delete s.retries },
  },
  streamRetries: {
    key: 'streamRetries',
    describe: 'Number of mid-stream step retries (positive integer or 0)',
    parse: (v) => {
      const n = Number.parseInt(v, 10)
      if (Number.isNaN(n) || n < 0) {
        throw new Error(`Setting "streamRetries" must be a non-negative integer (got "${v}")`)
      }
      return n
    },
    get: (s) => s.streamRetries,
    set: (s, v) => { s.streamRetries = v as number },
    unset: (s) => { delete s.streamRetries },
  },
  output: {
    key: 'output',
    describe: 'Output format: text | md | json | stream-json',
    parse: (v) => {
      if (v !== 'text' && v !== 'md' && v !== 'json' && v !== 'stream-json') {
        throw new Error(`Setting "output" must be "text", "md", "json", or "stream-json" (got "${v}")`)
      }
      return v
    },
    get: (s) => s.output,
    set: (s, v) => { s.output = v as 'text' | 'md' | 'json' | 'stream-json' },
    unset: (s) => { delete s.output },
  },
  logLevel: {
    key: 'logLevel',
    describe: 'Logging verbosity: error | info | debug',
    parse: (v) => {
      if (v !== 'error' && v !== 'info' && v !== 'debug') {
        throw new Error(`Setting "logLevel" must be "error", "info", or "debug" (got "${v}")`)
      }
      return v
    },
    get: (s) => s.logLevel,
    set: (s, v) => { s.logLevel = v as 'error' | 'info' | 'debug' },
    unset: (s) => { delete s.logLevel },
  },
  theme: {
    key: 'theme',
    describe: 'Color theme: auto | dark | light | ansi',
    parse: (v) => {
      if (v !== 'auto' && v !== 'dark' && v !== 'light' && v !== 'ansi') {
        throw new Error(`Setting "theme" must be "auto", "dark", "light", or "ansi" (got "${v}")`)
      }
      return v
    },
    get: (s) => s.theme,
    set: (s, v) => { s.theme = v as 'auto' | 'dark' | 'light' | 'ansi' },
    unset: (s) => { delete s.theme },
  },
  reasoning: {
    key: 'reasoning',
    describe: 'Reasoning effort: provider-default | none | minimal | low | medium | high | xhigh | max',
    parse: parseReasoning,
    get: (s) => s.reasoning,
    set: (s, v) => { s.reasoning = v as ReasoningEffort },
    unset: (s) => { delete s.reasoning },
  },
  effort: {
    key: 'effort',
    describe: 'Alias for reasoning effort',
    parse: parseReasoning,
    get: (s) => s.reasoning,
    set: (s, v) => { s.reasoning = v as ReasoningEffort },
    unset: (s) => { delete s.reasoning },
  },
  'allow.read': {
    key: 'allow.read',
    describe: 'Allow file reading by default (true/false)',
    parse: (v) => parseBool(v, 'allow.read'),
    get: (s) => s.allow?.read,
    set: (s, v) => {
      s.allow = s.allow ?? {}
      s.allow.read = v as boolean
    },
    unset: (s) => {
      if (s.allow) delete s.allow.read
    },
  },
  'allow.edit': {
    key: 'allow.edit',
    describe: 'Allow file editing and writing by default (true/false)',
    parse: (v) => parseBool(v, 'allow.edit'),
    get: (s) => s.allow?.edit,
    set: (s, v) => {
      s.allow = s.allow ?? {}
      s.allow.edit = v as boolean
    },
    unset: (s) => {
      if (s.allow) delete s.allow.edit
    },
  },
  'allow.bash': {
    key: 'allow.bash',
    describe: 'Allow bash execution by default (true/false)',
    parse: (v) => parseBool(v, 'allow.bash'),
    get: (s) => s.allow?.bash,
    set: (s, v) => {
      s.allow = s.allow ?? {}
      s.allow.bash = v as boolean
    },
    unset: (s) => {
      if (s.allow) delete s.allow.bash
    },
  },
  'allow.destructiveBash': {
    key: 'allow.destructiveBash',
    describe: 'Allow unprompted destructive bash execution by default (true/false)',
    parse: (v) => parseBool(v, 'allow.destructiveBash'),
    get: (s) => s.allow?.destructiveBash,
    set: (s, v) => {
      s.allow = s.allow ?? {}
      s.allow.destructiveBash = v as boolean
    },
    unset: (s) => {
      if (s.allow) delete s.allow.destructiveBash
    },
  },
  'allow.sensitive': {
    key: 'allow.sensitive',
    describe: 'Allow reading sensitive files by default (true/false)',
    parse: (v) => parseBool(v, 'allow.sensitive'),
    get: (s) => s.allow?.sensitive,
    set: (s, v) => {
      s.allow = s.allow ?? {}
      s.allow.sensitive = v as boolean
    },
    unset: (s) => {
      if (s.allow) delete s.allow.sensitive
    },
  },
  'allow.mcp': {
    key: 'allow.mcp',
    describe: 'Pre-allowed MCP tools list/patterns (comma-separated or JSON array)',
    parse: (v) => {
      const trimmed = v.trim()
      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        return JSON.parse(trimmed)
      }
      return trimmed.split(',').map((x) => x.trim()).filter(Boolean)
    },
    get: (s) => s.allow?.mcp,
    set: (s, v) => {
      s.allow = s.allow ?? {}
      s.allow.mcp = v as string[]
    },
    unset: (s) => {
      if (s.allow) delete s.allow.mcp
    },
  },
  'deny.mcp': {
    key: 'deny.mcp',
    describe: 'Denied MCP tools list/patterns (comma-separated or JSON array)',
    parse: (v) => {
      const trimmed = v.trim()
      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        return JSON.parse(trimmed)
      }
      return trimmed.split(',').map((x) => x.trim()).filter(Boolean)
    },
    get: (s) => s.deny?.mcp,
    set: (s, v) => {
      s.deny = s.deny ?? {}
      s.deny.mcp = v as string[]
    },
    unset: (s) => {
      if (s.deny) delete s.deny.mcp
    },
  },
  'tools.Bash.foregroundMs': {
    key: 'tools.Bash.foregroundMs',
    describe: 'Milliseconds before bash commands move to background (positive integer)',
    parse: (v) => parsePositiveInt(v, 'tools.Bash.foregroundMs'),
    get: (s) => s.tools?.Bash?.foregroundMs,
    set: (s, v) => {
      s.tools = s.tools ?? {}
      s.tools.Bash = s.tools.Bash ?? {}
      s.tools.Bash.foregroundMs = v as number
    },
    unset: (s) => {
      if (s.tools?.Bash) delete s.tools.Bash.foregroundMs
    },
  },
  'tools.Bash.passEnv': {
    key: 'tools.Bash.passEnv',
    describe: 'Comma-separated list of additional env vars to pass to bash',
    parse: (v) => v.split(',').map((x) => x.trim()).filter(Boolean),
    get: (s) => s.tools?.Bash?.passEnv,
    set: (s, v) => {
      s.tools = s.tools ?? {}
      s.tools.Bash = s.tools.Bash ?? {}
      s.tools.Bash.passEnv = v as string[]
    },
    unset: (s) => {
      if (s.tools?.Bash) delete s.tools.Bash.passEnv
    },
  },
}

// Add per-tool enabled keys
const KNOWN_TOOLS = [
  'ReadFile',
  'ListDir',
  'Grep',
  'WriteFile',
  'EditFile',
  'DeleteFile',
  'Bash',
  'TaskManager',
  'WebSearch',
  'WebFetch',
  'McpTool',
]

for (const t of KNOWN_TOOLS) {
  const k = `tools.${t}.enabled`
  KEYS[k] = {
    key: k,
    describe: `Enable or disable tool ${t} (true/false)`,
    parse: (v) => parseBool(v, k),
    get: (s) => s.tools?.[t]?.enabled,
    set: (s, v) => {
      s.tools = s.tools ?? {}
      s.tools[t] = s.tools[t] ?? {}
      s.tools[t]!.enabled = v as boolean
    },
    unset: (s) => {
      if (s.tools?.[t]) delete s.tools[t]!.enabled
    },
  }
}

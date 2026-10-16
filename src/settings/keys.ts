import {
  LOG_LEVELS,
  OUTPUT_FORMATS,
  PERMISSION_MODES,
  REASONING_EFFORTS,
  TOOL_NAMES,
  type LogLevel,
  type OutputFormat,
  type PermissionMode,
  type ReasoningEffort,
  type Theme,
  THEMES,
} from '../constants/index.ts'
import { settingsSchema, type Settings } from './schema.ts'

export function parseDurationMs(durationStr: string): number {
  if (typeof durationStr !== 'string') {
    throw new Error(`Invalid duration format: "${durationStr}". Must be a string.`)
  }
  const trimmed = durationStr.trim().toLowerCase()
  if (/^\d+$/.test(trimmed)) {
    const ms = Number.parseInt(trimmed, 10)
    if (ms > 0 && ms < 1000) {
      throw new Error(
        `Timeout "${durationStr}" is less than 1000ms. Did you mean "${durationStr}s"? Use "0" for no timeout.`,
      )
    }
    return ms
  }

  const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h)$/)
  if (!match) {
    throw new Error(
      `Invalid duration format: "${durationStr}". Use e.g. "30s", "10m", "1h", or milliseconds.`,
    )
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

export function parseReasoning(val: string): ReasoningEffort {
  const norm = val.trim().toLowerCase()
  if (norm === 'default') return 'provider-default'
  if (REASONING_EFFORTS.includes(norm as (typeof REASONING_EFFORTS)[number])) {
    return norm as ReasoningEffort
  }
  throw new Error(
    `Setting "reasoning" must be one of: provider-default, default, none, minimal, low, medium, high, xhigh, max (got "${val}")`,
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
    set: (s, v) => {
      s.model = v as string
    },
    unset: (s) => {
      delete s.model
    },
  },
  maxTurns: {
    key: 'maxTurns',
    describe: 'Maximum agent execution turns (positive integer)',
    parse: (v) => parsePositiveInt(v, 'maxTurns'),
    get: (s) => s.maxTurns ?? s.maxSteps,
    set: (s, v) => {
      s.maxTurns = v as number
      delete s.maxSteps
    },
    unset: (s) => {
      delete s.maxTurns
      delete s.maxSteps
    },
  },
  maxSteps: {
    key: 'maxSteps',
    describe: 'Alias for maxTurns',
    parse: (v) => parsePositiveInt(v, 'maxSteps'),
    get: (s) => s.maxTurns ?? s.maxSteps,
    set: (s, v) => {
      s.maxTurns = v as number
      delete s.maxSteps
    },
    unset: (s) => {
      delete s.maxTurns
      delete s.maxSteps
    },
  },
  timeout: {
    key: 'timeout',
    describe: 'Wall-clock timeout e.g. "30m", "10s"',
    parse: (v) => {
      parseDurationMs(v)
      return v.trim()
    },
    get: (s) => s.timeout,
    set: (s, v) => {
      s.timeout = v as string
    },
    unset: (s) => {
      delete s.timeout
    },
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
    set: (s, v) => {
      s.retries = v as number
    },
    unset: (s) => {
      delete s.retries
    },
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
    set: (s, v) => {
      s.streamRetries = v as number
    },
    unset: (s) => {
      delete s.streamRetries
    },
  },
  outputFormat: {
    key: 'outputFormat',
    describe: 'Output format: text | md | json | stream-json',
    parse: (v) => {
      if (!OUTPUT_FORMATS.includes(v as OutputFormat)) {
        throw new Error(
          `Setting "outputFormat" must be "text", "md", "json", or "stream-json" (got "${v}")`,
        )
      }
      return v
    },
    get: (s) => s.outputFormat ?? s.output,
    set: (s, v) => {
      s.outputFormat = v as OutputFormat
      delete s.output
    },
    unset: (s) => {
      delete s.outputFormat
      delete s.output
    },
  },
  output: {
    key: 'output',
    describe: 'Alias for outputFormat',
    parse: (v) => {
      if (!OUTPUT_FORMATS.includes(v as OutputFormat)) {
        throw new Error(
          `Setting "output" must be "text", "md", "json", or "stream-json" (got "${v}")`,
        )
      }
      return v
    },
    get: (s) => s.outputFormat ?? s.output,
    set: (s, v) => {
      s.outputFormat = v as OutputFormat
      delete s.output
    },
    unset: (s) => {
      delete s.outputFormat
      delete s.output
    },
  },
  logLevel: {
    key: 'logLevel',
    describe: 'Logging verbosity: error | info | debug',
    parse: (v) => {
      if (!LOG_LEVELS.includes(v as LogLevel)) {
        throw new Error(`Setting "logLevel" must be "error", "info", or "debug" (got "${v}")`)
      }
      return v
    },
    get: (s) => s.logLevel,
    set: (s, v) => {
      s.logLevel = v as LogLevel
    },
    unset: (s) => {
      delete s.logLevel
    },
  },
  theme: {
    key: 'theme',
    describe: 'Color theme: auto | dark | light | ansi',
    parse: (v) => {
      if (!THEMES.includes(v as Theme)) {
        throw new Error(`Setting "theme" must be "auto", "dark", "light", or "ansi" (got "${v}")`)
      }
      return v
    },
    get: (s) => s.theme,
    set: (s, v) => {
      s.theme = v as Theme
    },
    unset: (s) => {
      delete s.theme
    },
  },
  reasoning: {
    key: 'reasoning',
    describe:
      'Reasoning effort: provider-default | none | minimal | low | medium | high | xhigh | max',
    parse: parseReasoning,
    get: (s) => s.reasoning,
    set: (s, v) => {
      s.reasoning = v as ReasoningEffort
      delete s.effort
    },
    unset: (s) => {
      delete s.reasoning
      delete s.effort
    },
  },
  effort: {
    key: 'effort',
    describe: 'Alias for reasoning effort',
    parse: parseReasoning,
    get: (s) => s.reasoning,
    set: (s, v) => {
      s.reasoning = v as ReasoningEffort
      delete s.effort
    },
    unset: (s) => {
      delete s.reasoning
      delete s.effort
    },
  },
  permissionMode: {
    key: 'permissionMode',
    describe: 'Permission mode: default | plan | acceptEdits | bypassPermissions',
    parse: (v) => {
      if (!PERMISSION_MODES.includes(v as PermissionMode)) {
        throw new Error(
          `Setting "permissionMode" must be "default", "plan", "acceptEdits", or "bypassPermissions" (got "${v}")`,
        )
      }
      return v
    },
    get: (s) => s.permissionMode,
    set: (s, v) => {
      s.permissionMode = v as PermissionMode
    },
    unset: (s) => {
      delete s.permissionMode
    },
  },
  allowedTools: {
    key: 'allowedTools',
    describe: 'Allowed tool rules (comma-separated)',
    parse: (v) =>
      v
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean),
    get: (s) => s.allowedTools,
    set: (s, v) => {
      s.allowedTools = v as string[]
    },
    unset: (s) => {
      delete s.allowedTools
    },
  },
  disallowedTools: {
    key: 'disallowedTools',
    describe: 'Disallowed tool rules (comma-separated)',
    parse: (v) =>
      v
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean),
    get: (s) => s.disallowedTools,
    set: (s, v) => {
      s.disallowedTools = v as string[]
    },
    unset: (s) => {
      delete s.disallowedTools
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
    parse: (v) =>
      v
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean),
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

for (const t of TOOL_NAMES) {
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

export const KNOWN_TOP_KEYS = new Set([...Object.keys(settingsSchema.shape), 'effort'])

import { z } from 'zod'
import {
  LOG_LEVELS,
  OUTPUT_FORMATS,
  PERMISSION_MODES,
  REASONING_EFFORTS,
  type LogLevel,
  type OutputFormat,
  type PermissionMode,
  type ReasoningEffort,
  type Theme,
  THEMES,
} from '../constants/index.ts'

export type { ReasoningEffort }

export const VALID_REASONING = REASONING_EFFORTS

export const toolSettingsSchema = z.strictObject({
  enabled: z.boolean().optional(),
  foregroundMs: z.number().int().positive().optional(),
  passEnv: z.array(z.string()).optional(),
})

export const settingsSchema = z.object({
  model: z.string().optional(),
  maxTurns: z.number().int().min(1).optional(),
  maxSteps: z.number().int().min(1).optional(),
  timeout: z.string().optional(),
  retries: z.number().int().min(0).optional(),
  streamRetries: z.number().int().min(0).optional(),
  outputFormat: z.enum(OUTPUT_FORMATS).optional(),
  output: z.enum(OUTPUT_FORMATS).optional(),
  reasoning: z.enum(VALID_REASONING).optional(),
  effort: z.enum(VALID_REASONING).optional(),
  logLevel: z.enum(LOG_LEVELS).optional(),
  theme: z.enum(THEMES).optional(),
  permissionMode: z.enum(PERMISSION_MODES).optional(),
  allowedTools: z.array(z.string()).optional(),
  disallowedTools: z.array(z.string()).optional(),
  allow: z.any().optional(),
  deny: z.any().optional(),
  tools: z.record(z.string(), toolSettingsSchema).optional(),
})

export interface ToolSettings {
  enabled?: boolean
  foregroundMs?: number
  passEnv?: string[]
}

export interface Settings {
  model?: string
  maxTurns?: number
  maxSteps?: number
  timeout?: string
  retries?: number
  streamRetries?: number
  outputFormat?: OutputFormat
  output?: OutputFormat
  reasoning?: ReasoningEffort
  effort?: ReasoningEffort
  logLevel?: LogLevel
  theme?: Theme
  permissionMode?: PermissionMode
  allowedTools?: string[]
  disallowedTools?: string[]
  allow?: Record<string, unknown>
  deny?: Record<string, unknown>
  tools?: Record<string, ToolSettings>
}

export const DEFAULT_SETTINGS: Settings = {
  maxTurns: 30,
  timeout: '30m',
  retries: 4,
  streamRetries: 1,
  logLevel: 'info',
  theme: 'auto',
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

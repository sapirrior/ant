export const TOOL_NAMES = [
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
] as const
export type ToolName = (typeof TOOL_NAMES)[number]

export const PERMISSION_MODES = ['default', 'plan', 'acceptEdits', 'bypassPermissions'] as const
export type PermissionMode = (typeof PERMISSION_MODES)[number]

export const OUTPUT_FORMATS = ['text', 'md', 'json', 'stream-json'] as const
export type OutputFormat = (typeof OUTPUT_FORMATS)[number]

export const LOG_LEVELS = ['error', 'info', 'debug'] as const
export type LogLevel = (typeof LOG_LEVELS)[number]

export const THEMES = ['auto', 'dark', 'light', 'ansi'] as const
export type Theme = (typeof THEMES)[number]

export const REASONING_EFFORTS = [
  'provider-default',
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number]

export const RUN_STATUSES = [
  'completed',
  'max_turns',
  'truncated',
  'empty_response',
  'usage_error',
  'model_error',
  'timeout',
  'internal_error',
  'cancelled',
] as const
export type Status = (typeof RUN_STATUSES)[number]

export const ERROR_SUBTYPES = [
  'max_turns',
  'truncated',
  'empty_response',
  'usage_error',
  'model_error',
  'timeout',
  'internal_error',
  'cancelled',
] as const
export type ErrorSubtype = (typeof ERROR_SUBTYPES)[number]

export const SCHEMA_VERSION = 1

import type { Grants } from './config.ts'

export type ToolName =
  | 'ReadFile'
  | 'ListDir'
  | 'Grep'
  | 'WriteFile'
  | 'EditFile'
  | 'DeleteFile'
  | 'Bash'
  | 'AskUser'

export interface ToolExecutionContext {
  readonly cwd: string
  readonly grants: Grants
  readonly abortSignal?: AbortSignal
}

export interface ToolExecutionResult<T = unknown> {
  readonly ok: boolean
  readonly output: T
  readonly error?: string
}

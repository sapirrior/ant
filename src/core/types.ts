import type { ModelMessage } from 'ai'

export type OutputFormat = 'text' | 'md' | 'json'

export type LogLevel = 'error' | 'info' | 'debug'

export type Theme = 'auto' | 'dark' | 'light' | 'ansi'

export type ReasoningEffort =
  | 'provider-default'
  | 'none'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max'

export type Capability =
  | 'fs.read'
  | 'fs.write'
  | 'shell.run'
  | 'shell.destructive'

export interface Grants {
  readonly has: (cap: Capability) => boolean
  readonly capabilities: ReadonlySet<Capability>
}

export interface Config {
  readonly prompt?: string
  readonly stdinInput?: string
  readonly model: string
  readonly maxSteps: number
  readonly timeoutMs: number
  readonly retries: number
  readonly outputFormat: OutputFormat
  readonly logLevel: LogLevel
  readonly theme: Theme
  readonly effort?: ReasoningEffort
  readonly grants: Grants
  readonly cwd: string
  readonly continueLatest: boolean
  readonly resumeThreadId?: string
}

export type Status =
  | 'completed'
  | 'max_steps'
  | 'truncated'
  | 'empty_response'
  | 'usage_error'
  | 'model_error'
  | 'timeout'
  | 'internal_error'
  | 'cancelled'

export type ExitCode = 0 | 1 | 2 | 3 | 4 | 5 | 130 | 143

export interface UsageSummary {
  readonly inputTokens?: number
  readonly outputTokens?: number
  readonly totalTokens?: number
}

export type RunEvent =
  | {
      readonly type: 'step-finish'
      readonly stepNumber: number
      readonly finishReason: string
      readonly usage?: UsageSummary
    }
  | {
      readonly type: 'tool-call'
      readonly callId: string
      readonly toolName: string
      readonly input: unknown
    }
  | {
      readonly type: 'tool-result'
      readonly callId: string
      readonly toolName: string
      readonly output: unknown
      readonly durationMs: number
      readonly isError?: boolean
    }
  | { readonly type: 'text-delta'; readonly delta: string }

export interface ModelOutcome {
  readonly status: Status
  readonly exitCode: ExitCode
  readonly text: string
  readonly stepsExecuted: number
  readonly usage?: UsageSummary
  readonly error?: string
}

export interface ModelRunOptions {
  readonly config: Config
  readonly messages: ModelMessage[]
  readonly signal: AbortSignal
  readonly threadId?: string
  readonly onCheckpoint?: (
    tool: string,
    toolCallId: string | undefined,
    files: { path: string; before: import('../tools/fs.ts').FileSnapshot | null; after: import('../tools/fs.ts').FileSnapshot | null }[]
  ) => number
  readonly onEvent?: (event: RunEvent) => void
}

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
  readonly readState?: Map<string, string>
  readonly threadId?: string
  readonly toolCallId?: string
  readonly onCheckpoint?: (
    tool: string,
    toolCallId: string | undefined,
    files: { path: string; before: import('../tools/fs.ts').FileSnapshot | null; after: import('../tools/fs.ts').FileSnapshot | null }[]
  ) => number
}

export interface ToolExecutionResult<T = unknown> {
  readonly ok: boolean
  readonly output: T
  readonly error?: string
}

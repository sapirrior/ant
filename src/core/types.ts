import type { ModelMessage } from 'ai'
import type { EffectivePermissions, PermissionMode, ParsedToolRule } from '../policy/toolPermissions.ts'

export type OutputFormat = 'text' | 'md' | 'json' | 'stream-json'

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

export interface Config {
  readonly prompt?: string
  readonly stdinInput?: string
  readonly model: string
  readonly maxTurns: number
  readonly timeoutMs: number
  readonly retries: number
  readonly outputFormat: OutputFormat
  readonly logLevel: LogLevel
  readonly theme: Theme
  readonly effort?: ReasoningEffort
  readonly effectivePermissions: EffectivePermissions
  readonly cwd: string
  readonly continueLatest: boolean
  readonly resumeThreadId?: string
  readonly streamRetries?: number
  readonly allowedMcp?: readonly string[]
  readonly deniedMcp?: readonly string[]
  readonly bare?: boolean
  readonly noSessionPersistence?: boolean
  readonly verbose?: boolean
  readonly toolsFilter?: readonly ToolName[]
  readonly permissionMode?: PermissionMode
  readonly allowedToolsRules?: readonly ParsedToolRule[]
  readonly disallowedToolsRules?: readonly ParsedToolRule[]
  readonly appendSystemPrompt?: string
  readonly appendSystemPromptFile?: string
  readonly settings?: import('../settings.ts').Settings
}

export type Status =
  | 'completed'
  | 'max_turns'
  | 'truncated'
  | 'empty_response'
  | 'usage_error'
  | 'model_error'
  | 'timeout'
  | 'internal_error'
  | 'cancelled'

export type ExitCode = 0 | 1 | 2 | 3 | 4 | 5 | 129 | 130 | 141 | 143

export interface UsageSummary {
  readonly inputTokens?: number
  readonly outputTokens?: number
  readonly totalTokens?: number
  readonly cachedTokens?: number
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
  | 'TaskManager'
  | 'WebSearch'
  | 'WebFetch'
  | 'McpTool'

export interface ToolExecutionContext {
  readonly cwd: string
  readonly effectivePermissions: EffectivePermissions
  readonly abortSignal?: AbortSignal
  readonly readState?: Map<string, string>
  readonly threadId?: string
  readonly toolCallId?: string
  readonly tasks?: import('../tools/tasks.ts').TaskManagerRegistry
  readonly mcpManager?: import('../mcp/manager.ts').McpClientManager
  readonly allowedMcpPatterns?: readonly string[]
  readonly deniedMcpPatterns?: readonly string[]
  readonly backgroundEnabled?: boolean
  readonly foregroundMs?: number
  readonly passEnv?: string[]
  readonly theme?: Theme
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

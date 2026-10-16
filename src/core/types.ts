import type { ModelMessage } from 'ai'
import type { EffectivePermissions, ParsedToolRule } from '../policy/toolPermissions.ts'
import type {
  LogLevel,
  OutputFormat,
  PermissionMode,
  ReasoningEffort,
  Status,
  Theme,
  ToolName,
} from '../constants/index.ts'

export type {
  LogLevel,
  OutputFormat,
  PermissionMode,
  ReasoningEffort,
  Status,
  Theme,
  ToolName,
}

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
  readonly bare?: boolean
  readonly noSessionPersistence?: boolean
  readonly verbose?: boolean
  readonly toolsFilter?: readonly ToolName[]
  readonly permissionMode?: PermissionMode
  readonly allowedToolsRules?: readonly ParsedToolRule[]
  readonly disallowedToolsRules?: readonly ParsedToolRule[]
  readonly appendSystemPrompt?: string
  readonly appendSystemPromptFile?: string
  readonly settings?: import('../settings/index.ts').Settings
}

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

export interface ToolExecutionContext {
  readonly cwd: string
  readonly effectivePermissions: EffectivePermissions
  readonly abortSignal?: AbortSignal
  readonly readState?: Map<string, string>
  readonly threadId?: string
  readonly toolCallId?: string
  readonly tasks?: import('../tools/tasks.ts').TaskManagerRegistry
  readonly mcpManager?: import('../mcp/manager.ts').McpClientManager
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

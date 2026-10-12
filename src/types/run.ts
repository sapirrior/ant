import type { ModelMessage } from 'ai'
import type { Config } from './config.ts'

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
  | { readonly type: 'step-start'; readonly stepNumber: number }
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
  | { readonly type: 'diagnostics'; readonly message: string }

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
  readonly onEvent?: (event: RunEvent) => void
}

export interface ModelPort {
  run(options: ModelRunOptions): Promise<ModelOutcome>
}

import {
  APICallError,
  NoOutputGeneratedError,
  RetryError,
  StreamProviderError,
  isStepCount,
  streamText,
  type ModelMessage,
} from 'ai'
import { buildTools } from '../tools/index.ts'
import type {
  ToolExecutionContext,
  ExitCode,
  ModelOutcome,
  ModelRunOptions,
  Status,
  UsageSummary,
} from './types.ts'
import { buildInstructions } from './prompt.ts'
import { resolveLanguageModel, PROVIDERS } from './model.ts'
import { TaskManagerRegistry } from '../tools/tasks.ts'
import { abortReasonOf, type AbortReason } from './signals.ts'

export function exitCodeForAbort(reason: AbortReason | undefined): ExitCode {
  if (reason === 'timeout') return 4
  if (reason === 'SIGTERM') return 143
  if (reason === 'SIGHUP') return 129
  if (reason === 'SIGPIPE' as any) return 141
  return 130
}

export function abortOutcome(signal: AbortSignal, stepsExecuted: number, text = ''): ModelOutcome {
  const reason = abortReasonOf(signal)
  const isTimeout = reason === 'timeout'
  const isSigterm = reason === 'SIGTERM'
  const isSighup = reason === 'SIGHUP'

  const status: Status = isTimeout ? 'timeout' : 'cancelled'
  const exitCode = exitCodeForAbort(reason)
  const error = isTimeout
    ? 'Execution timed out.'
    : isSighup
    ? 'Operation aborted by hangup signal (SIGHUP).'
    : isSigterm
    ? 'Operation terminated by system signal (SIGTERM).'
    : 'Operation aborted by user signal.'

  return {
    status,
    exitCode,
    text,
    stepsExecuted,
    error,
  }
}

export function mapStatusToExitCode(status: Status): ExitCode {
  switch (status) {
    case 'completed':
      return 0
    case 'max_steps':
    case 'truncated':
    case 'empty_response':
      return 1
    case 'usage_error':
      return 2
    case 'model_error':
      return 3
    case 'timeout':
      return 4
    case 'internal_error':
      return 5
    case 'cancelled':
      return 130
  }
}

/**
 * Unwraps and describes AI SDK provider / network errors.
 */
export function describeModelError(err: unknown, modelProvider?: string): string {
  let target = err

  // Unwrap RetryError.lastError if present
  if (RetryError.isInstance(target)) {
    target = (target as any).lastError ?? target
  }

  // Network error codes
  if (target && typeof target === 'object') {
    const code = (target as { code?: string }).code
    if (code && ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN'].includes(code)) {
      return `network error: ${code}`
    }
  }

  // Check APICallError or StreamProviderError
  if (APICallError.isInstance(target) || StreamProviderError.isInstance(target)) {
    const apiErr = target as any
    const statusCode = apiErr.statusCode ?? apiErr.status
    const bodyText = typeof apiErr.responseBody === 'string'
      ? apiErr.responseBody
      : typeof apiErr.message === 'string'
      ? apiErr.message
      : ''

    if (statusCode === 401 || statusCode === 403) {
      const envVars = modelProvider && PROVIDERS[modelProvider]?.env
        ? PROVIDERS[modelProvider]!.env.join(' or ')
        : 'API key'
      return `authentication failed — check ${envVars}`
    }

    if (statusCode === 429) {
      return 'rate limited after retry attempts'
    }

    if (statusCode >= 500) {
      return `provider error ${statusCode} after retry attempts`
    }

    if (statusCode === 400 && /(context (length|window)|maximum context|prompt is too long|too many tokens)/i.test(bodyText)) {
      return 'context too long — start a new thread'
    }

    if (apiErr.message) {
      return apiErr.message
    }
  }

  if (
    NoOutputGeneratedError.isInstance(target) ||
    (target instanceof Error && /no output generated/i.test(target.message))
  ) {
    return 'model returned no output (check model parameters, reasoning effort, or compatibility)'
  }

  if (target instanceof Error) {
    return target.message
  }

  if (target && typeof target === 'object') {
    const obj = target as Record<string, unknown>
    if (typeof obj.message === 'string') {
      return obj.message
    }
    if (typeof obj.error === 'string') {
      return obj.error
    }
    if (obj.error && typeof obj.error === 'object' && typeof (obj.error as any).message === 'string') {
      return (obj.error as any).message
    }
    try {
      return JSON.stringify(target)
    } catch {
      // fallback
    }
  }

  return String(target)
}

export interface RunAgentContext {
  tasks?: TaskManagerRegistry
  mcpManager?: import('../mcp/manager.ts').McpClientManager
  onStepPersist?: (messages: ModelMessage[], usage?: UsageSummary, stepsIncrement?: number) => void
}

export async function runAgent(
  options: ModelRunOptions & { agentContext?: RunAgentContext }
): Promise<ModelOutcome> {
  const { config, messages, signal, threadId, onCheckpoint, onEvent, agentContext } = options
  const { model, provider, adapter } = resolveLanguageModel(config.model)
  const readState = new Map<string, string>()
  const tasks = agentContext?.tasks ?? new TaskManagerRegistry()
  const mcpManager = agentContext?.mcpManager

  const bashSettings = config.settings?.tools?.Bash
  const allowedMcpPatterns = [
    ...(config.allowedMcp ?? []),
    ...(config.settings?.allow?.mcp ?? []),
  ]
  const deniedMcpPatterns = [
    ...(config.deniedMcp ?? []),
    ...(config.settings?.deny?.mcp ?? []),
  ]

  const toolContext: ToolExecutionContext = {
    cwd: config.cwd,
    grants: config.grants,
    abortSignal: signal,
    readState,
    threadId,
    tasks,
    mcpManager,
    allowedMcpPatterns,
    deniedMcpPatterns,
    backgroundEnabled: true,
    foregroundMs: bashSettings?.foregroundMs,
    passEnv: bashSettings?.passEnv,
    onCheckpoint,
  }

  const tools = buildTools(toolContext, config.settings)
  const toolDescriptions = Object.entries(tools).map(([name, t]) => ({
    name,
    description: (t as { description?: string }).description,
  }))
  const instructions = buildInstructions(config, toolDescriptions)
  let stepsExecuted = 0
  let persistedCount = 0
  let accumulatedText = ''
  const toolCallStartTimes = new Map<string, number>()
  let streamError: unknown = null

  const providerOptions = adapter.buildProviderOptions?.()

  try {
    const result = streamText({
      model,
      instructions,
      messages,
      tools,
      providerOptions,
      reasoning: config.effort,
      stopWhen: isStepCount(config.maxSteps),
      abortSignal: signal,
      maxRetries: config.retries,
      streamRetries: config.streamRetries ?? config.settings?.streamRetries ?? 1,
      timeout: {
        firstChunkMs: 180000,
        chunkMs: 60000,
      },
      prepareStep: ({ stepNumber }) => {
        if (config.maxSteps > 1 && stepNumber === config.maxSteps - 1) {
          return { toolChoice: 'none' }
        }
        return undefined
      },
      onStepEnd: (step) => {
        stepsExecuted++
        const cachedTokens =
          (step.usage as any)?.cachedPromptTokens ??
          (step.usage as any)?.cacheReadInputTokens ??
          undefined

        const stepUsage: UsageSummary | undefined = step.usage
          ? {
              inputTokens: step.usage.inputTokens,
              outputTokens: step.usage.outputTokens,
              totalTokens: step.usage.totalTokens,
              cachedTokens,
            }
          : undefined

        // Persist only newly generated step messages
        const allMessages = (step.response?.messages ?? []) as ModelMessage[]
        const fresh = allMessages.slice(persistedCount)
        persistedCount = allMessages.length
        if (fresh.length > 0) {
          agentContext?.onStepPersist?.(fresh, stepUsage, 1)
        }

        onEvent?.({
          type: 'step-finish',
          stepNumber: stepsExecuted,
          finishReason: step.finishReason,
          usage: stepUsage,
        })
      },
      onError: (err) => {
        if (!streamError) streamError = err
      },
    })

    for await (const part of result.stream) {
      if (signal.aborted) break

      switch (part.type) {
        case 'text-delta': {
          accumulatedText += part.text
          onEvent?.({ type: 'text-delta', delta: part.text })
          break
        }
        case 'tool-call': {
          toolCallStartTimes.set(part.toolCallId, Date.now())
          onEvent?.({
            type: 'tool-call',
            callId: part.toolCallId,
            toolName: part.toolName,
            input: part.input,
          })
          break
        }
        case 'tool-result': {
          const startTime = toolCallStartTimes.get(part.toolCallId) ?? Date.now()
          const durationMs = Date.now() - startTime
          const isErr = (part.output as any)?.ok === false
          onEvent?.({
            type: 'tool-result',
            callId: part.toolCallId,
            toolName: part.toolName,
            output: isErr ? ((part.output as any)?.error ?? part.output) : part.output,
            durationMs,
            isError: isErr,
          })
          break
        }
        case 'tool-error': {
          const startTime = toolCallStartTimes.get((part as any).toolCallId) ?? Date.now()
          const durationMs = Date.now() - startTime
          onEvent?.({
            type: 'tool-result',
            callId: (part as any).toolCallId,
            toolName: (part as any).toolName,
            output: (part as any).error,
            durationMs,
            isError: true,
          })
          break
        }
        case 'error': {
          if (!streamError) streamError = (part as any).error
          break
        }
      }
    }

    if (signal.aborted) {
      return abortOutcome(signal, stepsExecuted, accumulatedText)
    }

    try {
      const allResponseMessages = (await result.responseMessages) as ModelMessage[]
      const rest = allResponseMessages.slice(persistedCount)
      if (rest.length > 0 && agentContext?.onStepPersist) {
        agentContext.onStepPersist(rest, undefined, 0)
      }
    } catch {
      // Non-fatal if stream aborted or ended prematurely
    }

    const finalStep = await result.finalStep
    const finalText = finalStep?.text ?? (await result.text) ?? accumulatedText
    const finalFinishReason = finalStep?.finishReason ?? (await result.finishReason)
    const finalUsage = await result.usage

    if (streamError && !signal.aborted && finalFinishReason !== 'stop') {
      const message = describeModelError(streamError, provider)
      return {
        status: 'model_error',
        exitCode: 3,
        text: finalText,
        stepsExecuted,
        error: message,
      }
    }

    let status: Status = 'completed'
    if (stepsExecuted >= config.maxSteps && finalFinishReason === 'tool-calls') {
      status = 'max_steps'
    } else if (finalFinishReason === 'length') {
      status = 'truncated'
    } else if (finalText.trim().length === 0) {
      if (stepsExecuted > 0 && finalFinishReason === 'stop') {
        status = 'completed'
      } else {
        status = 'empty_response'
      }
    }

    const exitCode = mapStatusToExitCode(status)

    return {
      status,
      exitCode,
      text: finalText,
      stepsExecuted,
      usage: finalUsage
        ? {
            inputTokens: finalUsage.inputTokens,
            outputTokens: finalUsage.outputTokens,
            totalTokens: finalUsage.totalTokens,
          }
        : undefined,
    }
  } catch (error) {
    if (signal.aborted) {
      return abortOutcome(signal, stepsExecuted, accumulatedText)
    }

    const effectiveError =
      streamError && (NoOutputGeneratedError.isInstance(error) || !error)
        ? streamError
        : error || streamError

    const describedError = describeModelError(effectiveError, provider)
    return {
      status: 'model_error',
      exitCode: 3,
      text: '',
      stepsExecuted,
      error: describedError,
    }
  }
}

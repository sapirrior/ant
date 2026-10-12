import {
  APICallError,
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
import { abortReasonOf } from './signals.ts'

export function abortOutcome(signal: AbortSignal, stepsExecuted: number, text = ''): ModelOutcome {
  const reason = abortReasonOf(signal)
  const isTimeout = reason === 'timeout'
  const isSigterm = reason === 'SIGTERM'
  const isSighup = reason === 'SIGHUP'

  const status: Status = isTimeout ? 'timeout' : 'cancelled'
  const exitCode: ExitCode = isTimeout ? 4 : isSigterm ? 143 : isSighup ? 129 : 130
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
 * Unwraps and describes AI SDK provider / network errors per Plan §9
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

    if (statusCode === 400 && /(context|token|length|too large|maximum context)/i.test(bodyText)) {
      return 'context too long — start a new thread'
    }

    if (apiErr.message) {
      return apiErr.message
    }
  }

  if (target instanceof Error) {
    return target.message
  }

  return String(target)
}

export interface RunAgentContext {
  tasks?: TaskManagerRegistry
  onStepPersist?: (messages: ModelMessage[], usage?: UsageSummary) => void
}

export async function runAgent(
  options: ModelRunOptions & { agentContext?: RunAgentContext }
): Promise<ModelOutcome> {
  const { config, messages, signal, threadId, onCheckpoint, onEvent, agentContext } = options
  const { model, provider } = resolveLanguageModel(config.model)
  const instructions = buildInstructions(config)

  const readState = new Map<string, string>()
  const tasks = agentContext?.tasks ?? new TaskManagerRegistry()

  const bashSettings = config.settings?.tools?.Bash
  const toolContext: ToolExecutionContext = {
    cwd: config.cwd,
    grants: config.grants,
    abortSignal: signal,
    readState,
    threadId,
    tasks,
    backgroundEnabled: true,
    foregroundMs: bashSettings?.foregroundMs,
    passEnv: bashSettings?.passEnv,
    onCheckpoint,
  }

  const tools = buildTools(toolContext, config.settings)
  let stepsExecuted = 0
  const toolCallStartTimes = new Map<string, number>()
  let streamError: unknown = null

  try {
    const result = streamText({
      model,
      instructions,
      messages,
      tools,
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
        // Disallow tool calls on the very last step per Plan §9
        if (stepNumber === config.maxSteps - 1) {
          return { toolChoice: 'none' }
        }
        return undefined
      },
      onStepEnd: (step) => {
        stepsExecuted++
        const stepUsage: UsageSummary | undefined = step.usage
          ? {
              inputTokens: step.usage.inputTokens,
              outputTokens: step.usage.outputTokens,
              totalTokens: step.usage.totalTokens,
            }
          : undefined

        // Persist step messages if callback provided
        if (step.response?.messages) {
          agentContext?.onStepPersist?.(step.response.messages as ModelMessage[], stepUsage)
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
          onEvent?.({
            type: 'tool-result',
            callId: part.toolCallId,
            toolName: part.toolName,
            output: part.output,
            durationMs,
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
      return abortOutcome(signal, stepsExecuted)
    }

    const finalStep = await result.finalStep
    const finalText = finalStep?.text ?? (await result.text)
    const finalFinishReason = finalStep?.finishReason ?? (await result.finishReason)
    const finalUsage = await result.usage

    let status: Status = 'completed'
    if (stepsExecuted >= config.maxSteps && finalFinishReason === 'tool-calls') {
      status = 'max_steps'
    } else if (finalFinishReason === 'length') {
      status = 'truncated'
    } else if (finalText.trim().length === 0) {
      status = 'empty_response'
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
      return abortOutcome(signal, stepsExecuted)
    }

    const describedError = describeModelError(error || streamError, provider)
    return {
      status: 'model_error',
      exitCode: 3,
      text: '',
      stepsExecuted,
      error: describedError,
    }
  }
}

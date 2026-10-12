import { isStepCount, streamText } from 'ai'
import { buildTools } from '../tools/index.ts'
import type { ToolExecutionContext, ExitCode, ModelOutcome, ModelRunOptions, Status } from './types.ts'
import { buildInstructions } from './prompt.ts'
import { resolveLanguageModel } from './model.ts'

function mapStatusToExitCode(status: Status): ExitCode {
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

export async function runAgent({ config, messages, signal, onEvent }: ModelRunOptions): Promise<ModelOutcome> {
  const { model } = resolveLanguageModel(config.model)
  const instructions = buildInstructions(config)

  const toolContext: ToolExecutionContext = {
    cwd: config.cwd,
    grants: config.grants,
    abortSignal: signal,
  }

  const tools = buildTools(toolContext)
  let stepsExecuted = 0
  const toolCallStartTimes = new Map<string, number>()

  try {
    const result = streamText({
      model,
      instructions,
      messages,
      tools,
      stopWhen: isStepCount(config.maxSteps),
      abortSignal: signal,
      prepareStep: ({ stepNumber }) => {
        if (stepNumber === config.maxSteps - 1) {
          return { toolChoice: 'none' }
        }
        return undefined
      },
      onStepEnd: ({ stepNumber, finishReason, usage }) => {
        stepsExecuted = stepNumber + 1
        onEvent?.({
          type: 'step-finish',
          stepNumber: stepsExecuted,
          finishReason,
          usage: usage
            ? {
                inputTokens: usage.inputTokens,
                outputTokens: usage.outputTokens,
                totalTokens: usage.totalTokens,
              }
            : undefined,
        })
      },
      onError: () => {},
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
        case 'error': {
          break
        }
      }
    }

    if (signal.aborted) {
      return {
        status: 'cancelled',
        exitCode: 130,
        text: '',
        stepsExecuted,
        error: 'Operation aborted by user signal.',
      }
    }

    const finalText = await result.text
    const finalUsage = await result.usage
    const finalFinishReason = await result.finishReason

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
      return {
        status: 'cancelled',
        exitCode: 130,
        text: '',
        stepsExecuted,
        error: 'Execution cancelled.',
      }
    }

    const errorMessage = error instanceof Error ? error.message : String(error)
    return {
      status: 'model_error',
      exitCode: 3,
      text: '',
      stepsExecuted,
      error: errorMessage,
    }
  }
}

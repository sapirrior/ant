import type { ToolExecutionContext, ToolExecutionResult, ToolName } from '../core/types.ts'
import { primaryArg } from '../policy/toolPermissions.ts'

export function raceWithSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) {
    return Promise.reject(new Error(`Execution aborted: ${signal.reason ?? 'user signal'}`))
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new Error(`Execution aborted: ${signal.reason ?? 'user signal'}`))
    signal.addEventListener('abort', onAbort, { once: true })
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', onAbort))
  })
}

export class ToolExecutionQueue {
  private tail: Promise<unknown> = Promise.resolve()

  async run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) {
      throw new Error(`Execution aborted: ${signal.reason ?? 'user signal'}`)
    }
    const runTask = () => raceWithSignal(task(), signal)
    const result = this.tail.then(runTask, runTask)
    this.tail = result.catch(() => {})
    return result
  }
}

export const globalToolQueue = new ToolExecutionQueue()

const MUTATING_TOOLS = new Set<string>(['WriteFile', 'EditFile', 'DeleteFile', 'Bash'])

export async function executeWithPolicy<TInput, TOutput>(
  toolName: ToolName | 'McpTool',
  input: TInput,
  context: ToolExecutionContext,
  action: (input: TInput, context: ToolExecutionContext) => Promise<TOutput>
): Promise<ToolExecutionResult<TOutput>> {
  const runner = async (): Promise<ToolExecutionResult<TOutput>> => {
    if (context.abortSignal?.aborted) {
      return {
        ok: false,
        output: null as unknown as TOutput,
        error: toolName === 'McpTool' ? 'Execution aborted' : `Execution of ${toolName} aborted by user signal.`,
      }
    }

    // Centralized Permission Policy Check
    if (context.effectivePermissions) {
      const arg = primaryArg(toolName as ToolName, input, context.cwd)
      const check = context.effectivePermissions.check(toolName as ToolName, arg)
      if (!check.allowed) {
        return {
          ok: false,
          output: null as unknown as TOutput,
          error: JSON.stringify({
            error: `Permission denied: ${check.reason ?? `${toolName} is not permitted.`}`.trim(),
          }),
        }
      }
    }

    try {
      const output = await raceWithSignal(action(input, context), context.abortSignal)
      return {
        ok: true,
        output,
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      return {
        ok: false,
        output: null as unknown as TOutput,
        error: errorMessage,
      }
    }
  }

  if (MUTATING_TOOLS.has(toolName)) {
    return globalToolQueue.run(runner, context.abortSignal)
  }
  return runner()
}

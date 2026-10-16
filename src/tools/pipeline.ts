import type { ToolExecutionContext, ToolExecutionResult, ToolName } from '../core/types.ts'

function abortRejection(signal?: AbortSignal): Promise<never> {
  if (!signal) return new Promise(() => {})
  if (signal.aborted) {
    return Promise.reject(new Error(`Execution aborted: ${signal.reason ?? 'user signal'}`))
  }
  return new Promise((_, reject) => {
    signal.addEventListener(
      'abort',
      () => reject(new Error(`Execution aborted: ${signal.reason ?? 'user signal'}`)),
      { once: true }
    )
  })
}

export class ToolExecutionQueue {
  private tail: Promise<unknown> = Promise.resolve()

  async run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) {
      throw new Error(`Execution aborted: ${signal.reason ?? 'user signal'}`)
    }
    const runTask = async () => Promise.race([task(), abortRejection(signal)])
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
      const primaryArg =
        typeof input === 'object' && input !== null
          ? ((input as { path?: string; command?: string; tool?: string }).path ??
             (input as { command?: string }).command ??
             (input as { tool?: string }).tool ??
             '')
          : ''

      const check = context.effectivePermissions.check(toolName as ToolName, String(primaryArg))
      if (!check.allowed) {
        return {
          ok: false,
          output: null as unknown as TOutput,
          error: JSON.stringify({
            error: `Permission denied: ${toolName} is not permitted. ${check.reason ?? ''}`.trim(),
          }),
        }
      }
    }

    try {
      const output = await Promise.race([
        action(input, context),
        abortRejection(context.abortSignal),
      ])
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

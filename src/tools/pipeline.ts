import { authorize } from '../policy/authorize.ts'
import { getRequiredCapabilityForTool } from '../policy/capabilities.ts'
import type { ToolExecutionContext, ToolExecutionResult, ToolName } from '../types/tools.ts'

export class ToolExecutionQueue {
  private tail: Promise<unknown> = Promise.resolve()

  async run<T>(task: () => Promise<T>): Promise<T> {
    const runTask = async () => task()
    const result = this.tail.then(runTask, runTask)
    this.tail = result.catch(() => {})
    return result
  }
}

export const globalToolQueue = new ToolExecutionQueue()

export async function executeWithPolicy<TInput, TOutput>(
  toolName: ToolName,
  input: TInput,
  context: ToolExecutionContext,
  action: (input: TInput, context: ToolExecutionContext) => Promise<TOutput>
): Promise<ToolExecutionResult<TOutput>> {
  // Serialize all tool executions through the queue to prevent parallel race conditions
  return globalToolQueue.run(async () => {
    // 1. Authorization check
    const requiredCap = getRequiredCapabilityForTool(toolName)
    const decision = authorize(requiredCap, context.grants)

    if (!decision.allowed) {
      return {
        ok: false,
        output: null as unknown as TOutput,
        error: decision.reason ?? `Operation not permitted for tool ${toolName}`,
      }
    }

    // 2. Abort signal check
    if (context.abortSignal?.aborted) {
      return {
        ok: false,
        output: null as unknown as TOutput,
        error: `Execution of ${toolName} aborted by user signal.`,
      }
    }

    // 3. Execute with error boundary
    try {
      const output = await action(input, context)
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
  })
}

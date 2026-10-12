import { tool } from 'ai'
import { z } from 'zod'
import type { ToolExecutionContext } from '../../core/types.ts'
import { executeWithPolicy } from '../pipeline.ts'
import { TASK_MANAGER_DESCRIPTION } from './prompt.ts'

export const taskManagerInputSchema = z.object({
  action: z.enum(['list', 'read', 'write', 'stop']).describe('Action to perform on background tasks.'),
  taskId: z.string().optional().describe('Task identifier (e.g. "t1"), required for read, write, stop.'),
  waitMs: z.number().int().min(0).max(30000).optional().describe('For "read": milliseconds to wait for new output (0..30000, default 0).'),
  input: z.string().optional().describe('For "write": text payload to send to standard input.'),
  newline: z.boolean().optional().default(true).describe('For "write": whether to append a trailing newline (default true).'),
  signal: z.enum(['SIGINT', 'SIGTERM', 'SIGKILL']).optional().default('SIGTERM').describe('For "stop": signal to send (default SIGTERM).'),
})

export function describeTaskManager(input: z.infer<typeof taskManagerInputSchema>): string {
  if (input.action === 'list') {
    return 'list'
  }
  return `${input.action} ${input.taskId ?? ''}`.trim()
}

export function summarizeTaskManager(output: unknown): string {
  if (!output || typeof output !== 'object') {
    return 'done'
  }
  const obj = output as Record<string, unknown>
  if (Array.isArray(obj.tasks)) {
    return `${obj.tasks.length} task(s)`
  }
  if (typeof obj.output === 'string') {
    const chars = obj.output.length
    const kb = (chars / 1024).toFixed(1)
    return `${kb} KB output · status: ${obj.status ?? 'unknown'}`
  }
  if (obj.action === 'write') {
    return `sent ${Number(obj.bytesWritten ?? 0)} chars to stdin`
  }
  if (obj.action === 'stop') {
    return `stopped task ${obj.taskId ?? ''}`
  }
  return 'ok'
}

export function createTaskManagerTool(context: ToolExecutionContext) {
  return tool({
    description: TASK_MANAGER_DESCRIPTION,
    inputSchema: taskManagerInputSchema,
    execute: async (input) => {
      return executeWithPolicy('TaskManager', input, context, async (args) => {
        const tasks = context.tasks
        if (!tasks) {
          throw new Error('Task manager is not active in this session.')
        }

        switch (args.action) {
          case 'list': {
            const list = tasks.list()
            return {
              tasks: list,
              count: list.length,
            }
          }

          case 'read': {
            if (!args.taskId) {
              throw new Error('Missing required "taskId" for "read" action.')
            }
            const readResult = await tasks.read(args.taskId, args.waitMs ?? 0)
            return {
              taskId: args.taskId,
              ...readResult,
            }
          }

          case 'write': {
            if (!args.taskId) {
              throw new Error('Missing required "taskId" for "write" action.')
            }
            if (args.input === undefined) {
              throw new Error('Missing required "input" text for "write" action.')
            }
            tasks.write(args.taskId, args.input, args.newline ?? true)
            return {
              action: 'write',
              taskId: args.taskId,
              bytesWritten: args.input.length + (args.newline ? 1 : 0),
              status: 'sent',
            }
          }

          case 'stop': {
            if (!args.taskId) {
              throw new Error('Missing required "taskId" for "stop" action.')
            }
            tasks.stop(args.taskId, args.signal ?? 'SIGTERM')
            return {
              action: 'stop',
              taskId: args.taskId,
              signal: args.signal ?? 'SIGTERM',
              status: 'stopped',
            }
          }

          default: {
            throw new Error(`Unknown action: "${(args as { action: string }).action}"`)
          }
        }
      })
    },
  })
}

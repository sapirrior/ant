import { describe, expect, it } from 'bun:test'
import { ToolExecutionQueue, executeWithPolicy } from './pipeline.ts'
import { buildTools } from './index.ts'
import type { ToolExecutionContext } from '../core/types.ts'

describe('ToolExecutionQueue', () => {
  it('serializes async tasks strictly in order', async () => {
    const queue = new ToolExecutionQueue()
    const executionOrder: number[] = []

    const p1 = queue.run(async () => {
      await new Promise((r) => setTimeout(r, 20))
      executionOrder.push(1)
      return 1
    })

    const p2 = queue.run(async () => {
      await new Promise((r) => setTimeout(r, 5))
      executionOrder.push(2)
      return 2
    })

    const p3 = queue.run(async () => {
      executionOrder.push(3)
      return 3
    })

    const results = await Promise.all([p1, p2, p3])
    expect(results).toEqual([1, 2, 3])
    expect(executionOrder).toEqual([1, 2, 3])
  })

  it('continues queue processing even if a task rejects', async () => {
    const queue = new ToolExecutionQueue()
    const executionOrder: string[] = []

    const p1 = queue.run(async () => {
      executionOrder.push('first')
      throw new Error('fail 1')
    })

    const p2 = queue.run(async () => {
      executionOrder.push('second')
      return 'ok'
    })

    await expect(p1).rejects.toThrow('fail 1')
    const r2 = await p2
    expect(r2).toBe('ok')
    expect(executionOrder).toEqual(['first', 'second'])
  })

  it('aborts execution when abortSignal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()

    const context: ToolExecutionContext = {
      cwd: process.cwd(),
      grants: {
        has: () => true,
        capabilities: new Set(['fs.read']),
      },
      abortSignal: controller.signal,
    }

    let actionRan = false
    const result = await executeWithPolicy('ReadFile', { path: 'test' }, context, async () => {
      actionRan = true
      return 'content'
    })

    expect(result.ok).toBe(false)
    expect(actionRan).toBe(false)
    expect(result.error).toMatch(/aborted by user signal/)
  })

  it('exposes only tools granted by capability', () => {
    const readOnlyCtx: ToolExecutionContext = {
      cwd: process.cwd(),
      grants: {
        has: (c) => c === 'fs.read',
        capabilities: new Set(['fs.read']),
      },
    }
    const readTools = Object.keys(buildTools(readOnlyCtx))
    expect(readTools).toContain('AskUser')
    expect(readTools).toContain('ReadFile')
    expect(readTools).toContain('ListDir')
    expect(readTools).toContain('Grep')
    expect(readTools).not.toContain('WriteFile')
    expect(readTools).not.toContain('Bash')
  })
})

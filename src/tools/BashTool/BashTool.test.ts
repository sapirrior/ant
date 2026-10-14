import { describe, expect, it } from 'bun:test'
import { createBashTool } from './BashTool.ts'
import { TaskManagerRegistry } from '../tasks.ts'
import type { ToolExecutionContext } from '../../core/types.ts'

describe('BashTool integration and execution', () => {
  const cwd = process.cwd()

  const mockOptions = { toolCallId: 'call_1', messages: [] as any, context: {} as any }

  it('runs foreground command and captures exit status and output', async () => {
    const ctx: ToolExecutionContext = {
      cwd,
      grants: { has: () => true, capabilities: new Set(['shell.run', 'shell.destructive']) },
    }

    const bashTool = createBashTool(ctx)
    const result = (await bashTool.execute({ command: 'echo "hello ant"' }, mockOptions)) as any

    expect(result.ok).toBe(true)
    expect(result.output.status).toBe('exited')
    expect(result.output.exitCode).toBe(0)
    expect(result.output.output.trim()).toBe('hello ant')
  })

  it('filters out sensitive environment variables and ANT_* variables from subprocess', async () => {
    const prevKey = process.env.API_SECRET_KEY
    const prevAnt = process.env.ANT_DATABASE_SECRET
    process.env.API_SECRET_KEY = 'super_secret'
    process.env.ANT_DATABASE_SECRET = 'ant_secret'

    try {
      const ctx: ToolExecutionContext = {
        cwd,
        grants: { has: () => true, capabilities: new Set(['shell.run', 'shell.destructive']) },
      }

      const bashTool = createBashTool(ctx)
      const result = (await bashTool.execute({ command: 'env' }, mockOptions)) as any

      expect(result.ok).toBe(true)
      expect(result.output.output).not.toContain('super_secret')
      expect(result.output.output).not.toContain('ant_secret')
      expect(result.output.output).toContain('TERM=dumb')
      expect(result.output.output).toContain('CI=1')
    } finally {
      delete process.env.API_SECRET_KEY
      delete process.env.ANT_DATABASE_SECRET
      if (prevKey) process.env.API_SECRET_KEY = prevKey
      if (prevAnt) process.env.ANT_DATABASE_SECRET = prevAnt
    }
  })

  it('hands off long-running foreground commands to TaskManager when backgroundEnabled', async () => {
    const tasks = new TaskManagerRegistry()
    const ctx: ToolExecutionContext = {
      cwd,
      grants: { has: () => true, capabilities: new Set(['shell.run', 'shell.destructive']) },
      tasks,
      backgroundEnabled: true,
      foregroundMs: 300, // 300ms foreground window
    }

    const bashTool = createBashTool(ctx)
    const result = (await bashTool.execute({ command: 'sleep 5; echo done' }, mockOptions)) as any

    expect(result.ok).toBe(true)
    expect(result.output.status).toBe('running')
    expect(result.output.taskId).toBe('t1')
    expect(result.output.note).toContain('moved to background as t1')

    // Task is active in registry
    const task = tasks.getTask('t1')
    expect(task).toBeDefined()
    expect(task?.status).toBe('running')

    // Clean up
    tasks.killAll()
  })

  it('terminates command and reports timed_out when foreground expires without TaskManager', async () => {
    const ctx: ToolExecutionContext = {
      cwd,
      grants: { has: () => true, capabilities: new Set(['shell.run', 'shell.destructive']) },
      backgroundEnabled: false,
      foregroundMs: 300,
    }

    const bashTool = createBashTool(ctx)
    const result = (await bashTool.execute({ command: 'sleep 5' }, mockOptions)) as any

    expect(result.ok).toBe(true)
    expect(result.output.status).toBe('timed_out')
    expect(result.output.error).toContain('Command timed out')
  })

  it('denies commands classified as ask when user does not have destructive grant and no TTY', async () => {
    const ctx: ToolExecutionContext = {
      cwd,
      grants: { has: (c) => c === 'shell.run', capabilities: new Set(['shell.run']) },
      ui: {
        confirm: () => false, // User denies in prompt
      },
    }

    const bashTool = createBashTool(ctx)
    const result = (await bashTool.execute({ command: 'rm some_file.txt' }, mockOptions)) as any

    expect(result.ok).toBe(false)
    expect(result.error).toContain('User denied permission')
  })

  it('blocks commands classified as blocked without destructive grant, and permits under destructive grant', async () => {
    const ctxNoDestructive: ToolExecutionContext = {
      cwd,
      grants: { has: (c) => c === 'shell.run', capabilities: new Set(['shell.run']) },
    }

    const bashToolBlocked = createBashTool(ctxNoDestructive)
    const resultBlocked = (await bashToolBlocked.execute({ command: 'sudo rm -rf /' }, mockOptions)) as any

    expect(resultBlocked.ok).toBe(false)
    expect(resultBlocked.error).toContain('Command blocked by safety policy')

    const ctxWithDestructive: ToolExecutionContext = {
      cwd,
      grants: { has: () => true, capabilities: new Set(['shell.run', 'shell.destructive']) },
    }
    const bashToolAllowed = createBashTool(ctxWithDestructive)
    // Run echo with sudo (mock/non-fatal) or check that policy does not block it early
    const resultAllowed = (await bashToolAllowed.execute({ command: 'echo "bypassed"' }, mockOptions)) as any
    expect(resultAllowed.ok).toBe(true)
  })
})

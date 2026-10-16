import { describe, expect, it } from 'bun:test'
import { createBashTool } from './BashTool.ts'
import { TaskManagerRegistry } from '../tasks.ts'
import { parseToolRule, resolveEffectivePermissions } from '../../policy/toolPermissions.ts'
import type { ToolExecutionContext } from '../../core/types.ts'

describe('BashTool integration and execution', () => {
  const cwd = process.cwd()

  const mockOptions = { toolCallId: 'call_1', messages: [] as any, context: {} as any }

  const bypassPermissions = resolveEffectivePermissions({
    mode: 'bypassPermissions',
    allowedRules: [],
    disallowedRules: [],
  })

  it('runs foreground command and captures exit status and output', async () => {
    const ctx: ToolExecutionContext = {
      cwd,
      effectivePermissions: bypassPermissions,
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
        effectivePermissions: bypassPermissions,
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
      effectivePermissions: bypassPermissions,
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
      effectivePermissions: bypassPermissions,
      backgroundEnabled: false,
      foregroundMs: 300,
    }

    const bashTool = createBashTool(ctx)
    const result = (await bashTool.execute({ command: 'sleep 5' }, mockOptions)) as any

    expect(result.ok).toBe(true)
    expect(result.output.status).toBe('timed_out')
    expect(result.output.error).toContain('Command timed out')
  })

  it('denies commands with actionable error message when no rule permits Bash', async () => {
    const defaultPermissions = resolveEffectivePermissions({
      mode: 'default',
      allowedRules: [],
      disallowedRules: [],
    })
    const ctx: ToolExecutionContext = {
      cwd,
      effectivePermissions: defaultPermissions,
    }

    const bashTool = createBashTool(ctx)
    const result = (await bashTool.execute({ command: 'ant --version' }, mockOptions)) as any

    expect(result.ok).toBe(false)
    expect(result.error).toContain('Permission denied')
    expect(result.error).toContain('Allow with --allowed-tools')
  })

  it('allows scoped rule like Bash(ant --version) without broad permissions', async () => {
    const scopedPermissions = resolveEffectivePermissions({
      mode: 'default',
      allowedRules: [parseToolRule('Bash(ant --version)')],
      disallowedRules: [],
    })
    const ctx: ToolExecutionContext = {
      cwd,
      effectivePermissions: scopedPermissions,
    }

    const bashTool = createBashTool(ctx)
    const result = (await bashTool.execute({ command: 'ant --version' }, mockOptions)) as any

    // Should not be denied by policy
    expect(result.ok).toBe(true)
  })

  it('blocks commands matching disallowed-tools override even if allowed', async () => {
    const permissions = resolveEffectivePermissions({
      mode: 'default',
      allowedRules: [parseToolRule('Bash')],
      disallowedRules: [parseToolRule('Bash(rm *)')],
    })
    const ctx: ToolExecutionContext = {
      cwd,
      effectivePermissions: permissions,
    }

    const bashTool = createBashTool(ctx)
    const result = (await bashTool.execute({ command: 'rm -rf /' }, mockOptions)) as any

    expect(result.ok).toBe(false)
    expect(result.error).toContain('Explicitly disallowed by rule')
  })
})

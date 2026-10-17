import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { buildTools } from '../src/tools/index.ts'
import { ToolExecutionQueue, executeWithPolicy } from '../src/tools/pipeline.ts'
import { atomicWrite, computeHash, snapshot } from '../src/tools/fs.ts'
import { createEditFileTool } from '../src/tools/EditFileTool/EditFileTool.ts'
import { createBashTool } from '../src/tools/BashTool/BashTool.ts'
import { createMcpTool } from '../src/tools/McpTool/McpTool.ts'
import { TaskManagerRegistry } from '../src/tools/tasks.ts'
import { resolveEffectivePermissions } from '../src/policy/toolPermissions.ts'
import type { ToolExecutionContext, ToolExecutionResult } from '../src/core/types.ts'

describe('tools subsystem (registration, pipeline, fs, bash, tasks, mcp)', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'ant-tools-test-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  describe('tool registration and execution pipeline', () => {
    it('serializes execution strictly in order through ToolExecutionQueue', async () => {
      const queue = new ToolExecutionQueue()
      const order: number[] = []

      const p1 = queue.run(async () => {
        await new Promise((r) => setTimeout(r, 20))
        order.push(1)
        return 1
      })
      const p2 = queue.run(async () => {
        await new Promise((r) => setTimeout(r, 5))
        order.push(2)
        return 2
      })
      const p3 = queue.run(async () => {
        order.push(3)
        return 3
      })

      const results = await Promise.all([p1, p2, p3])
      expect(results).toEqual([1, 2, 3])
      expect(order).toEqual([1, 2, 3])
    })

    it('enforces centralized policy and aborts when signal is triggered', async () => {
      const controller = new AbortController()
      controller.abort()

      const context: ToolExecutionContext = {
        cwd: tempDir,
        effectivePermissions: resolveEffectivePermissions({
          mode: 'default',
          allowedRules: [],
          disallowedRules: [],
        }),
        abortSignal: controller.signal,
      }

      let ran = false
      const result = await executeWithPolicy('ReadFile', { path: 'test' }, context, async () => {
        ran = true
        return 'content'
      })

      expect(result.ok).toBe(false)
      expect(ran).toBe(false)
      expect(result.error).toMatch(/aborted by user signal/)
    })

    it('exposes only read-only tools when in plan mode', () => {
      const planCtx: ToolExecutionContext = {
        cwd: tempDir,
        effectivePermissions: resolveEffectivePermissions({
          mode: 'plan',
          allowedRules: [],
          disallowedRules: [],
        }),
      }
      const tools = buildTools(planCtx)
      const toolNames = Object.keys(tools)
      expect(toolNames).toContain('ReadFile')
      expect(toolNames).toContain('ListDir')
      expect(toolNames).toContain('Grep')
      expect(toolNames).not.toContain('WriteFile')
      expect(toolNames).not.toContain('Bash')
    })
  })

  describe('atomic file operations and CAS enforcement', () => {
    it('snapshots and atomically writes nested files', () => {
      const target = join(tempDir, 'sub', 'test.txt')
      atomicWrite(target, 'hello ant', 0o644)

      const snap = snapshot(target)
      expect(snap).not.toBeNull()
      expect(snap!.hash).toBe(computeHash('hello ant'))
      expect(snap!.data.toString('utf-8')).toBe('hello ant')
    })

    it('replaces targeted content and enforces CAS read-before-write guard', async () => {
      const testFile = join(tempDir, 'sample.txt')
      writeFileSync(testFile, 'alpha\nbeta\ngamma\n', 'utf-8')

      const readState = new Map<string, string>()
      const context: ToolExecutionContext = {
        cwd: tempDir,
        effectivePermissions: resolveEffectivePermissions({
          mode: 'acceptEdits',
          allowedRules: [],
          disallowedRules: [],
        }),
        readState,
      }

      const editTool = createEditFileTool(context)
      if (!editTool.execute) throw new Error('execute is undefined')
      const execOpts = { messages: [], toolCallId: 'call_1', context: {} }

      // 1. Without reading the file first, edit is rejected by CAS
      const unreadRes = (await editTool.execute(
        { path: 'sample.txt', oldContent: 'beta', newContent: 'BETA', replaceAll: false },
        execOpts,
      )) as ToolExecutionResult<unknown>
      expect(unreadRes.ok).toBe(false)
      expect(unreadRes.error).toMatch(/File changed since you read it \(or was never read\)/)

      // 2. Setting correct hash permits edit
      readState.set('sample.txt', computeHash(readFileSync(testFile)))
      const successRes = (await editTool.execute(
        { path: 'sample.txt', oldContent: 'beta', newContent: 'BETA', replaceAll: false },
        execOpts,
      )) as ToolExecutionResult<unknown>
      expect(successRes.ok).toBe(true)
      expect(readFileSync(testFile, 'utf-8')).toBe('alpha\nBETA\ngamma\n')
    })

    it('rejects identical oldContent and newContent', async () => {
      const testFile = join(tempDir, 'sample.txt')
      writeFileSync(testFile, 'alpha\nbeta\n', 'utf-8')

      const context: ToolExecutionContext = {
        cwd: tempDir,
        effectivePermissions: resolveEffectivePermissions({
          mode: 'acceptEdits',
          allowedRules: [],
          disallowedRules: [],
        }),
      }

      const editTool = createEditFileTool(context)
      if (!editTool.execute) throw new Error('execute is undefined')
      const res = (await editTool.execute(
        { path: 'sample.txt', oldContent: 'beta', newContent: 'beta', replaceAll: false },
        { messages: [], toolCallId: 'call_2', context: {} },
      )) as ToolExecutionResult<unknown>

      expect(res.ok).toBe(false)
      expect(res.error).toMatch(/identical/)
    })
  })

  describe('BashTool and background TaskManager', () => {
    it('executes command, captures exitCode/stdout, and scrubs sensitive env vars', async () => {
      const prevSecret = process.env.ANT_SECRET_TEST
      process.env.ANT_SECRET_TEST = 'super_secret_val'

      try {
        const ctx: ToolExecutionContext = {
          cwd: tempDir,
          effectivePermissions: resolveEffectivePermissions({
            mode: 'bypassPermissions',
            allowedRules: [],
            disallowedRules: [],
          }),
        }

        const bashTool = createBashTool(ctx)
        const result = (await bashTool.execute(
          { command: 'echo "hello from bash"; env' },
          { toolCallId: 'bash_1', messages: [], context: {} },
        )) as any

        expect(result.ok).toBe(true)
        expect(result.output.status).toBe('exited')
        expect(result.output.exitCode).toBe(0)
        expect(result.output.output).toContain('hello from bash')
        expect(result.output.output).not.toContain('super_secret_val')
      } finally {
        delete process.env.ANT_SECRET_TEST
        if (prevSecret) process.env.ANT_SECRET_TEST = prevSecret
      }
    })

    it('tracks tasks and supports cursor-based incremental reads in TaskManager', async () => {
      const registry = new TaskManagerRegistry()
      const child = spawn('sh', ['-c', 'echo "line one"; echo "line two"'])
      const task = registry.createTask('test task', child)

      expect(task.id).toBe('t1')

      await new Promise((resolve) => {
        child.on('exit', resolve)
        setTimeout(resolve, 1000)
      })

      const read1 = await registry.read('t1')
      expect(read1.output).toContain('line one')
      expect(read1.output).toContain('line two')

      // Incremental read returns empty string since cursor advanced
      const read2 = await registry.read('t1')
      expect(read2.output).toBe('')
    })
  })

  describe('McpTool routing and boundaries', () => {
    it('validates schema requirements for MCP actions', async () => {
      const ctx: ToolExecutionContext = {
        cwd: tempDir,
        effectivePermissions: resolveEffectivePermissions({
          mode: 'bypassPermissions',
          allowedRules: [],
          disallowedRules: [],
        }),
      }

      const tool = createMcpTool(ctx)
      const res = await (tool.execute as any)({ action: 'list_tools' }, { messages: [] })
      expect(res.ok).toBe(false)
      expect(res.error).toContain('Missing required parameter "server"')
    })

    it('denies execution when MCP tool is not permitted by policy', async () => {
      const ctx: ToolExecutionContext = {
        cwd: tempDir,
        effectivePermissions: resolveEffectivePermissions({
          mode: 'default',
          allowedRules: [],
          disallowedRules: [],
        }),
      }

      const tool = createMcpTool(ctx)
      const res = await (tool.execute as any)(
        { action: 'call', server: 'github', tool: 'delete_repo' },
        { messages: [] },
      )
      expect(res.ok).toBe(false)
      expect(res.error).toContain('Permission denied')
    })
  })
})

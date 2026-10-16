import { describe, expect, it } from 'bun:test'
import { createMcpTool } from './McpTool.ts'
import type { ToolExecutionContext } from '../../core/types.ts'
import { parseToolRule, resolveEffectivePermissions } from '../../policy/toolPermissions.ts'

describe('McpTool agent boundary (src/tools/McpTool)', () => {
  const bypassPermissions = resolveEffectivePermissions({
    mode: 'bypassPermissions',
    allowedRules: [],
    disallowedRules: [],
  })

  it('validates required parameters and schema constraints', async () => {
    const mockContext: ToolExecutionContext = {
      cwd: process.cwd(),
      effectivePermissions: bypassPermissions,
    }

    const tool = createMcpTool(mockContext)

    // Missing server on list_tools
    const res1 = await (tool.execute as any)(
      { action: 'list_tools' },
      { messages: [] }
    )
    expect(res1.ok).toBe(false)
    expect(res1.error).toContain('Missing required parameter "server"')

    // Missing server on call
    const res2 = await (tool.execute as any)(
      { action: 'call', tool: 'my_tool' },
      { messages: [] }
    )
    expect(res2.ok).toBe(false)
    expect(res2.error).toContain('Missing required parameter "server"')

    // Missing tool on call
    const res3 = await (tool.execute as any)(
      { action: 'call', server: 'my_server' },
      { messages: [] }
    )
    expect(res3.ok).toBe(false)
    expect(res3.error).toContain('Missing required parameter "tool"')
  })

  it('rejects execution non-interactively when MCP tool requires explicit approval', async () => {
    const defaultPermissions = resolveEffectivePermissions({
      mode: 'default',
      allowedRules: [],
      disallowedRules: [],
    })
    const mockContext: ToolExecutionContext = {
      cwd: process.cwd(),
      effectivePermissions: defaultPermissions,
    }

    const tool = createMcpTool(mockContext)
    const result = await (tool.execute as any)(
      { action: 'call', server: 'github', tool: 'delete_repo', args: { repo: 'test' } },
      { messages: [] }
    )

    expect(result.ok).toBe(false)
    expect(result.error).toContain('Permission denied')
  })

  it('allows execution without prompt when tool matches McpTool(server/*) pattern', async () => {
    const fakeManager: any = {
      callTool: async (server: string, t: string, args: any) => {
        return { ok: true, output: { success: true, server, t, args } }
      },
    }

    const scopedPermissions = resolveEffectivePermissions({
      mode: 'default',
      allowedRules: [parseToolRule('McpTool(github/*)')],
      disallowedRules: [],
    })

    const mockContext: ToolExecutionContext = {
      cwd: process.cwd(),
      effectivePermissions: scopedPermissions,
      mcpManager: fakeManager,
    }

    const tool = createMcpTool(mockContext)
    const result = await (tool.execute as any)(
      { action: 'call', server: 'github', tool: 'get_repo', args: { repo: 'test' } },
      { messages: [] }
    )

    expect(result.ok).toBe(true)
    expect(result.output).toEqual({
      success: true,
      server: 'github',
      t: 'get_repo',
      args: { repo: 'test' },
    })
  })

  it('enforces disallowed-tools override even when allow wildcard is present', async () => {
    const permissions = resolveEffectivePermissions({
      mode: 'default',
      allowedRules: [parseToolRule('McpTool(*)')],
      disallowedRules: [parseToolRule('McpTool(github/delete_repo)')],
    })

    const mockContext: ToolExecutionContext = {
      cwd: process.cwd(),
      effectivePermissions: permissions,
    }

    const tool = createMcpTool(mockContext)
    const result = await (tool.execute as any)(
      { action: 'call', server: 'github', tool: 'delete_repo' },
      { messages: [] }
    )

    expect(result.ok).toBe(false)
    expect(result.error).toContain('Explicitly disallowed by rule')
  })

  it('aborts cleanly when signal is already aborted', async () => {
    const abortController = new AbortController()
    abortController.abort()

    const mockContext: ToolExecutionContext = {
      cwd: process.cwd(),
      effectivePermissions: bypassPermissions,
      abortSignal: abortController.signal,
    }

    const tool = createMcpTool(mockContext)
    const result = await (tool.execute as any)(
      { action: 'list_servers' },
      { messages: [], abortSignal: abortController.signal }
    )

    expect(result.ok).toBe(false)
    expect(result.error).toBe('Execution aborted')
  })

  it('supports glob allow and deny patterns per B-036', async () => {
    const fakeManager: any = {
      callTool: async (server: string, t: string, _args: any) => ({ ok: true, output: { server, t } }),
    }
    const permissions = resolveEffectivePermissions({
      mode: 'default',
      allowedRules: [parseToolRule('McpTool(db/*)'), parseToolRule('McpTool(*/read_*)')],
      disallowedRules: [parseToolRule('McpTool(db/drop_*)')],
    })

    const mockContext: ToolExecutionContext = {
      cwd: process.cwd(),
      effectivePermissions: permissions,
      mcpManager: fakeManager,
    }

    const tool = createMcpTool(mockContext)

    // db/drop_table should be denied by db/drop_*
    const resDenied = await (tool.execute as any)({ action: 'call', server: 'db', tool: 'drop_table' }, { messages: [] })
    expect(resDenied.ok).toBe(false)
    expect(resDenied.error).toContain('Explicitly disallowed by rule')

    // x/read_file should be allowed by */read_*
    const resAllowed = await (tool.execute as any)({ action: 'call', server: 'x', tool: 'read_file' }, { messages: [] })
    expect(resAllowed.ok).toBe(true)
  })
})

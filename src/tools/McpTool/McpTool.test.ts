import { describe, expect, it } from 'bun:test'
import { createMcpTool } from './McpTool.ts'
import type { ToolExecutionContext } from '../../core/types.ts'
import { resolveEffectivePermissions } from '../../policy/toolPermissions.ts'

describe('McpTool agent boundary (src/tools/McpTool)', () => {
  const dummyEffectivePermissions = resolveEffectivePermissions({
    mode: 'bypassPermissions',
    allowedRules: [],
    disallowedRules: [],
  })

  it('validates required parameters and schema constraints', async () => {
    const mockContext: ToolExecutionContext = {
      cwd: process.cwd(),
      effectivePermissions: dummyEffectivePermissions,
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
    const mockContext: ToolExecutionContext = {
      cwd: process.cwd(),
      effectivePermissions: dummyEffectivePermissions,
      allowedMcpPatterns: [],
    }

    const tool = createMcpTool(mockContext)
    const result = await (tool.execute as any)(
      { action: 'call', server: 'github', tool: 'delete_repo', args: { repo: 'test' } },
      { messages: [] }
    )

    expect(result.ok).toBe(false)
    expect(result.error).toContain('Permission denied: MCP tool "github/delete_repo" requires explicit approval')
  })

  it('allows execution without prompt when tool matches --allow-mcp pattern', async () => {
    const fakeManager: any = {
      callTool: async (server: string, t: string, args: any) => {
        return { ok: true, output: { success: true, server, t, args } }
      },
    }

    const mockContext: ToolExecutionContext = {
      cwd: process.cwd(),
      effectivePermissions: dummyEffectivePermissions,
      mcpManager: fakeManager,
      allowedMcpPatterns: ['github/*'],
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

  it('enforces --deny-mcp denial override even when allow wildcard is present', async () => {
    const mockContext: ToolExecutionContext = {
      cwd: process.cwd(),
      effectivePermissions: dummyEffectivePermissions,
      allowedMcpPatterns: ['*'], // allowed all
      deniedMcpPatterns: ['github/delete_repo'], // but explicitly denied delete_repo
    }

    const tool = createMcpTool(mockContext)
    const result = await (tool.execute as any)(
      { action: 'call', server: 'github', tool: 'delete_repo' },
      { messages: [] }
    )

    expect(result.ok).toBe(false)
    expect(result.error).toContain('denied by policy')
  })

  it('aborts cleanly when signal is already aborted', async () => {
    const abortController = new AbortController()
    abortController.abort()

    const mockContext: ToolExecutionContext = {
      cwd: process.cwd(),
      effectivePermissions: dummyEffectivePermissions,
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
    const mockContext: ToolExecutionContext = {
      cwd: process.cwd(),
      effectivePermissions: dummyEffectivePermissions,
      mcpManager: fakeManager,
      allowedMcpPatterns: ['db/*', '*/read_*'],
      deniedMcpPatterns: ['db/drop_*'],
    }

    const tool = createMcpTool(mockContext)

    // db/drop_table should be denied by db/drop_*
    const resDenied = await (tool.execute as any)({ action: 'call', server: 'db', tool: 'drop_table' }, { messages: [] })
    expect(resDenied.ok).toBe(false)
    expect(resDenied.error).toContain('denied by policy')

    // x/read_file should be allowed by */read_*
    const resAllowed = await (tool.execute as any)({ action: 'call', server: 'x', tool: 'read_file' }, { messages: [] })
    expect(resAllowed.ok).toBe(true)
  })
})

import { tool } from 'ai'
import { z } from 'zod'
import type { ToolExecutionContext, ToolExecutionResult } from '../../core/types.ts'
import { McpClientManager } from '../../mcp/manager.ts'
import { checkMcpToolPolicy } from '../../policy/mcp.ts'
import { promptConfirmTTY } from '../../output/tty.ts'
import { MCP_TOOL_PROMPT } from './prompt.ts'

const mcpInputSchema = z.object({
  action: z.enum(['list_servers', 'list_tools', 'call']).describe('The action to perform'),
  server: z.string().optional().describe('Target MCP server name (required for "list_tools" and "call")'),
  tool: z.string().optional().describe('Target tool name on the MCP server (required for "call")'),
  args: z.record(z.string(), z.unknown()).optional().describe('Arguments to pass to the MCP tool (for "call")'),
})

export function createMcpTool(context: ToolExecutionContext) {
  const manager = context.mcpManager ?? new McpClientManager({ cwd: context.cwd })

  return tool({
    description: MCP_TOOL_PROMPT,
    inputSchema: mcpInputSchema,
    execute: async (input, { abortSignal }): Promise<ToolExecutionResult> => {
      const signal = abortSignal ?? context.abortSignal
      if (signal?.aborted) {
        return {
          ok: false,
          output: null,
          error: 'Execution aborted',
        }
      }

      switch (input.action) {
        case 'list_servers': {
          try {
            const serversMap = manager.getServers()
            const servers = Array.from(serversMap.values()).map((s) => ({
              name: s.name,
              transport: s.config.transport,
              scope: s.scope,
              enabled: s.enabled,
            }))
            return {
              ok: true,
              output: {
                count: servers.length,
                servers,
              },
            }
          } catch (err) {
            return {
              ok: false,
              output: null,
              error: err instanceof Error ? err.message : String(err),
            }
          }
        }

        case 'list_tools': {
          if (!input.server) {
            return {
              ok: false,
              output: null,
              error: 'Missing required parameter "server" for action "list_tools"',
            }
          }

          try {
            const tools = await manager.listTools(input.server)
            return {
              ok: true,
              output: {
                server: input.server,
                tools,
              },
            }
          } catch (err) {
            return {
              ok: false,
              output: null,
              error: err instanceof Error ? err.message : String(err),
            }
          }
        }

        case 'call': {
          if (!input.server) {
            return {
              ok: false,
              output: null,
              error: 'Missing required parameter "server" for action "call"',
            }
          }

          if (!input.tool) {
            return {
              ok: false,
              output: null,
              error: 'Missing required parameter "tool" for action "call"',
            }
          }

          // Authorization policy check: allowed vs explicitly denied vs ask confirmation
          const verdict = checkMcpToolPolicy(
            input.server,
            input.tool,
            context.allowedMcpPatterns ?? [],
            context.deniedMcpPatterns ?? []
          )

          if (verdict.status === 'denied') {
            return {
              ok: false,
              output: null,
              error: `MCP tool execution denied by policy: ${verdict.reason}. Do not attempt to retry.`,
            }
          }

          if (verdict.status === 'ask') {
            const promptArgs = JSON.stringify(input.args ?? {}, null, 2)
            const confirmed = context.ui?.confirm
              ? context.ui.confirm({
                  message: `MCP tool wants to run: ${input.server}/${input.tool}`,
                  command: promptArgs,
                  reason: verdict.reason,
                })
              : promptConfirmTTY({
                  message: `MCP tool wants to run: ${input.server}/${input.tool}`,
                  command: promptArgs,
                  reason: verdict.reason,
                })

            if (!confirmed) {
              return {
                ok: false,
                output: null,
                error: `User denied permission to execute MCP tool "${input.server}/${input.tool}". Do not retry without user approval.`,
              }
            }
          }

          if (signal?.aborted) {
            return {
              ok: false,
              output: null,
              error: 'Execution aborted',
            }
          }

          const result = await manager.callTool(input.server, input.tool, input.args ?? {})
          if (!result.ok) {
            return {
              ok: false,
              output: null,
              error: result.error ?? 'Unknown error executing MCP tool',
            }
          }

          return {
            ok: true,
            output: result.output,
          }
        }

        default:
          return {
            ok: false,
            output: null,
            error: `Unsupported action "${(input as any).action}"`,
          }
      }
    },
  })
}

import { tool } from 'ai'
import { z } from 'zod'
import type { ToolExecutionContext, ToolExecutionResult } from '../../core/types.ts'
import { executeWithPolicy } from '../pipeline.ts'
import { MCP_TOOL_PROMPT } from './prompt.ts'
import { McpClientManager } from '../../mcp/manager.ts'
import { checkMcpToolPolicy } from '../../policy/mcp.ts'

export const mcpInputSchema = z.object({
  action: z.enum(['list_servers', 'list_tools', 'call']).describe('The MCP action to perform'),
  server: z.string().optional().describe('The name of the target MCP server'),
  tool: z.string().optional().describe('The tool name to execute on the server (for "call")'),
  args: z.record(z.string(), z.unknown()).optional().describe('Arguments to pass to the MCP tool (for "call")'),
})

export function createMcpTool(context: ToolExecutionContext) {
  const manager = context.mcpManager ?? new McpClientManager({ cwd: context.cwd })

  return tool({
    description: MCP_TOOL_PROMPT,
    inputSchema: mcpInputSchema,
    execute: async (input, { abortSignal }: { abortSignal?: AbortSignal } = {}): Promise<ToolExecutionResult> => {
      const mergedContext = abortSignal ? { ...context, abortSignal } : context
      return executeWithPolicy('McpTool', input, mergedContext, async () => {
        const signal = mergedContext.abortSignal
        switch (input.action) {
          case 'list_servers': {
            const serversMap = manager.getServers()
            const servers = Array.from(serversMap.values()).map((s) => ({
              name: s.name,
              transport: s.config.transport,
              scope: s.scope,
              enabled: s.enabled,
            }))
            return {
              count: servers.length,
              servers,
            }
          }

          case 'list_tools': {
            if (!input.server) {
              throw new Error('Missing required parameter "server" for action "list_tools"')
            }

            const tools = await manager.listTools(input.server)
            return {
              server: input.server,
              tools,
            }
          }

          case 'call': {
            if (!input.server) {
              throw new Error('Missing required parameter "server" for action "call"')
            }

            if (!input.tool) {
              throw new Error('Missing required parameter "tool" for action "call"')
            }

            // Authorization policy check: allowed vs explicitly denied vs ask confirmation
            const verdict = checkMcpToolPolicy(
              input.server,
              input.tool,
              context.allowedMcpPatterns ?? [],
              context.deniedMcpPatterns ?? []
            )

            if (verdict.status === 'denied') {
              throw new Error(`MCP tool execution denied by policy: ${verdict.reason}. Do not attempt to retry.`)
            }

            if (verdict.status === 'ask') {
              throw new Error(
                `Permission denied: MCP tool "${input.server}/${input.tool}" requires explicit approval. Pre-approve with --allowed-tools "McpTool" or --allowed-tools "McpTool(${input.server}/*)".`
              )
            }

            if (signal?.aborted) {
              throw new Error('Execution aborted')
            }

            const result = await manager.callTool(input.server, input.tool, input.args ?? {})
            if (!result.ok) {
              throw new Error(result.error ?? 'Unknown error executing MCP tool')
            }

            return result.output
          }

          default:
            throw new Error(`Unsupported action "${(input as any).action}"`)
        }
      })
    },
  })
}

import { tool } from 'ai'
import { z } from 'zod'
import type { ToolExecutionContext, ToolExecutionResult } from '../../core/types.ts'
import { executeWithPolicy } from '../pipeline.ts'
import { MCP_TOOL_PROMPT } from './prompt.ts'
import { McpClientManager } from '../../mcp/manager.ts'
import { checkMcpToolPolicy } from '../../policy/mcp.ts'
import { hasControllingTTY, promptConfirmTTY } from '../../output/tty.ts'

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
              const promptArgs = JSON.stringify(input.args ?? {}, null, 2)
              const hasTTY = hasControllingTTY()
              if (!context.ui?.confirm && !hasTTY) {
                throw new Error(
                  `No terminal available for interactive confirmation. Pre-approve with --allow-mcp "${input.server}/${input.tool}".`
                )
              }

              const confirmed = await (context.ui?.confirm
                ? Promise.resolve(
                    context.ui.confirm({
                      message: `MCP tool wants to run: ${input.server}/${input.tool}`,
                      command: promptArgs,
                      reason: verdict.reason,
                    })
                  )
                : promptConfirmTTY({
                    message: `MCP tool wants to run: ${input.server}/${input.tool}`,
                    command: promptArgs,
                    reason: verdict.reason,
                    signal: context.abortSignal,
                  }))

              if (!confirmed) {
                throw new Error(
                  `User denied permission to execute MCP tool "${input.server}/${input.tool}". Do not retry without user approval.`
                )
              }
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

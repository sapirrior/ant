import { createMCPClient, type MCPClient, MCPClientError } from '@ai-sdk/mcp'
import { Experimental_StdioMCPTransport } from '@ai-sdk/mcp/mcp-stdio'
import { resolveMergedMcpServers } from './config.ts'
import type { McpToolInfo, ResolvedMcpServer } from './types.ts'

export interface McpManagerOptions {
  readonly cwd?: string
}

export interface McpToolCallResult {
  readonly ok: boolean
  readonly output?: unknown
  readonly error?: string
}

function buildCleanSubprocessEnv(
  declaredEnv: Readonly<Record<string, string>> = {}
): Record<string, string> {
  const env: Record<string, string> = {}
  const secretPattern = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL)/i

  for (const [key, val] of Object.entries(process.env)) {
    if (val === undefined) continue
    if (key.startsWith('ANT_')) continue
    // Sensitive variables not inherited unless explicitly provided in server config
    if (secretPattern.test(key) && !(key in declaredEnv)) continue
    env[key] = val
  }

  // Explicitly declared env variables from config always take precedence
  for (const [key, val] of Object.entries(declaredEnv)) {
    env[key] = val
  }

  // Sensible terminal defaults
  env.TERM = 'dumb'
  env.NO_COLOR = '1'
  env.CI = '1'

  return env
}

export class McpClientManager {
  private readonly cwd: string
  private readonly activeClients = new Map<string, MCPClient>()
  private cachedServers: Map<string, ResolvedMcpServer> | null = null

  constructor(options: McpManagerOptions = {}) {
    this.cwd = options.cwd ?? process.cwd()
  }

  /**
   * Refreshes and returns all available MCP servers (project level > global level).
   */
  getServers(): Map<string, ResolvedMcpServer> {
    if (!this.cachedServers) {
      this.cachedServers = resolveMergedMcpServers(this.cwd)
    }
    return this.cachedServers
  }

  /**
   * Clears server cache so subsequent requests reload from disk.
   */
  invalidateCache(): void {
    this.cachedServers = null
  }

  /**
   * Lazily connects to an MCP server or retrieves the cached client.
   */
  async getClient(serverName: string): Promise<MCPClient> {
    const existing = this.activeClients.get(serverName)
    if (existing) {
      return existing
    }

    const servers = this.getServers()
    const resolved = servers.get(serverName)
    if (!resolved) {
      throw new Error(`MCP server "${serverName}" not found in configuration.`)
    }

    if (!resolved.enabled) {
      throw new Error(`MCP server "${serverName}" is currently disabled.`)
    }

    const config = resolved.config
    let client: MCPClient

    try {
      if (config.transport === 'stdio') {
        const env = buildCleanSubprocessEnv(config.env ?? {})
        const cwd = config.cwd ?? this.cwd
        const transport = new Experimental_StdioMCPTransport({
          command: config.command,
          args: config.args ? [...config.args] : [],
          env,
          cwd,
        })
        client = await createMCPClient({ transport })
      } else {
        const headers: Record<string, string> = {}
        if (config.headers) {
          for (const [k, v] of Object.entries(config.headers)) {
            // Expand environment variables like ${FOO_TOKEN}
            headers[k] = v.replace(/\$\{([^}]+)\}/g, (_, envVar) => process.env[envVar] ?? '')
          }
        }

        client = await createMCPClient({
          transport: {
            type: config.transport === 'sse' ? 'sse' : 'http',
            url: config.url,
            headers,
          },
        })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`Failed to connect to MCP server "${serverName}": ${msg}`)
    }

    this.activeClients.set(serverName, client)
    return client
  }

  /**
   * Lists available tools from a specific server.
   */
  async listTools(serverName: string): Promise<McpToolInfo[]> {
    const client = await this.getClient(serverName)
    const rawTools = await client.tools()
    const result: McpToolInfo[] = []

    for (const [name, tool] of Object.entries(rawTools)) {
      const t = tool as { description?: string; parameters?: unknown }
      result.push({
        name,
        description: t.description,
        inputSchema: t.parameters,
      })
    }

    return result
  }

  /**
   * Executes a tool on a target MCP server.
   */
  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown> = {}
  ): Promise<McpToolCallResult> {
    try {
      const client = await this.getClient(serverName)
      const tools = await client.tools()
      const targetTool = tools[toolName]

      if (!targetTool) {
        return {
          ok: false,
          error: `Tool "${toolName}" not found on MCP server "${serverName}".`,
        }
      }

      if (typeof (targetTool as any).execute !== 'function') {
        return {
          ok: false,
          error: `Tool "${toolName}" on MCP server "${serverName}" is not executable.`,
        }
      }

      const output = await (targetTool as any).execute(args)
      return {
        ok: true,
        output,
      }
    } catch (err) {
      let message = err instanceof Error ? err.message : String(err)
      if (MCPClientError.isInstance(err)) {
        message = `MCP Error (${err.code ?? err.statusCode ?? 'unknown'}): ${err.message}`
      }
      return {
        ok: false,
        error: `MCP server "${serverName}" failed executing "${toolName}": ${message}`,
      }
    }
  }

  /**
   * Gracefully closes all active MCP client sessions and terminates subprocesses.
   */
  async closeAll(): Promise<void> {
    const promises: Promise<void>[] = []
    for (const client of this.activeClients.values()) {
      promises.push(
        client.close().catch(() => {
          // Suppress close error on shutdown
        })
      )
    }
    this.activeClients.clear()
    await Promise.all(promises)
  }

  /**
   * Immediate synchronous/unconditional termination for emergency lifecycle aborts.
   */
  killAll(): void {
    for (const client of this.activeClients.values()) {
      try {
        void client.close()
      } catch {}
    }
    this.activeClients.clear()
  }
}

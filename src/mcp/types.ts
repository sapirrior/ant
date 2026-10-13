export type McpTransportType = 'stdio' | 'http' | 'sse'
export type McpScope = 'project' | 'global'

export interface McpStdioConfig {
  readonly transport: 'stdio'
  readonly command: string
  readonly args?: readonly string[]
  readonly env?: Readonly<Record<string, string>>
  readonly cwd?: string
  readonly enabled?: boolean
}

export interface McpHttpConfig {
  readonly transport: 'http' | 'sse'
  readonly url: string
  readonly headers?: Readonly<Record<string, string>>
  readonly enabled?: boolean
}

export type McpServerConfig = McpStdioConfig | McpHttpConfig

export interface ResolvedMcpServer {
  readonly name: string
  readonly config: McpServerConfig
  readonly scope: McpScope
  readonly enabled: boolean
}

export interface McpConfigFile {
  readonly mcpServers?: Readonly<Record<string, McpServerConfig>>
}

export interface McpToolCallArgs {
  readonly action: 'list_servers' | 'list_tools' | 'call'
  readonly server?: string
  readonly tool?: string
  readonly args?: Readonly<Record<string, unknown>>
}

export interface McpToolInfo {
  readonly name: string
  readonly description?: string
  readonly inputSchema?: unknown
}

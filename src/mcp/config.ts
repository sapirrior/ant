import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { McpConfigFile, McpScope, McpServerConfig, ResolvedMcpServer } from './types.ts'

import { getAntHome } from '../paths.ts'
import { withFileLock } from '../utils/fileLock.ts'
import { writeAtomicJsonFile } from '../utils/atomicJson.ts'
export { getAntHome } from '../paths.ts'

export function getGlobalMcpConfigPath(): string {
  return join(getAntHome(), 'mcp.json')
}

export function getGlobalMcpLockPath(): string {
  return join(getAntHome(), 'mcp.json.lock')
}

export function getProjectMcpConfigPath(cwd: string = process.cwd()): string {
  return join(cwd, '.ant', 'mcp.json')
}

export function getProjectMcpLockPath(cwd: string = process.cwd()): string {
  return join(cwd, '.ant', 'mcp.json.lock')
}

export async function withMcpFileLock<T>(lockPath: string, fn: () => T | Promise<T>): Promise<T> {
  return withFileLock(lockPath, fn, { name: 'MCP' })
}

export function loadMcpConfigFile(filePath: string): McpConfigFile {
  if (!existsSync(filePath)) {
    return { mcpServers: {} }
  }

  let raw: string
  try {
    raw = readFileSync(filePath, 'utf-8')
  } catch (err) {
    throw new Error(
      `Failed to read MCP config from ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  if (!raw.trim()) {
    return { mcpServers: {} }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new Error(
      `MCP config file at ${filePath} is malformed JSON: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`MCP config file at ${filePath} must contain a JSON object.`)
  }

  const obj = parsed as Record<string, unknown>
  if (obj.mcpServers === undefined) {
    return { mcpServers: {} }
  }

  if (
    typeof obj.mcpServers !== 'object' ||
    obj.mcpServers === null ||
    Array.isArray(obj.mcpServers)
  ) {
    throw new Error(`MCP config file at ${filePath}: "mcpServers" must be an object.`)
  }

  const validatedServers: Record<string, McpServerConfig> = {}
  for (const [name, srv] of Object.entries(obj.mcpServers as Record<string, unknown>)) {
    validatedServers[name] = validateMcpServerConfig(name, srv, filePath)
  }
  return { mcpServers: validatedServers }
}

export function validateMcpServerConfig(
  serverName: string,
  config: unknown,
  filePath: string,
): McpServerConfig {
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    throw new Error(
      `Invalid MCP config for server "${serverName}" in ${filePath}: configuration must be an object.`,
    )
  }

  const s = config as Record<string, unknown>
  const transport = s.transport

  if (transport !== 'stdio' && transport !== 'http' && transport !== 'sse') {
    throw new Error(
      `Invalid MCP config for server "${serverName}" in ${filePath}: transport must be "stdio", "http", or "sse".`,
    )
  }

  if (transport === 'stdio') {
    if (typeof s.command !== 'string' || !s.command.trim()) {
      throw new Error(
        `Invalid MCP config for server "${serverName}" in ${filePath}: stdio transport requires a "command" string.`,
      )
    }
    if (s.args !== undefined && !Array.isArray(s.args)) {
      throw new Error(
        `Invalid MCP config for server "${serverName}" in ${filePath}: "args" must be an array of strings.`,
      )
    }
    return {
      transport: 'stdio',
      command: s.command.trim(),
      args: s.args as string[] | undefined,
      env: s.env as Record<string, string> | undefined,
      cwd: typeof s.cwd === 'string' ? s.cwd : undefined,
      enabled: s.enabled !== false,
    }
  }

  if (typeof s.url !== 'string' || !s.url.trim()) {
    throw new Error(
      `Invalid MCP config for server "${serverName}" in ${filePath}: ${transport} transport requires a "url" string.`,
    )
  }

  return {
    transport,
    url: s.url.trim(),
    headers: s.headers as Record<string, string> | undefined,
    enabled: s.enabled !== false,
  }
}

export function saveMcpConfigFile(filePath: string, config: McpConfigFile): void {
  writeAtomicJsonFile(filePath, config)
}

export function resolveMergedMcpServers(
  cwd: string = process.cwd(),
  options: { ignoreProjectScope?: boolean } = {},
): Map<string, ResolvedMcpServer> {
  const globalPath = getGlobalMcpConfigPath()
  const projectPath = getProjectMcpConfigPath(cwd)

  const globalConfig = loadMcpConfigFile(globalPath)
  const projectConfig = options.ignoreProjectScope
    ? { mcpServers: {} }
    : loadMcpConfigFile(projectPath)

  const map = new Map<string, ResolvedMcpServer>()

  // 1. Add global servers
  if (globalConfig.mcpServers) {
    for (const [name, server] of Object.entries(globalConfig.mcpServers)) {
      if (server && typeof server === 'object') {
        map.set(name, {
          name,
          config: server,
          scope: 'global',
          enabled: server.enabled !== false,
        })
      }
    }
  }

  // 2. Add / override with project servers
  if (projectConfig.mcpServers) {
    for (const [name, server] of Object.entries(projectConfig.mcpServers)) {
      if (server && typeof server === 'object') {
        map.set(name, {
          name,
          config: server,
          scope: 'project',
          enabled: server.enabled !== false,
        })
      }
    }
  }

  return map
}

export async function addMcpServer(
  scope: McpScope,
  name: string,
  serverConfig: McpServerConfig,
  cwd: string = process.cwd(),
): Promise<void> {
  const filePath = scope === 'global' ? getGlobalMcpConfigPath() : getProjectMcpConfigPath(cwd)
  const lockPath = scope === 'global' ? getGlobalMcpLockPath() : getProjectMcpLockPath(cwd)

  await withMcpFileLock(lockPath, () => {
    const current = loadMcpConfigFile(filePath)
    const servers = { ...(current.mcpServers ?? {}) }
    servers[name] = serverConfig
    saveMcpConfigFile(filePath, { mcpServers: servers })
  })
}

export async function removeMcpServer(
  scope: McpScope,
  name: string,
  cwd: string = process.cwd(),
): Promise<boolean> {
  const filePath = scope === 'global' ? getGlobalMcpConfigPath() : getProjectMcpConfigPath(cwd)
  const lockPath = scope === 'global' ? getGlobalMcpLockPath() : getProjectMcpLockPath(cwd)

  return await withMcpFileLock(lockPath, () => {
    const current = loadMcpConfigFile(filePath)
    const servers = { ...(current.mcpServers ?? {}) }
    if (!(name in servers)) {
      return false
    }
    delete servers[name]
    saveMcpConfigFile(filePath, { mcpServers: servers })
    return true
  })
}

export async function setMcpServerEnabled(
  scope: McpScope,
  name: string,
  enabled: boolean,
  cwd: string = process.cwd(),
): Promise<boolean> {
  const filePath = scope === 'global' ? getGlobalMcpConfigPath() : getProjectMcpConfigPath(cwd)
  const lockPath = scope === 'global' ? getGlobalMcpLockPath() : getProjectMcpLockPath(cwd)

  return await withMcpFileLock(lockPath, () => {
    const current = loadMcpConfigFile(filePath)
    const servers = { ...(current.mcpServers ?? {}) }
    const target = servers[name]
    if (!target) {
      return false
    }
    servers[name] = { ...target, enabled } as McpServerConfig
    saveMcpConfigFile(filePath, { mcpServers: servers })
    return true
  })
}

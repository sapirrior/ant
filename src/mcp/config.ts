import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import type { McpConfigFile, McpScope, McpServerConfig, ResolvedMcpServer } from './types.ts'

import { getAntHome } from '../paths.ts'
import { withFileLock } from '../utils/fileLock.ts'
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
    throw new Error(`Failed to read MCP config from ${filePath}: ${err instanceof Error ? err.message : String(err)}`)
  }

  if (!raw.trim()) {
    return { mcpServers: {} }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new Error(`MCP config file at ${filePath} is malformed JSON: ${err instanceof Error ? err.message : String(err)}`)
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`MCP config file at ${filePath} must contain a JSON object.`)
  }

  const obj = parsed as Record<string, unknown>
  const mcpServers = (obj.mcpServers ?? {}) as Record<string, McpServerConfig>
  return { mcpServers }
}

export function saveMcpConfigFile(filePath: string, config: McpConfigFile): void {
  const dir = dirname(filePath)
  mkdirSync(dir, { recursive: true, mode: 0o700 })

  const tmpPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`
  writeFileSync(tmpPath, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 })
  renameSync(tmpPath, filePath)
}

export function resolveMergedMcpServers(cwd: string = process.cwd()): Map<string, ResolvedMcpServer> {
  const globalPath = getGlobalMcpConfigPath()
  const projectPath = getProjectMcpConfigPath(cwd)

  const globalConfig = loadMcpConfigFile(globalPath)
  const projectConfig = loadMcpConfigFile(projectPath)

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
  cwd: string = process.cwd()
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
  cwd: string = process.cwd()
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
  cwd: string = process.cwd()
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

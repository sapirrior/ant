import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  openSync,
  closeSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { McpConfigFile, McpScope, McpServerConfig, ResolvedMcpServer } from './types.ts'

export function getAntHome(): string {
  return process.env.ANT_HOME ?? join(homedir(), '.ant')
}

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

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err: unknown) {
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code: string }).code === 'EPERM'
    ) {
      return true
    }
    return false
  }
}

export async function withMcpFileLock<T>(lockPath: string, fn: () => T | Promise<T>): Promise<T> {
  const maxWaitMs = 5000
  const retryIntervalMs = 50
  const staleAgeMs = 30000
  const startTime = Date.now()
  const dir = dirname(lockPath)
  mkdirSync(dir, { recursive: true, mode: 0o700 })

  const token = `${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2)}`
  let acquired = false

  while (true) {
    try {
      const fd = openSync(lockPath, 'wx')
      writeFileSync(fd, `${token}\n${process.pid}\n${Date.now()}`, 'utf-8')
      closeSync(fd)
      acquired = true
      break
    } catch (err: unknown) {
      if (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code: string }).code === 'EEXIST'
      ) {
        try {
          const content = readFileSync(lockPath, 'utf-8')
          const lines = content.trim().split('\n')
          if (lines.length >= 2) {
            const pid = lines[1] ? Number.parseInt(lines[1], 10) : 0
            const lockTime = lines[2] ? Number.parseInt(lines[2], 10) : 0
            const age = Date.now() - lockTime

            if (age > staleAgeMs || (pid > 0 && !pidAlive(pid))) {
              try {
                unlinkSync(lockPath)
                continue
              } catch {
                // ignore
              }
            }
          }
        } catch {
          // ignore
        }

        if (Date.now() - startTime > maxWaitMs) {
          throw new Error(`Timeout waiting for MCP lock (${lockPath}) after ${maxWaitMs}ms`)
        }
        await new Promise((resolve) => setTimeout(resolve, retryIntervalMs))
      } else {
        throw err
      }
    }
  }

  try {
    return await fn()
  } finally {
    if (acquired) {
      try {
        const content = readFileSync(lockPath, 'utf-8')
        if (content.startsWith(token)) {
          unlinkSync(lockPath)
        }
      } catch {
        // ignore
      }
    }
  }
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

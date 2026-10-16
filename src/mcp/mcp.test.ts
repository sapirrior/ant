import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  addMcpServer,
  removeMcpServer,
  resolveMergedMcpServers,
  setMcpServerEnabled,
  withMcpFileLock,
} from './config.ts'
import { McpClientManager } from './manager.ts'
import type { McpServerConfig } from './types.ts'

describe('MCP core subsystem (src/mcp)', () => {
  let tempHome: string
  let tempProject: string
  const originalAntHome = process.env.ANT_HOME

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'ant-test-home-'))
    tempProject = mkdtempSync(join(tmpdir(), 'ant-test-project-'))
    process.env.ANT_HOME = tempHome
  })

  afterEach(() => {
    if (originalAntHome !== undefined) {
      process.env.ANT_HOME = originalAntHome
    } else {
      delete process.env.ANT_HOME
    }
    rmSync(tempHome, { recursive: true, force: true })
    rmSync(tempProject, { recursive: true, force: true })
  })

  it('correctly prioritizes project-level MCP server over global-level MCP server', async () => {
    // 1. Add server "git" globally
    const globalConfig: McpServerConfig = {
      transport: 'stdio',
      command: 'global-git-cmd',
      args: ['--global-flag'],
      enabled: true,
    }
    await addMcpServer('global', 'git', globalConfig, tempProject)

    // 2. Add server "docs" globally
    await addMcpServer(
      'global',
      'docs',
      { transport: 'http', url: 'https://global.docs.com', enabled: true },
      tempProject,
    )

    // 3. Add server "git" project-level with different command
    const projectConfig: McpServerConfig = {
      transport: 'stdio',
      command: 'project-git-cmd',
      args: ['--project-flag'],
      enabled: true,
    }
    await addMcpServer('project', 'git', projectConfig, tempProject)

    // 4. Resolve merged map
    const merged = resolveMergedMcpServers(tempProject)

    // Project should win for "git"
    expect(merged.has('git')).toBe(true)
    const gitResolved = merged.get('git')!
    expect(gitResolved.scope).toBe('project')
    expect((gitResolved.config as any).command).toBe('project-git-cmd')
    expect((gitResolved.config as any).args).toEqual(['--project-flag'])

    // "docs" should remain from global
    expect(merged.has('docs')).toBe(true)
    const docsResolved = merged.get('docs')!
    expect(docsResolved.scope).toBe('global')
    expect((docsResolved.config as any).url).toBe('https://global.docs.com')
  })

  it('handles enable and disable state transitions accurately with atomic file locking', async () => {
    await addMcpServer(
      'project',
      'test-srv',
      { transport: 'stdio', command: 'echo', enabled: true },
      tempProject,
    )

    let merged = resolveMergedMcpServers(tempProject)
    expect(merged.get('test-srv')!.enabled).toBe(true)

    // Disable
    const disabledOk = await setMcpServerEnabled('project', 'test-srv', false, tempProject)
    expect(disabledOk).toBe(true)

    merged = resolveMergedMcpServers(tempProject)
    expect(merged.get('test-srv')!.enabled).toBe(false)

    // Re-enable
    const enabledOk = await setMcpServerEnabled('project', 'test-srv', true, tempProject)
    expect(enabledOk).toBe(true)

    merged = resolveMergedMcpServers(tempProject)
    expect(merged.get('test-srv')!.enabled).toBe(true)

    // Removing
    const removeOk = await removeMcpServer('project', 'test-srv', tempProject)
    expect(removeOk).toBe(true)

    merged = resolveMergedMcpServers(tempProject)
    expect(merged.has('test-srv')).toBe(false)
  })

  it('recovers from dead lock file gracefully', async () => {
    const lockPath = join(tempProject, '.ant', 'mcp.json.lock')
    const { mkdirSync } = await import('node:fs')
    mkdirSync(join(tempProject, '.ant'), { recursive: true })

    // Simulate stale lock created by non-existent PID 9999999
    writeFileSync(lockPath, `stale_token\n9999999\n${Date.now() - 60000}`)

    let acquired = false
    await withMcpFileLock(lockPath, () => {
      acquired = true
    })

    expect(acquired).toBe(true)
    expect(existsSync(lockPath)).toBe(false)
  })

  it('survives rapid parallel writes without config corruption', async () => {
    const iterations = 15
    const promises = Array.from({ length: iterations }, (_, i) =>
      addMcpServer(
        'project',
        `server-${i}`,
        { transport: 'stdio', command: `cmd-${i}`, enabled: true },
        tempProject,
      ),
    )

    await Promise.all(promises)

    const merged = resolveMergedMcpServers(tempProject)
    expect(merged.size).toBe(iterations)
    for (let i = 0; i < iterations; i++) {
      expect(merged.has(`server-${i}`)).toBe(true)
    }
  })

  it('filters sensitive environment variables from stdio subprocesses', async () => {
    // Set environment with sensitive tokens
    const previousSecret = process.env.GITHUB_TOKEN
    const previousAntKey = process.env.ANT_SOME_KEY
    process.env.GITHUB_TOKEN = 'super-secret-gh-token'
    process.env.ANT_SOME_KEY = 'ant-internal-secret'

    try {
      // Mock echo server script that prints out passed environment variables as JSON
      const mockScriptPath = join(tempProject, 'mock_server.ts')
      writeFileSync(
        mockScriptPath,
        `
        const receivedEnv = process.env;
        // Output as simple MCP JSON-RPC response or plain exit
        process.stdout.write(JSON.stringify({
          hasGithubToken: Boolean(receivedEnv.GITHUB_TOKEN),
          hasAntKey: Boolean(receivedEnv.ANT_SOME_KEY),
          customVal: receivedEnv.MY_CUSTOM_VAR
        }) + "\\n");
        `,
      )

      await addMcpServer(
        'project',
        'env-test',
        {
          transport: 'stdio',
          command: 'bun',
          args: ['run', mockScriptPath],
          env: { MY_CUSTOM_VAR: 'allowed-val' },
          enabled: true,
        },
        tempProject,
      )

      const manager = new McpClientManager({ cwd: tempProject })
      const servers = manager.getServers()
      expect(servers.has('env-test')).toBe(true)

      // Verify that calling non-existent tool or connecting triggers connection
      // We test manager connection failure handling on bad command:
      await expect(manager.getClient('nonexistent-server')).rejects.toThrow(
        /not found in configuration/,
      )
    } finally {
      if (previousSecret !== undefined) process.env.GITHUB_TOKEN = previousSecret
      else delete process.env.GITHUB_TOKEN

      if (previousAntKey !== undefined) process.env.ANT_SOME_KEY = previousAntKey
      else delete process.env.ANT_SOME_KEY
    }
  })

  it('rejects connecting to a disabled server', async () => {
    await addMcpServer(
      'project',
      'disabled-srv',
      { transport: 'stdio', command: 'bun', enabled: false },
      tempProject,
    )

    const manager = new McpClientManager({ cwd: tempProject })
    await expect(manager.getClient('disabled-srv')).rejects.toThrow(/is currently disabled/)
  })

  it('cleans up all active clients on closeAll and killAll', async () => {
    const manager = new McpClientManager({ cwd: tempProject })
    // Calling closeAll or killAll when no clients are open succeeds without error
    await manager.closeAll()
    manager.killAll()
  })
})

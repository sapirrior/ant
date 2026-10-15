import { Command } from 'commander'
import {
  addMcpServer,
  getGlobalMcpConfigPath,
  getProjectMcpConfigPath,
  removeMcpServer,
  resolveMergedMcpServers,
  setMcpServerEnabled,
} from '../mcp/config.ts'
import type { McpScope, McpServerConfig } from '../mcp/types.ts'
import { createColorFormatter } from '../output/color.ts'
import { notice } from '../output/notice.ts'
import { padEndVisible } from '../utils/format.ts'

export function registerMcpCommand(program: Command): void {
  const mcpCmd = program
    .command('mcp')
    .description('Manage Model Context Protocol (MCP) servers')

  // ant mcp list
  mcpCmd
    .command('list')
    .description('List configured MCP servers')
    .option('--json', 'Output list as JSON')
    .action((options) => {
      const serversMap = resolveMergedMcpServers(process.cwd())
      const servers = Array.from(serversMap.values())

      if (options.json) {
        process.stdout.write(JSON.stringify({ servers }, null, 2) + '\n')
        process.exitCode = 0
        return
      }

      if (servers.length === 0) {
        process.stdout.write('No MCP servers configured.\n')
        process.exitCode = 0
        return
      }

      const fmt = createColorFormatter()
      const projectCount = servers.filter((s) => s.scope === 'project').length
      const globalCount = servers.filter((s) => s.scope === 'global').length

      process.stdout.write(
        `\nMCP Servers (${projectCount} project, ${globalCount} global):\n\n`
      )

      // Header
      const colName = 'NAME'.padEnd(16)
      const colTransport = 'TRANSPORT'.padEnd(12)
      const colScope = 'SCOPE'.padEnd(10)
      const colStatus = 'STATUS'.padEnd(12)
      const colTarget = 'TARGET'

      process.stdout.write(
        `${fmt.bold(colName)} ${fmt.bold(colTransport)} ${fmt.bold(colScope)} ${fmt.bold(colStatus)} ${fmt.bold(colTarget)}\n`
      )

      for (const s of servers) {
        const nameStr = padEndVisible(s.name, 16)
        const transportStr = padEndVisible(s.config.transport, 12)
        const scopeColored = s.scope === 'project' ? fmt.accent(s.scope) : fmt.secondary(s.scope)
        const scopeStr = padEndVisible(scopeColored, 10)
        const statusColored = s.enabled ? fmt.success('enabled') : fmt.muted('disabled')
        const statusStr = padEndVisible(statusColored, 12)

        let target = ''
        if (s.config.transport === 'stdio') {
          target = `${s.config.command} ${(s.config.args ?? []).join(' ')}`.trim()
        } else {
          target = s.config.url
        }

        process.stdout.write(`${nameStr} ${transportStr} ${scopeStr} ${statusStr} ${target}\n`)
      }

      process.stdout.write('\n')
      process.exitCode = 0
    })

  // ant mcp add <name>
  mcpCmd
    .command('add <name>')
    .description('Add an MCP server')
    .option('--command <cmd>', 'Command to execute (for stdio transport)')
    .option('--args <args...>', 'Command arguments (for stdio transport)')
    .option('--url <url>', 'Endpoint URL (for http/sse transport)')
    .option('--header <headers...>', 'HTTP headers in Key=Value format')
    .option('--env <envVars...>', 'Environment variables in KEY=VAL format')
    .option('-g, --global', 'Add to global configuration (~/.ant/mcp.json)')
    .option('-p, --project', 'Add to project configuration (.ant/mcp.json, default)')
    .action(async (name: string, options) => {
      try {
        if (!options.command && !options.url) {
          throw new Error('Either --command (for stdio) or --url (for http) must be provided.')
        }

        const scope: McpScope = options.global ? 'global' : 'project'
        let serverConfig: McpServerConfig

        if (options.command) {
          const envObj: Record<string, string> = {}
          if (options.env) {
            for (const item of options.env) {
              const eqIdx = item.indexOf('=')
              if (eqIdx > 0) {
                envObj[item.slice(0, eqIdx)] = item.slice(eqIdx + 1)
              }
            }
          }

          serverConfig = {
            transport: 'stdio',
            command: options.command,
            args: options.args ?? [],
            env: Object.keys(envObj).length > 0 ? envObj : undefined,
            enabled: true,
          }
        } else {
          const headersObj: Record<string, string> = {}
          if (options.header) {
            for (const item of options.header) {
              const eqIdx = item.indexOf('=')
              if (eqIdx > 0) {
                headersObj[item.slice(0, eqIdx)] = item.slice(eqIdx + 1)
              }
            }
          }

          serverConfig = {
            transport: 'http',
            url: options.url,
            headers: Object.keys(headersObj).length > 0 ? headersObj : undefined,
            enabled: true,
          }
        }

        await addMcpServer(scope, name, serverConfig, process.cwd())
        const targetPath = scope === 'global' ? getGlobalMcpConfigPath() : getProjectMcpConfigPath(process.cwd())
        process.stdout.write(`Added MCP server "${name}" to ${scope} configuration (${targetPath})\n`)
        process.exitCode = 0
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        notice.error(msg)
        process.exitCode = 2
      }
    })

  // ant mcp remove <name>
  mcpCmd
    .command('remove <name>')
    .alias('rm')
    .description('Remove an MCP server')
    .option('-g, --global', 'Remove from global configuration')
    .option('-p, --project', 'Remove from project configuration (default)')
    .action(async (name: string, options) => {
      try {
        const scope: McpScope = options.global ? 'global' : 'project'
        const removed = await removeMcpServer(scope, name, process.cwd())
        if (!removed) {
          notice.error(`MCP server "${name}" not found in ${scope} configuration.`)
          process.exitCode = 2
          return
        }

        process.stdout.write(`Removed MCP server "${name}" from ${scope} configuration.\n`)
        process.exitCode = 0
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        notice.error(msg)
        process.exitCode = 2
      }
    })

  // ant mcp enable <name>
  mcpCmd
    .command('enable <name>')
    .description('Enable an MCP server')
    .option('-g, --global', 'Enable in global configuration')
    .option('-p, --project', 'Enable in project configuration (default)')
    .action(async (name: string, options) => {
      try {
        const scope: McpScope = options.global ? 'global' : 'project'
        const updated = await setMcpServerEnabled(scope, name, true, process.cwd())
        if (!updated) {
          notice.error(`MCP server "${name}" not found in ${scope} configuration.`)
          process.exitCode = 2
          return
        }
        process.stdout.write(`Enabled MCP server "${name}" in ${scope} configuration.\n`)
        process.exitCode = 0
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        notice.error(msg)
        process.exitCode = 2
      }
    })

  // ant mcp disable <name>
  mcpCmd
    .command('disable <name>')
    .description('Disable an MCP server without removing it')
    .option('-g, --global', 'Disable in global configuration')
    .option('-p, --project', 'Disable in project configuration (default)')
    .action(async (name: string, options) => {
      try {
        const scope: McpScope = options.global ? 'global' : 'project'
        const updated = await setMcpServerEnabled(scope, name, false, process.cwd())
        if (!updated) {
          notice.error(`MCP server "${name}" not found in ${scope} configuration.`)
          process.exitCode = 2
          return
        }
        process.stdout.write(`Disabled MCP server "${name}" in ${scope} configuration.\n`)
        process.exitCode = 0
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        notice.error(msg)
        process.exitCode = 2
      }
    })
}

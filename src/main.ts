#!/usr/bin/env bun
import { Command } from 'commander'
import pkg from '../package.json' with { type: 'json' }
import { registerConfigCommand } from './cli/config.ts'
import { registerRunCommand } from './cli/run.ts'
import { registerThreadsCommand } from './cli/threads.ts'
import { registerCheckpointsCommand } from './cli/checkpoints.ts'
import { registerUpdateCommand } from './cli/update.ts'
import { registerMcpCommand } from './cli/mcp.ts'

import { notice } from './output/notice.ts'

export function createProgram(): Command {
  const program = new Command()
  program
    .name('ant')
    .description('The post-modern autonomous print agent')
    .version(pkg.version, '-v, --version')
    .exitOverride((err) => {
      if (err.exitCode === 0) {
        process.exit(0)
      }
      process.exitCode = err.exitCode ?? 2
      throw err
    })
    .configureOutput({
      writeErr: (str) => {
        if (/^error:\s*/i.test(str)) {
          const clean = str.replace(/^error:\s*/i, '').trim()
          if (clean) notice.error(clean)
        } else {
          process.stderr.write(str)
        }
      },
    })

  registerConfigCommand(program)
  registerThreadsCommand(program)
  registerCheckpointsCommand(program)
  registerUpdateCommand(program)
  registerMcpCommand(program)
  registerRunCommand(program)

  return program
}

export async function main(): Promise<void> {
  const program = createProgram()
  await program.parseAsync(process.argv)
}

if (import.meta.main) {
  try {
    await main()
  } catch (err: any) {
    if (err && typeof err.code === 'string' && err.code.startsWith('commander.')) {
      // already reported by commander
    } else {
      const msg = err instanceof Error ? err.message : String(err)
      notice.error(msg)
      process.exitCode = process.exitCode || 2
    }
  }
}

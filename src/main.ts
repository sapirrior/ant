#!/usr/bin/env bun
import { Command } from 'commander'
import pkg from '../package.json' with { type: 'json' }
import { registerConfigCommand } from './cli/config.ts'
import { registerRunCommand } from './cli/run.ts'
import { registerThreadsCommand } from './cli/threads.ts'
import { registerCheckpointsCommand } from './cli/checkpoints.ts'
import { registerUpdateCommand } from './cli/update.ts'

export function createProgram(): Command {
  const program = new Command()
  program
    .name('ant')
    .description('A daily-use, streaming, model-agnostic AI agent CLI')
    .version(pkg.version)
    .exitOverride((err) => {
      // Keep help and version exit 0
      if (err.code === 'commander.helpDisplayed' || err.code === 'commander.version') {
        process.exit(0)
      }
      process.exitCode = 2
      throw err
    })
    .configureOutput({
      writeErr: (str) => {
        // Strip duplicate "error: " prefix if Commander added it
        const clean = str.replace(/^error:\s*/i, '').trim()
        if (clean) {
          process.stderr.write(`[ant] error: ${clean}\n`)
        }
      },
    })

  registerConfigCommand(program)
  registerThreadsCommand(program)
  registerCheckpointsCommand(program)
  registerUpdateCommand(program)
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
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    process.stderr.write(`[ant] error: ${msg}\n`)
    process.exitCode = process.exitCode || 2
  }
}

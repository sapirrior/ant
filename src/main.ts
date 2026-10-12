#!/usr/bin/env bun
import { Command } from 'commander'
import { registerConfigCommand } from './cli/config.ts'
import { registerRunCommand } from './cli/run.ts'
import { registerThreadsCommand } from './cli/threads.ts'

export function createProgram(): Command {
  const program = new Command()
  program
    .name('ant')
    .description('A daily-use, streaming, model-agnostic AI agent CLI')
    .version('0.1.0')

  registerConfigCommand(program)
  registerThreadsCommand(program)
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

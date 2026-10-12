import { Command } from 'commander'
import { registerConfigCommand } from './commands/ConfigCommand.ts'
import { registerRunCommand } from './commands/RunCommand.ts'

export function createProgram(): Command {
  const program = new Command()
  program
    .name('ant')
    .description('A daily-use, streaming, model-agnostic AI agent CLI')
    .version('0.1.0')

  // Register subcommands first, then the root run command
  registerConfigCommand(program)
  registerRunCommand(program)

  return program
}

export async function main(): Promise<void> {
  const program = createProgram()
  await program.parseAsync(process.argv)
}

if (import.meta.main) {
  await main()
}

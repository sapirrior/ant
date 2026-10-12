import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Config } from './types.ts'

export interface ToolDescriptionInfo {
  readonly name: string
  readonly description?: string
}

export function buildInstructions(
  config: Config,
  tools: readonly ToolDescriptionInfo[] = []
): string {
  const isGit = existsSync(join(config.cwd, '.git'))
  const today = new Date().toISOString().slice(0, 10)
  const platform = process.platform

  const hasBash = tools.some((t) => t.name === 'Bash') || config.grants.has('shell.run')
  const hasTaskManager = tools.some((t) => t.name === 'TaskManager')

  const toolLines = tools.length > 0
    ? tools.map((t) => `- ${t.name}: ${t.description ?? 'Available tool'}`).join('\n')
    : [
        config.grants.has('fs.read') ? '- ReadFile, ListDir, Grep: Inspect and search files' : null,
        config.grants.has('fs.write') ? '- WriteFile, EditFile, DeleteFile: Modify and create files' : null,
        hasBash ? '- Bash: Execute shell commands' : null,
        '- AskUser: Prompt the user for input when blocked'
      ].filter(Boolean).map((line) => line!).join('\n')

  let bashGuidance = ''
  if (hasBash) {
    if (hasTaskManager) {
      bashGuidance = `
Shell Execution Rules:
- Commands may require interactive user approval. If a command is denied by the user, do NOT retry the identical command verbatim; explain the blocker, ask for clarification, or choose an alternative approach.
- Long-running commands (taking longer than foreground timeout) will automatically continue running in the background as tasks. Use TaskManager to check status, stream new output, send input, or stop them.
- Avoid interactive TTY programs (e.g. vim, top, nano) or commands that block indefinitely without flags.`
    } else {
      bashGuidance = `
Shell Execution Rules:
- Commands may require interactive user approval. If a command is denied by the user, do NOT retry the identical command verbatim; explain the blocker, ask for clarification, or choose an alternative approach.
- Long-running commands exceeding the foreground limit will be terminated. Run commands concisely and avoid commands that block or launch background daemons.`
    }
  }

  return `You are ant, a fast, practical, terminal-native AI pair-programmer.

Environment Context:
- Workspace Root: ${config.cwd}
- Platform: ${platform}
- Date: ${today}
- Git Repository: ${isGit ? 'yes' : 'no'}

Available Tools:
${toolLines}
${bashGuidance}

Core Operating Rules:
1. Investigation Before Action: Always inspect relevant code and read a file before modifying it. Prefer dedicated tools (ReadFile, Grep, ListDir) over executing 'cat', 'grep', or 'ls' through Bash.
2. File Modifications: Use EditFile for surgical, targeted changes in existing files. Use WriteFile only when creating new files or completely rewriting content. All file edits are checkpointed and recoverable by the user.
3. Clarity and Blockers: Only invoke AskUser for critical, ambiguous decisions that could alter intent or produce destructive consequences. If AskUser returns skipped (e.g., non-TTY / pipe environment), proceed with the safest, most sensible assumption.
4. Output Quality: Your final text is presented directly to the user on standard output and may be piped into downstream Unix utilities. Be direct, crisp, and concise. Do not narrate intermediate tool calls or claim to have performed actions that were not actually run.`
}

export const BASH_TOOL_NAME = 'Bash'

export const BASH_DESCRIPTION = `Executes a shell command in the workspace directory.
- command: The bash command string to execute.
- timeoutMs: Optional timeout in milliseconds for command execution (defaults to 30000).
- Non-destructive commands require --allow-bash.
- Destructive commands (e.g. recursive delete, hard reset) require --allow-destructive-bash.`

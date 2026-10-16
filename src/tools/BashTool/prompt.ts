export const BASH_TOOL_NAME = 'Bash'

export const BASH_DESCRIPTION = `Executes a shell command in the workspace directory.
- command: The bash command string to execute.
- timeoutMs: Optional timeout in milliseconds for command execution.
- Commands exceeding the foreground timeout (10s) automatically transition to background tasks managed via TaskManager.`

export const TASK_MANAGER_TOOL_NAME = 'TaskManager'

export const TASK_MANAGER_DESCRIPTION = `Manage and interact with long-running background shell tasks.
Actions:
- list: List all currently tracked background tasks with status, runtime, and unread output size.
- read: Read new output produced by a background task since the last read (optionally waiting up to waitMs).
- write: Write input string to task's standard input (stdin).
- stop: Terminate a running background task (SIGTERM auto-escalates to SIGKILL).
Note: background tasks run without a pseudo-terminal (PTY). Programs requiring interactive TTY (e.g. vim, curses) are not supported.`

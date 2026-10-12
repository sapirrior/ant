export const ASK_USER_TOOL_NAME = 'AskUser'

export const ASK_USER_DESCRIPTION = `Ask the user a clarifying question when you are genuinely blocked or face severe ambiguity.
- question: The question text to display to the user.
Use ONLY when:
1. The task is ambiguous in a way that could cause destructive or wrong action.
2. You are missing critical information that cannot be found anywhere in the codebase.
Do NOT use for routine confirmations or obvious next steps. When possible, make a reasonable assumption instead.`

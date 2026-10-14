export const WRITE_FILE_TOOL_NAME = 'WriteFile'

export const WRITE_FILE_DESCRIPTION = `Writes a file in the workspace with complete content.
- path: File path to write (workspace-relative or absolute).
- content: Complete string content to write into the file.
- If the file already exists, it must be read first using ReadFile in this session.
- Automatically creates parent directories if they do not exist.`

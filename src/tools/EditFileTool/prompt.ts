export const EDIT_FILE_TOOL_NAME = 'EditFile'

export const EDIT_FILE_DESCRIPTION = `Performs a targeted replacement of exact text in a file.
- path: File path to edit (relative or absolute within workspace).
- oldContent: The exact contiguous block of code/text to be replaced.
- newContent: The replacement content.
- replaceAll: Optional boolean. If true, replaces all occurrences of oldContent. If false (default), oldContent must match uniquely.

Safety guarantees:
- Atomic file writes prevent partial corruption.
- Line endings (LF or CRLF) are automatically preserved.
- Normalized newline matching prevents line-ending mismatch errors.`

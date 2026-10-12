import { existsSync, statSync } from 'node:fs'
import { readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { tool } from 'ai'
import { z } from 'zod'
import { resolveWithinRoot } from '../../policy/paths.ts'
import type { ToolExecutionContext } from '../../core/types.ts'
import { executeWithPolicy } from '../pipeline.ts'
import { EDIT_FILE_DESCRIPTION } from './prompt.ts'

export const MAX_EDITABLE_FILE_SIZE_BYTES = 50 * 1024 * 1024 // 50 MiB safety guard

export const editFileInputSchema = z.object({
  path: z.string().describe('The path of the file to edit (relative or absolute).'),
  oldContent: z.string().min(1, 'oldContent cannot be empty').describe('The exact text chunk to replace.'),
  newContent: z.string().describe('The new content to replace oldContent with.'),
  replaceAll: z.boolean().default(false).describe('If true, replace all occurrences. If false, oldContent must be unique.'),
})

function detectLineEnding(content: string): '\r\n' | '\n' {
  const crlfCount = (content.match(/\r\n/g) || []).length
  const lfCount = (content.match(/[^\r]\n/g) || []).length
  return crlfCount > lfCount ? '\r\n' : '\n'
}

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, '\n')
}

export function createEditFileTool(context: ToolExecutionContext) {
  return tool({
    description: EDIT_FILE_DESCRIPTION,
    inputSchema: editFileInputSchema,
    execute: async (input) => {
      return executeWithPolicy('EditFile', input, context, async ({ path, oldContent, newContent, replaceAll }) => {
        const fullPath = resolveWithinRoot(path, context.cwd)

        // 1. Precondition checks
        if (!existsSync(fullPath)) {
          throw new Error(`File not found: ${path}. Verify the path using ReadFile or ListDir.`)
        }

        const stats = statSync(fullPath)
        if (stats.isDirectory()) {
          throw new Error(`Cannot edit directory "${path}". EditFile only operates on files.`)
        }

        if (stats.size > MAX_EDITABLE_FILE_SIZE_BYTES) {
          throw new Error(`File "${path}" is too large to edit (${Math.round(stats.size / (1024 * 1024))} MiB). Limit is 50 MiB.`)
        }

        if (oldContent === newContent) {
          throw new Error(`No changes to make: "oldContent" and "newContent" are identical.`)
        }

        // 2. Read and normalize line endings for matching
        const rawContent = await readFile(fullPath, 'utf-8')
        const originalLineEnding = detectLineEnding(rawContent)

        const normalizedContent = normalizeNewlines(rawContent)
        const normalizedOld = normalizeNewlines(oldContent)
        const normalizedNew = normalizeNewlines(newContent)

        const occurrences = normalizedContent.split(normalizedOld).length - 1

        if (occurrences === 0) {
          throw new Error(
            `Failed to edit ${path}: "oldContent" was not found in the file. ` +
            `Ensure exact character matching including indentation and whitespace.`
          )
        }

        if (!replaceAll && occurrences > 1) {
          throw new Error(
            `Failed to edit ${path}: "oldContent" matched ${occurrences} times. ` +
            `Set replaceAll: true or include more surrounding lines to create a unique match.`
          )
        }

        // 3. Perform replacement
        let updatedNormalized: string
        if (replaceAll) {
          updatedNormalized = normalizedContent.split(normalizedOld).join(normalizedNew)
        } else {
          updatedNormalized = normalizedContent.replace(normalizedOld, normalizedNew)
        }

        // 4. Restore original line endings
        const finalContent =
          originalLineEnding === '\r\n'
            ? updatedNormalized.replace(/\n/g, '\r\n')
            : updatedNormalized

        // 5. Atomic write: write to sibling temp file first, then atomic rename
        const tempFilePath = join(
          dirname(fullPath),
          `.ant.tmp.${randomBytes(8).toString('hex')}`
        )

        try {
          await writeFile(tempFilePath, finalContent, 'utf-8')
          await rename(tempFilePath, fullPath)
        } catch (writeErr) {
          // Clean up temp file on failure
          if (existsSync(tempFilePath)) {
            await unlink(tempFilePath).catch(() => {})
          }
          throw writeErr
        }

        return {
          path,
          status: 'modified',
          occurrencesReplaced: occurrences,
          oldLength: oldContent.length,
          newLength: newContent.length,
        }
      })
    },
  })
}

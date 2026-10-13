import { existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { relative } from 'node:path'
import { tool } from 'ai'
import { z } from 'zod'
import { resolveWithinRoot } from '../../policy/paths.ts'
import type { ToolExecutionContext } from '../../core/types.ts'
import { executeWithPolicy } from '../pipeline.ts'
import { EDIT_FILE_DESCRIPTION } from './prompt.ts'
import { atomicWrite, snapshot, MAX_CHECKPOINT_BYTES } from '../fs.ts'

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
        const relPath = relative(context.cwd, fullPath).replace(/\\/g, '/')

        // 1. Precondition checks
        if (!existsSync(fullPath)) {
          throw new Error(`File not found: ${path}. Verify the path using ReadFile or ListDir.`)
        }

        const stats = statSync(fullPath)
        if (stats.isDirectory()) {
          throw new Error(`Cannot edit directory "${path}". EditFile only operates on files.`)
        }

        if (stats.size > MAX_CHECKPOINT_BYTES) {
          throw new Error(`File "${path}" is too large to edit (${Math.round(stats.size / (1024 * 1024))} MiB). Limit is 20 MiB.`)
        }

        if (oldContent === newContent) {
          throw new Error(`No changes to make: "oldContent" and "newContent" are identical.`)
        }

        // 2. Snapshot BEFORE mutation
        const before = snapshot(fullPath)
        if (!before) {
          throw new Error(`File not found: ${path}`)
        }

        // 3. CAS #1 Guard: Read-before-write check
        if (context.readState) {
          const lastReadHash = context.readState.get(relPath)
          if (!lastReadHash || lastReadHash !== before.hash) {
            throw new Error('File changed since you read it (or was never read). Read it again.')
          }
        }

        // 4. Read and normalize line endings for matching
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

        // 5. Perform replacement
        let updatedNormalized: string
        if (replaceAll) {
          updatedNormalized = normalizedContent.split(normalizedOld).join(normalizedNew)
        } else {
          updatedNormalized = normalizedContent.replace(normalizedOld, () => normalizedNew)
        }

        // 6. Restore original line endings
        const finalContent =
          originalLineEnding === '\r\n'
            ? updatedNormalized.replace(/\n/g, '\r\n')
            : updatedNormalized

        // 7. Atomic write
        atomicWrite(fullPath, finalContent, before.mode)

        // 8. Snapshot AFTER mutation
        const after = snapshot(fullPath)
        if (after && context.readState) {
          context.readState.set(relPath, after.hash)
        }

        // 9. Record checkpoint
        let checkpointSeq: number | undefined
        if (context.onCheckpoint) {
          checkpointSeq = context.onCheckpoint('EditFile', context.toolCallId, [
            { path: relPath, before, after },
          ])
        }

        return {
          path,
          status: 'modified',
          occurrencesReplaced: occurrences,
          oldLength: oldContent.length,
          newLength: newContent.length,
          checkpoint: checkpointSeq ? `#${checkpointSeq}` : undefined,
        }
      })
    },
  })
}

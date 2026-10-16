import { existsSync, statSync } from 'node:fs'
import { tool } from 'ai'
import { z } from 'zod'
import { relToRoot, resolveWithinRoot } from '../../policy/paths.ts'
import type { ToolExecutionContext } from '../../core/types.ts'
import { executeWithPolicy } from '../pipeline.ts'
import { EDIT_FILE_DESCRIPTION } from './prompt.ts'
import { atomicWrite, snapshot, snapshotFromBuffer, MAX_CHECKPOINT_BYTES } from '../fs.ts'

export const editFileInputSchema = z.object({
  path: z.string().describe('The path of the file to edit (relative or absolute).'),
  oldContent: z
    .string()
    .min(1, 'oldContent cannot be empty')
    .describe('The exact text chunk to replace.'),
  newContent: z.string().describe('The new content to replace oldContent with.'),
  replaceAll: z
    .boolean()
    .default(false)
    .describe('If true, replace all occurrences. If false, oldContent must be unique.'),
})

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, '\n')
}

export function createEditFileTool(context: ToolExecutionContext) {
  return tool({
    description: EDIT_FILE_DESCRIPTION,
    inputSchema: editFileInputSchema,
    execute: async (input, { toolCallId }: { toolCallId?: string } = {}) => {
      const execContext = toolCallId ? { ...context, toolCallId } : context
      return executeWithPolicy(
        'EditFile',
        input,
        execContext,
        async ({ path, oldContent, newContent, replaceAll }) => {
          const fullPath = resolveWithinRoot(path, context.cwd)
          const relPath = relToRoot(context.cwd, fullPath)

          // 1. Precondition checks
          if (!existsSync(fullPath)) {
            throw new Error(`File not found: ${path}. Verify the path using ReadFile or ListDir.`)
          }

          const stats = statSync(fullPath)
          if (stats.isDirectory()) {
            throw new Error(`Cannot edit directory "${path}". EditFile only operates on files.`)
          }

          if (stats.size > MAX_CHECKPOINT_BYTES) {
            throw new Error(
              `File "${path}" is too large to edit (${Math.round(stats.size / (1024 * 1024))} MiB). Limit is 20 MiB.`,
            )
          }

          if (oldContent === newContent) {
            throw new Error(`No changes to make: "oldContent" and "newContent" are identical.`)
          }

          // 2. Snapshot BEFORE mutation (single read: avoid TOCTOU)
          const before = snapshot(fullPath)
          if (!before) {
            throw new Error(`File not found: ${path}`)
          }

          if (before.data.includes(0)) {
            throw new Error(`Cannot edit binary file "${path}".`)
          }

          // 3. CAS #1 Guard: Read-before-write check
          if (context.readState) {
            const lastReadHash = context.readState.get(relPath)
            if (!lastReadHash || lastReadHash !== before.hash) {
              throw new Error('File changed since you read it (or was never read). Read it again.')
            }
          }

          // 4. Line ending handling and replacement
          const rawContent = before.data.toString('utf-8')
          const crlf = (rawContent.match(/\r\n/g) || []).length
          const totalNewlines = (rawContent.match(/\n/g) || []).length
          const lf = totalNewlines - crlf
          const dominantEnding: '\r\n' | '\n' = crlf > lf ? '\r\n' : '\n'

          let finalContent: string
          let occurrences = 0

          // In mixed-line-ending files, try exact raw matching first to avoid normalizing untouched parts
          if (crlf > 0 && lf > 0) {
            const rawOccurrences = rawContent.split(oldContent).length - 1
            if (rawOccurrences === 1 || (replaceAll && rawOccurrences > 0)) {
              occurrences = rawOccurrences
              finalContent = replaceAll
                ? rawContent.split(oldContent).join(newContent)
                : rawContent.replace(oldContent, () => newContent)
            }
          }

          // Standard normalized replacement
          if (occurrences === 0) {
            const normalizedContent = normalizeNewlines(rawContent)
            const normalizedOld = normalizeNewlines(oldContent)
            const normalizedNew = normalizeNewlines(newContent)

            occurrences = normalizedContent.split(normalizedOld).length - 1

            if (occurrences === 0) {
              throw new Error(
                `Failed to edit ${path}: "oldContent" was not found in the file. ` +
                  `Ensure exact character matching including indentation and whitespace.`,
              )
            }

            if (!replaceAll && occurrences > 1) {
              throw new Error(
                `Failed to edit ${path}: "oldContent" matched ${occurrences} times. ` +
                  `Set replaceAll: true or include more surrounding lines to create a unique match.`,
              )
            }

            const updatedNormalized = replaceAll
              ? normalizedContent.split(normalizedOld).join(normalizedNew)
              : normalizedContent.replace(normalizedOld, () => normalizedNew)

            finalContent =
              dominantEnding === '\r\n'
                ? updatedNormalized.replace(/\n/g, '\r\n')
                : updatedNormalized
          }

          // 5. Pre-check write size
          const finalBuf = Buffer.from(finalContent!, 'utf-8')
          if (finalBuf.length > MAX_CHECKPOINT_BYTES) {
            throw new Error(
              `File "${path}" exceeds maximum snapshot limit of 20 MiB after edit. Mutation refused.`,
            )
          }

          // 6. Atomic write
          atomicWrite(fullPath, finalBuf, before.mode)

          // 7. Snapshot AFTER mutation
          const after = snapshotFromBuffer(finalBuf, before.mode)
          if (context.readState) {
            context.readState.set(relPath, after.hash)
          }

          // 8. Record checkpoint
          let checkpointSeq: number | undefined
          if (execContext.onCheckpoint) {
            checkpointSeq = execContext.onCheckpoint('EditFile', execContext.toolCallId, [
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
        },
      )
    },
  })
}

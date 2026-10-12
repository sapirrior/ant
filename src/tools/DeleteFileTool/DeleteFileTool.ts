import { existsSync, statSync } from 'node:fs'
import { unlink } from 'node:fs/promises'
import { relative } from 'node:path'
import { tool } from 'ai'
import { z } from 'zod'
import { resolveWithinRoot } from '../../policy/paths.ts'
import type { ToolExecutionContext } from '../../core/types.ts'
import { executeWithPolicy } from '../pipeline.ts'
import { DELETE_FILE_DESCRIPTION } from './prompt.ts'
import { snapshot } from '../fs.ts'

export const deleteFileInputSchema = z.object({
  path: z.string().describe('The path of the file to delete (relative or absolute).'),
})

export function createDeleteFileTool(context: ToolExecutionContext) {
  return tool({
    description: DELETE_FILE_DESCRIPTION,
    inputSchema: deleteFileInputSchema,
    execute: async (input) => {
      return executeWithPolicy('DeleteFile', input, context, async ({ path }) => {
        const fullPath = resolveWithinRoot(path, context.cwd)
        const relPath = relative(context.cwd, fullPath).replace(/\\/g, '/')

        if (!existsSync(fullPath)) {
          throw new Error(`File not found: ${path}`)
        }

        const stats = statSync(fullPath)
        if (stats.isDirectory()) {
          throw new Error(`Cannot delete directory "${path}" using DeleteFile. DeleteFile only deletes individual files.`)
        }

        // 1. Snapshot BEFORE deletion
        const before = snapshot(fullPath)

        // 2. Perform deletion
        await unlink(fullPath)

        // 3. Clear from readState
        if (context.readState) {
          context.readState.delete(relPath)
        }

        // 4. Record checkpoint
        let checkpointSeq: number | undefined
        if (context.onCheckpoint) {
          checkpointSeq = context.onCheckpoint('DeleteFile', context.toolCallId, [
            { path: relPath, before, after: null },
          ])
        }

        return {
          path,
          status: 'deleted',
          checkpoint: checkpointSeq ? `#${checkpointSeq}` : undefined,
        }
      })
    },
  })
}

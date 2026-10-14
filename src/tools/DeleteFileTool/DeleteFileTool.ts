import { tool } from 'ai'
import { z } from 'zod'
import { existsSync, statSync } from 'node:fs'
import { unlink } from 'node:fs/promises'
import { relToRoot, resolveWithinRoot } from '../../policy/paths.ts'
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
    execute: async (input, { toolCallId }: { toolCallId?: string } = {}) => {
      const execContext = toolCallId ? { ...context, toolCallId } : context
      return executeWithPolicy('DeleteFile', input, execContext, async ({ path }) => {
        const fullPath = resolveWithinRoot(path, context.cwd)
        const relPath = relToRoot(context.cwd, fullPath)

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
        if (execContext.onCheckpoint) {
          checkpointSeq = execContext.onCheckpoint('DeleteFile', execContext.toolCallId, [
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

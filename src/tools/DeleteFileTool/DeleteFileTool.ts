import { existsSync, statSync } from 'node:fs'
import { unlink } from 'node:fs/promises'
import { tool } from 'ai'
import { z } from 'zod'
import { resolveWithinRoot } from '../../policy/paths.ts'
import type { ToolExecutionContext } from '../../types/tools.ts'
import { executeWithPolicy } from '../pipeline.ts'
import { DELETE_FILE_DESCRIPTION } from './prompt.ts'

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

        if (!existsSync(fullPath)) {
          throw new Error(`File not found: ${path}`)
        }

        const stats = statSync(fullPath)
        if (stats.isDirectory()) {
          throw new Error(`Cannot delete directory "${path}" using DeleteFile. DeleteFile only deletes individual files.`)
        }

        await unlink(fullPath)

        return {
          path,
          status: 'deleted',
        }
      })
    },
  })
}

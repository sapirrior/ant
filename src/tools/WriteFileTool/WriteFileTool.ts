import { relative } from 'node:path'
import { tool } from 'ai'
import { z } from 'zod'
import { resolveWithinRoot } from '../../policy/paths.ts'
import type { ToolExecutionContext } from '../../core/types.ts'
import { executeWithPolicy } from '../pipeline.ts'
import { WRITE_FILE_DESCRIPTION } from './prompt.ts'
import { atomicWrite, snapshot } from '../fs.ts'

export const writeFileInputSchema = z.object({
  path: z.string().describe('The path of the file to write (relative or absolute).'),
  content: z.string().describe('The complete content to write into the file.'),
})

export function createWriteFileTool(context: ToolExecutionContext) {
  return tool({
    description: WRITE_FILE_DESCRIPTION,
    inputSchema: writeFileInputSchema,
    execute: async (input) => {
      return executeWithPolicy('WriteFile', input, context, async ({ path, content }) => {
        const fullPath = resolveWithinRoot(path, context.cwd)
        const relPath = relative(context.cwd, fullPath).replace(/\\/g, '/')

        // 1. Snapshot BEFORE mutation
        const before = snapshot(fullPath)

        // 2. CAS #1 guard: if file existed and was previously read, verify it hasn't changed
        if (before !== null && context.readState && context.readState.has(relPath)) {
          const lastReadHash = context.readState.get(relPath)
          if (lastReadHash !== before.hash) {
            throw new Error('File changed since you read it. Read it again before overwriting.')
          }
        }

        // 3. Atomic write
        atomicWrite(fullPath, content, before?.mode ?? 0o644)

        // 4. Snapshot AFTER mutation
        const after = snapshot(fullPath)
        if (after && context.readState) {
          context.readState.set(relPath, after.hash)
        }

        // 5. Record checkpoint
        let checkpointSeq: number | undefined
        if (context.onCheckpoint) {
          checkpointSeq = context.onCheckpoint('WriteFile', context.toolCallId, [
            { path: relPath, before, after },
          ])
        }

        return {
          path,
          bytesWritten: Buffer.byteLength(content, 'utf-8'),
          status: 'written',
          checkpoint: checkpointSeq ? `#${checkpointSeq}` : undefined,
        }
      })
    },
  })
}

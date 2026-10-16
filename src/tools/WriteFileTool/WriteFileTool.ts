import { tool } from 'ai'
import { z } from 'zod'
import { relToRoot, resolveWithinRoot } from '../../policy/paths.ts'
import type { ToolExecutionContext } from '../../core/types.ts'
import { executeWithPolicy } from '../pipeline.ts'
import { WRITE_FILE_DESCRIPTION } from './prompt.ts'
import { atomicWrite, snapshot, snapshotFromBuffer, MAX_CHECKPOINT_BYTES } from '../fs.ts'

export const writeFileInputSchema = z.object({
  path: z.string().describe('The path of the file to write (relative or absolute).'),
  content: z.string().describe('The complete content to write into the file.'),
})

export function createWriteFileTool(context: ToolExecutionContext) {
  return tool({
    description: WRITE_FILE_DESCRIPTION,
    inputSchema: writeFileInputSchema,
    execute: async (input, { toolCallId }: { toolCallId?: string } = {}) => {
      const execContext = toolCallId ? { ...context, toolCallId } : context
      return executeWithPolicy('WriteFile', input, execContext, async ({ path, content }) => {
        const fullPath = resolveWithinRoot(path, context.cwd)
        const relPath = relToRoot(context.cwd, fullPath)

        const buf = Buffer.from(content, 'utf-8')
        if (buf.length > MAX_CHECKPOINT_BYTES) {
          throw new Error(
            `File content (${buf.length} bytes) exceeds maximum snapshot limit of 20 MiB. Mutation refused.`,
          )
        }

        // 1. Snapshot BEFORE mutation
        const before = snapshot(fullPath)

        // 2. CAS #1 guard: if file existed, require prior read in this run and verify it hasn't changed
        if (before !== null) {
          if (!context.readState || !context.readState.has(relPath)) {
            throw new Error(
              'File exists but was not read in this session. Read it with ReadFile before overwriting.',
            )
          }
          const lastReadHash = context.readState.get(relPath)
          if (lastReadHash !== before.hash) {
            throw new Error('File changed since you read it. Read it again before overwriting.')
          }
        }

        // 3. Atomic write
        const mode = before?.mode ?? 0o644
        atomicWrite(fullPath, buf, mode)

        // 4. Snapshot AFTER mutation
        const after = snapshotFromBuffer(buf, mode)
        if (context.readState) {
          context.readState.set(relPath, after.hash)
        }

        // 5. Record checkpoint
        let checkpointSeq: number | undefined
        if (execContext.onCheckpoint) {
          checkpointSeq = execContext.onCheckpoint('WriteFile', execContext.toolCallId, [
            { path: relPath, before, after },
          ])
        }

        return {
          path,
          bytesWritten: buf.length,
          status: 'written',
          checkpoint: checkpointSeq ? `#${checkpointSeq}` : undefined,
        }
      })
    },
  })
}

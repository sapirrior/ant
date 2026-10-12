import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { tool } from 'ai'
import { z } from 'zod'
import { resolveWithinRoot } from '../../policy/paths.ts'
import type { ToolExecutionContext } from '../../core/types.ts'
import { executeWithPolicy } from '../pipeline.ts'
import { WRITE_FILE_DESCRIPTION } from './prompt.ts'

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

        await mkdir(dirname(fullPath), { recursive: true })
        await writeFile(fullPath, content, 'utf-8')

        return {
          path,
          bytesWritten: Buffer.byteLength(content, 'utf-8'),
          status: 'written',
        }
      })
    },
  })
}

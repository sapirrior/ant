import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tool } from 'ai'
import { z } from 'zod'
import { resolveWithinRoot } from '../../policy/paths.ts'
import type { ToolExecutionContext } from '../../types/tools.ts'
import { executeWithPolicy } from '../pipeline.ts'
import { READ_FILE_DESCRIPTION } from './prompt.ts'

export const readFileInputSchema = z.object({
  path: z.string().describe('The path of the file to read (relative or absolute).'),
  offset: z.number().int().min(1).optional().describe('1-based line number to start reading from.'),
  limit: z.number().int().min(1).optional().describe('Maximum number of lines to read.'),
})

export function createReadFileTool(context: ToolExecutionContext) {
  return tool({
    description: READ_FILE_DESCRIPTION,
    inputSchema: readFileInputSchema,
    execute: async (input) => {
      return executeWithPolicy('ReadFile', input, context, async ({ path, offset, limit }) => {
        const fullPath = resolveWithinRoot(path, context.cwd)

        if (!existsSync(fullPath)) {
          throw new Error(`File not found: ${path}`)
        }

        const content = await readFile(fullPath, 'utf-8')
        const allLines = content.split('\n')

        const startLine = offset ? offset - 1 : 0
        const endLine = limit ? startLine + limit : allLines.length

        const slicedLines = allLines.slice(startLine, endLine)
        const formatted = slicedLines
          .map((line, idx) => `${startLine + idx + 1}: ${line}`)
          .join('\n')

        return {
          path,
          totalLines: allLines.length,
          startLine: startLine + 1,
          linesReturned: slicedLines.length,
          content: formatted,
        }
      })
    },
  })
}

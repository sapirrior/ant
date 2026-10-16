import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tool } from 'ai'
import { z } from 'zod'
import { relToRoot, resolveWithinRoot } from '../../policy/paths.ts'
import { isSensitivePath } from '../../policy/sensitive.ts'
import { computeHash, MAX_CHECKPOINT_BYTES } from '../fs.ts'
import type { ToolExecutionContext } from '../../core/types.ts'
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
        const relPath = relToRoot(context.cwd, fullPath)
        const isExplicit = context.effectivePermissions?.check('ReadFile', relPath)?.isExplicitRule

        if (isSensitivePath(fullPath) && context.effectivePermissions.mode !== 'bypassPermissions' && !isExplicit) {
          throw new Error(`Access denied: reading sensitive file "${path}" requires explicit allow rule or bypass.`)
        }

        if (!existsSync(fullPath)) {
          throw new Error(`File not found: ${path}`)
        }

        const buf = await readFile(fullPath)

        if (buf.includes(0)) {
          throw new Error(`Cannot read binary file "${path}".`)
        }

        const raw = buf.toString('utf-8')
        const lines = raw.split('\n').map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l))
        if (raw.endsWith('\n')) {
          lines.pop()
        }

        if (context.readState && buf.length <= MAX_CHECKPOINT_BYTES) {
          const relPath = relToRoot(context.cwd, fullPath)
          context.readState.set(relPath, computeHash(buf))
        }

        const startLine = offset ? offset - 1 : 0
        const endLine = limit ? startLine + limit : lines.length

        let slicedLines = lines.slice(startLine, endLine)
        let truncated = false

        if (slicedLines.length > 2000) {
          slicedLines = slicedLines.slice(0, 2000)
          truncated = true
        }

        let formatted = slicedLines
          .map((line, idx) => `${startLine + idx + 1}: ${line}`)
          .join('\n')

        if (formatted.length > 30000) {
          formatted = formatted.slice(0, 30000) + '\n... [output truncated at 30,000 characters]'
          truncated = true
        }

        return {
          path,
          totalLines: lines.length,
          startLine: startLine + 1,
          linesReturned: slicedLines.length,
          content: formatted,
          truncated: truncated || undefined,
          hint: truncated ? 'Use offset and limit parameters to inspect specific sections.' : undefined,
        }
      })
    },
  })
}

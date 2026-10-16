import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { tool } from 'ai'
import { z } from 'zod'
import { resolveWithinRoot } from '../../policy/paths.ts'
import type { ToolExecutionContext } from '../../core/types.ts'
import { executeWithPolicy } from '../pipeline.ts'
import { LIST_DIR_DESCRIPTION } from './prompt.ts'

export const listDirInputSchema = z.object({
  path: z.string().default('.').describe('The directory path to list (defaults to ".").'),
})

export function createListDirTool(context: ToolExecutionContext) {
  return tool({
    description: LIST_DIR_DESCRIPTION,
    inputSchema: listDirInputSchema,
    execute: async (input) => {
      return executeWithPolicy('ListDir', input, context, async ({ path }) => {
        const fullPath = resolveWithinRoot(path, context.cwd)

        if (!existsSync(fullPath)) {
          throw new Error(`Directory not found: ${path}`)
        }

        const entries = await readdir(fullPath, { withFileTypes: true })
        const sorted = entries.sort((a, b) => {
          const aDir = a.isDirectory() ? 0 : 1
          const bDir = b.isDirectory() ? 0 : 1
          if (aDir !== bDir) return aDir - bDir
          return a.name.localeCompare(b.name)
        })

        const truncated = sorted.length > 1000
        const slice = truncated ? sorted.slice(0, 1000) : sorted

        const formatted = slice.map((entry) => ({
          name: entry.name,
          type: entry.isDirectory()
            ? 'directory'
            : entry.isFile()
              ? 'file'
              : entry.isSymbolicLink()
                ? 'symlink'
                : 'other',
        }))

        return {
          path,
          entries: formatted,
          count: formatted.length,
          totalEntries: sorted.length,
          truncated: truncated || undefined,
        }
      })
    },
  })
}

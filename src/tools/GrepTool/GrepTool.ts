import { existsSync, statSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { tool } from 'ai'
import { z } from 'zod'
import { resolveWithinRoot } from '../../policy/paths.ts'
import type { ToolExecutionContext } from '../../core/types.ts'
import { executeWithPolicy } from '../pipeline.ts'
import { GREP_DESCRIPTION } from './prompt.ts'

export const grepInputSchema = z.object({
  pattern: z.string().describe('Regex or substring pattern to search for.'),
  path: z.string().default('.').describe('Workspace path (directory or file) to search in.'),
  maxResults: z.number().int().min(1).default(50).describe('Maximum number of matches to return.'),
})

interface GrepMatch {
  readonly file: string
  readonly line: number
  readonly content: string
}

const IGNORED_DIRS = new Set(['.git', 'node_modules', '.cache', 'dist', 'build', '.ant'])

async function scanDirectory(
  dirPath: string,
  rootCwd: string,
  regex: RegExp,
  matches: GrepMatch[],
  maxResults: number
): Promise<void> {
  if (matches.length >= maxResults) return

  const entries = await readdir(dirPath, { withFileTypes: true })
  for (const entry of entries) {
    if (matches.length >= maxResults) break

    const fullPath = join(dirPath, entry.name)
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) {
        await scanDirectory(fullPath, rootCwd, regex, matches, maxResults)
      }
    } else if (entry.isFile()) {
      try {
        const text = await readFile(fullPath, 'utf-8')
        const lines = text.split('\n')
        const relPath = relative(rootCwd, fullPath)

        for (let i = 0; i < lines.length; i++) {
          if (matches.length >= maxResults) break
          const line = lines[i]!
          if (regex.test(line)) {
            matches.push({
              file: relPath,
              line: i + 1,
              content: line.trim(),
            })
          }
        }
      } catch {
        // Skip binary or unreadable files gracefully
      }
    }
  }
}

export function createGrepTool(context: ToolExecutionContext) {
  return tool({
    description: GREP_DESCRIPTION,
    inputSchema: grepInputSchema,
    execute: async (input) => {
      return executeWithPolicy('Grep', input, context, async ({ pattern, path, maxResults }) => {
        const fullPath = resolveWithinRoot(path, context.cwd)

        if (!existsSync(fullPath)) {
          throw new Error(`Path not found: ${path}`)
        }

        const regex = new RegExp(pattern)
        const matches: GrepMatch[] = []

        const stats = statSync(fullPath)
        if (stats.isDirectory()) {
          await scanDirectory(fullPath, context.cwd, regex, matches, maxResults)
        } else {
          const text = await readFile(fullPath, 'utf-8')
          const lines = text.split('\n')
          const relPath = relative(context.cwd, fullPath)
          for (let i = 0; i < lines.length; i++) {
            if (matches.length >= maxResults) break
            const line = lines[i]!
            if (regex.test(line)) {
              matches.push({
                file: relPath,
                line: i + 1,
                content: line.trim(),
              })
            }
          }
        }

        return {
          pattern,
          matches,
          totalMatches: matches.length,
          truncated: matches.length >= maxResults,
        }
      })
    },
  })
}

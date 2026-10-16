import { isSensitivePath } from '../../policy/sensitive.ts'
import { existsSync, statSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tool } from 'ai'
import { z } from 'zod'
import { relToRoot, resolveWithinRoot } from '../../policy/paths.ts'
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
const MAX_GREP_FILE_BYTES = 2 * 1024 * 1024 // 2 MiB

async function scanDirectory(
  dirPath: string,
  rootCwd: string,
  regex: RegExp,
  matches: GrepMatch[],
  internalLimit: number,
  allowSensitive: boolean
): Promise<void> {
  if (matches.length >= internalLimit) return

  const entries = await readdir(dirPath, { withFileTypes: true })
  for (const entry of entries) {
    if (matches.length >= internalLimit) break

    const fullPath = join(dirPath, entry.name)
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) {
        await scanDirectory(fullPath, rootCwd, regex, matches, internalLimit, allowSensitive)
      }
    } else if (entry.isFile()) {
      if (isSensitivePath(fullPath) && !allowSensitive) {
        continue
      }
      try {
        const stats = statSync(fullPath)
        if (stats.size > MAX_GREP_FILE_BYTES) {
          continue
        }
        const buf = await readFile(fullPath)
        if (buf.includes(0)) {
          continue
        }
        const text = buf.toString('utf-8')
        const lines = text.split('\n')
        const relPath = relToRoot(rootCwd, fullPath)

        for (let i = 0; i < lines.length; i++) {
          if (matches.length >= internalLimit) break
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

        let regex: RegExp
        try {
          regex = new RegExp(pattern)
        } catch (err) {
          throw new Error(`Invalid regex: ${err instanceof Error ? err.message : String(err)}`)
        }

        const internalLimit = maxResults + 1
        const matches: GrepMatch[] = []
        const allowSensitive = context.effectivePermissions.mode === 'bypassPermissions'

        const stats = statSync(fullPath)
        if (stats.isDirectory()) {
          await scanDirectory(fullPath, context.cwd, regex, matches, internalLimit, allowSensitive)
        } else {
          if (isSensitivePath(fullPath) && !allowSensitive) {
            throw new Error(`Access denied: searching sensitive file "${path}" requires explicit sensitive authorization.`)
          }
          if (stats.size > MAX_GREP_FILE_BYTES) {
            throw new Error(`File "${path}" is too large to grep (${Math.round(stats.size / (1024 * 1024))} MiB). Limit is 2 MiB.`)
          }
          const buf = await readFile(fullPath)
          if (buf.includes(0)) {
            throw new Error(`Cannot grep binary file "${path}".`)
          }
          const text = buf.toString('utf-8')
          const lines = text.split('\n')
          const relPath = relToRoot(context.cwd, fullPath)
          for (let i = 0; i < lines.length; i++) {
            if (matches.length >= internalLimit) break
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

        const truncated = matches.length > maxResults
        const returnedMatches = truncated ? matches.slice(0, maxResults) : matches

        return {
          pattern,
          matches: returnedMatches,
          totalMatches: returnedMatches.length,
          truncated,
        }
      })
    },
  })
}

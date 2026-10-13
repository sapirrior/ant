import { tool } from 'ai'
import { z } from 'zod'
import type { ToolExecutionContext } from '../../core/types.ts'
import { executeWithPolicy } from '../pipeline.ts'

// ─── Constants from example.ts ───────────────────────────────────────────────

const DEFAULT_SEARCH_LIMIT = 5
const MAX_SEARCH_LIMIT = 20
const SEARCH_TIMEOUT_MS = 12000

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 (Steward/CLI)'

// ─── Schemas ──────────────────────────────────────────────────────────────────

export const WebSearchSchema = z.object({
  query: z.string().min(1).describe('The search query or keywords to look up on the web.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_SEARCH_LIMIT)
    .optional()
    .describe('Maximum number of search results to return (default: 5, max: 20).'),
  allowedDomains: z
    .array(z.string())
    .optional()
    .describe('Optional list of domains to restrict search results to (e.g. ["github.com", "bun.sh"]).'),
  blockedDomains: z
    .array(z.string())
    .optional()
    .describe('Optional list of domains to exclude from search results.'),
})

export type WebSearchInput = z.infer<typeof WebSearchSchema>

export interface WebSearchHit {
  title: string
  url: string
  snippet: string
  domain: string
}

export interface WebSearchData {
  query: string
  results: WebSearchHit[]
  totalResults: number
  durationMs: number
}

// ─── Helper Functions from example.ts ────────────────────────────────────────

export function decodeEntities(text: string): string {
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/\s+/g, ' ')
    .trim()
}

export function resolveRedirectUrl(rawUrl: string): string {
  let url = rawUrl.trim()
  if (url.startsWith('//')) {
    url = `https:${url}`
  }
  if (url.includes('uddg=')) {
    try {
      const parsed = new URL(url.startsWith('http') ? url : `https://duckduckgo.com${url}`)
      const uddg = parsed.searchParams.get('uddg')
      if (uddg) {
        return decodeURIComponent(uddg)
      }
    } catch {
      const match = url.match(/uddg=([^&]+)/)
      if (match && match[1]) {
        return decodeURIComponent(match[1])
      }
    }
  }
  return url
}

export function describeWebSearch(input: WebSearchInput): string {
  const q = input.query.length > 50 ? `${input.query.slice(0, 47)}...` : input.query
  return `"${q}"`
}

export function summarizeWebSearch(output: unknown): string {
  if (!output || typeof output !== 'object') {
    return 'done'
  }
  const obj = output as Record<string, unknown>
  if (Array.isArray(obj.results)) {
    return `${obj.results.length} results`
  }
  return 'done'
}

export function parseDuckDuckGoResults(html: string, params: WebSearchInput, effectiveLimit: number): WebSearchHit[] {
  const results: WebSearchHit[] = []

  // Split on result blocks as in example.ts
  const resultBlocks = html.split(/<div\s+class="[^"]*result\s+results_links/)

  const allowedDomainsSet = params.allowedDomains
    ? new Set(params.allowedDomains.map((d) => d.toLowerCase()))
    : null
  const blockedDomainsSet = params.blockedDomains
    ? new Set(params.blockedDomains.map((d) => d.toLowerCase()))
    : null

  for (const block of resultBlocks.slice(1)) {
    if (results.length >= effectiveLimit) break

    // Filter out ads
    if (block.includes('badge--ad') || block.includes('result--ad')) continue

    const titleMatch = block.match(
      /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i
    )
    const snippetMatch = block.match(
      /<(?:a|div|span)[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div|span)>/i
    )

    if (titleMatch && titleMatch[1]) {
      const rawUrl = titleMatch[1]
      const resolvedUrl = resolveRedirectUrl(rawUrl)

      if (!resolvedUrl.startsWith('http://') && !resolvedUrl.startsWith('https://')) {
        continue
      }

      let domain = ''
      try {
        domain = new URL(resolvedUrl).hostname.toLowerCase()
      } catch {
        continue
      }

      if (
        allowedDomainsSet &&
        !allowedDomainsSet.has(domain) &&
        !Array.from(allowedDomainsSet).some((d) => domain.endsWith(`.${d}`))
      ) {
        continue
      }

      if (
        blockedDomainsSet &&
        (blockedDomainsSet.has(domain) ||
          Array.from(blockedDomainsSet).some((d) => domain.endsWith(`.${d}`)))
      ) {
        continue
      }

      const title = decodeEntities(titleMatch[2] || 'Untitled')
      const snippet = snippetMatch && snippetMatch[1] ? decodeEntities(snippetMatch[1]) : ''

      results.push({
        title,
        url: resolvedUrl,
        snippet,
        domain,
      })
    }
  }

  return results
}

export async function executeWebSearch(
  params: WebSearchInput,
  context?: ToolExecutionContext
): Promise<{ text: string; data: WebSearchData }> {
  const startTime = Date.now()
  const effectiveLimit = Math.min(
    Math.max(1, params.limit ?? DEFAULT_SEARCH_LIMIT),
    MAX_SEARCH_LIMIT
  )

  let queryWithSite = params.query
  if (params.allowedDomains && params.allowedDomains.length === 1) {
    queryWithSite = `${params.query} site:${params.allowedDomains[0]}`
  }

  const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(queryWithSite)}`

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS)

  if (context?.abortSignal) {
    context.abortSignal.addEventListener('abort', () => controller.abort(), { once: true })
  }

  try {
    const response = await fetch(searchUrl, {
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        Referer: 'https://html.duckduckgo.com/',
        DNT: '1',
        Connection: 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
      },
      signal: controller.signal,
    })

    let html: string
    try {
      if (!response.ok) {
        throw new Error(`DuckDuckGo web search failed with HTTP status ${response.status} (${response.statusText})`)
      }
      html = await response.text()
    } finally {
      clearTimeout(timeoutId)
    }

    if (
      html.includes('id="anomaly-modal"') ||
      html.includes('class="anomaly-modal"') ||
      html.includes('anomaly_modal') ||
      html.includes('Please complete the security check')
    ) {
      throw new Error('Search rate limited by DuckDuckGo. Please retry in a few moments.')
    }

    const results = parseDuckDuckGoResults(html, params, effectiveLimit)
    const durationMs = Date.now() - startTime

    let formattedOutput: string
    if (results.length === 0) {
      formattedOutput = `No web results found for query: "${params.query}"`
    } else {
      const outputLines: string[] = [`Web search results for: "${params.query}"\n`]
      results.forEach((item, idx) => {
        outputLines.push(`${idx + 1}. [${item.title}](${item.url})`)
        if (item.snippet) {
          outputLines.push(`   ${item.snippet}`)
        }
        outputLines.push('')
      })
      outputLines.push('REMINDER: Include reference links when citing these search results.')
      formattedOutput = outputLines.join('\n').trim()
    }

    return {
      text: formattedOutput,
      data: {
        query: params.query,
        results,
        totalResults: results.length,
        durationMs,
      },
    }
  } catch (err: unknown) {
    clearTimeout(timeoutId)
    if (err && typeof err === 'object' && (err as { name?: string }).name === 'AbortError') {
      throw new Error(`Web search for '${params.query}' timed out after ${SEARCH_TIMEOUT_MS}ms.`)
    }
    throw err
  }
}

export function createWebSearchTool(context: ToolExecutionContext) {
  return tool({
    description:
      'Search the live web directly for up-to-date documentation, technical answers, package releases, and tutorials. Returns titles, clickable links, and snippets.',
    inputSchema: WebSearchSchema,
    execute: async (input) => {
      return executeWithPolicy('WebSearch', input, context, async (args) => {
        const { text, data } = await executeWebSearch(args, context)
        return {
          formatted: text,
          ...data,
        }
      })
    },
  })
}

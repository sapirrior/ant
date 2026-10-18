import { isIP } from 'node:net'
import { tool } from 'ai'
import { z } from 'zod'
import type { ToolExecutionContext } from '../../core/types.ts'
import { executeWithPolicy } from '../pipeline.ts'
import { WEB_FETCH_DESCRIPTION } from './prompt.ts'
import { validatePublicHost, type HostLookupFn } from '../../policy/net.ts'
import { decodeEntities } from '../../utils/html.ts'

export const webFetchInputSchema = z.object({
  url: z.string().url().describe('The web page URL to fetch.'),
  maxChars: z
    .number()
    .int()
    .min(500)
    .max(100000)
    .optional()
    .default(25000)
    .describe('Maximum characters of formatted text/markdown to return (default 25000).'),
})

export function describeWebFetch(input: z.infer<typeof webFetchInputSchema>): string {
  try {
    const parsed = new URL(input.url)
    return `${parsed.hostname}${parsed.pathname}`.slice(0, 50)
  } catch {
    return input.url.slice(0, 50)
  }
}

export function summarizeWebFetch(output: unknown): string {
  if (!output || typeof output !== 'object') {
    return 'done'
  }
  const obj = output as Record<string, unknown>
  if (typeof obj.content === 'string') {
    const kb = (obj.content.length / 1024).toFixed(1)
    return `${kb} KB read · ${Number(obj.totalChunks ?? 1)} chunk(s)`
  }
  return 'done'
}

/**
 * Extracts and transforms raw HTML into clean, readable text / markdown
 */
export function transformHtmlToReadableMarkdown(html: string): { title: string; markdown: string } {
  // 1. Extract title
  const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/is)
  const title = titleMatch ? cleanText(titleMatch[1]!) : ''

  // 2. Remove script, style, svg, noscript, iframe, link, meta
  let clean = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, ' ')
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, ' ')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')

  // 3. Remove navigational / boilerplate landmarks (nav, header, footer, aside)
  clean = clean
    .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, ' ')
    .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, ' ')
    .replace(/<aside\b[^<]*(?:(?!<\/aside>)<[^<]*)*<\/aside>/gi, ' ')

  // 4. Focus on main / article content if available
  const mainMatch =
    clean.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i) ||
    clean.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)
  if (mainMatch && mainMatch[1]!.length > 200) {
    clean = mainMatch[1]!
  }

  // 5. Convert standard markdown structures
  // Headings
  clean = clean.replace(/<h1[^>]*>(.*?)<\/h1>/gis, '\n\n# $1\n\n')
  clean = clean.replace(/<h2[^>]*>(.*?)<\/h2>/gis, '\n\n## $1\n\n')
  clean = clean.replace(/<h3[^>]*>(.*?)<\/h3>/gis, '\n\n### $1\n\n')
  clean = clean.replace(/<h4[^>]*>(.*?)<\/h4>/gis, '\n\n#### $1\n\n')
  clean = clean.replace(/<h5[^>]*>(.*?)<\/h5>/gis, '\n\n##### $1\n\n')
  clean = clean.replace(/<h6[^>]*>(.*?)<\/h6>/gis, '\n\n###### $1\n\n')

  // Code blocks and inline code
  clean = clean.replace(/<pre[^>]*><code[^>]*>(.*?)<\/code><\/pre>/gis, '\n\n```\n$1\n```\n\n')
  clean = clean.replace(/<pre[^>]*>(.*?)<\/pre>/gis, '\n\n```\n$1\n```\n\n')
  clean = clean.replace(/<code[^>]*>(.*?)<\/code>/gis, '`$1`')

  // Links: [text](href)
  clean = clean.replace(/<a[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gis, (_match, href, text) => {
    const cleanT = text.replace(/<[^>]+>/g, '').trim()
    if (!cleanT || href.startsWith('#') || href.startsWith('javascript:')) return cleanT
    return `[${cleanT}](${href})`
  })

  // Lists: <li> -> -
  clean = clean.replace(/<li[^>]*>(.*?)<\/li>/gis, '\n- $1')

  // Paragraphs & breaks
  clean = clean.replace(/<br\s*\/?>/gi, '\n')
  clean = clean.replace(/<p[^>]*>(.*?)<\/p>/gis, '\n\n$1\n\n')
  clean = clean.replace(/<div[^>]*>(.*?)<\/div>/gis, '\n$1\n')

  // 6. Strip all remaining HTML tags
  clean = clean.replace(/<[^>]+>/g, ' ')

  // 7. Unescape entities
  clean = decodeEntities(clean)

  // 8. Collapse whitespace and repeated empty lines
  const lines = clean
    .split('\n')
    .map((l) => l.trim())
    .filter((l, idx, arr) => {
      // deduplicate consecutive empty lines
      if (l === '' && arr[idx - 1] === '') return false
      return true
    })

  const markdown = lines.join('\n').trim()
  return { title, markdown }
}

function cleanText(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function chunkText(text: string, maxChunkChars = 8000): string[] {
  if (text.length <= maxChunkChars) {
    return [text]
  }

  const chunks: string[] = []
  let cursor = 0

  while (cursor < text.length) {
    let end = Math.min(cursor + maxChunkChars, text.length)
    if (end < text.length) {
      // Find a natural paragraph, line, or space to split on
      const lastParagraph = text.lastIndexOf('\n\n', end)
      if (lastParagraph > cursor) {
        end = lastParagraph
      } else {
        const lastLine = text.lastIndexOf('\n', end)
        if (lastLine > cursor) {
          end = lastLine
        } else {
          const lastSpace = text.lastIndexOf(' ', end)
          if (lastSpace > cursor) {
            end = lastSpace
          }
        }
      }
    }

    chunks.push(text.slice(cursor, end).trim())
    // Skip any trailing separators for the next chunk
    cursor = end
    while (cursor < text.length && (text[cursor] === '\n' || text[cursor] === ' ')) {
      cursor++
    }
  }

  return chunks.filter(Boolean)
}

export type FetchFn = (
  input: string | URL | Request,
  init?: RequestInit & { tls?: { serverName?: string } },
) => Promise<Response>

export interface WebFetchToolOptions {
  fetchFn?: FetchFn
  lookupFn?: HostLookupFn
}

export function createWebFetchTool(
  context: ToolExecutionContext,
  toolOptions?: WebFetchToolOptions,
) {
  return tool({
    description: WEB_FETCH_DESCRIPTION,
    inputSchema: webFetchInputSchema,
    execute: async (input) => {
      return executeWithPolicy('WebFetch', input, context, async (args) => {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 20000)
        const onAbort = () => controller.abort()
        if (context.abortSignal) {
          context.abortSignal.addEventListener('abort', onAbort, { once: true })
        }

        try {
          let currentUrl = args.url
          let res: Response | null = null

          for (let hop = 0; hop < 5; hop++) {
            let parsedUrl: URL
            try {
              parsedUrl = new URL(currentUrl)
            } catch {
              throw new Error(`Invalid URL: "${currentUrl}"`)
            }

            if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
              throw new Error(
                `Invalid protocol "${parsedUrl.protocol}". Only http: and https: are allowed.`,
              )
            }

            const validatedIps = await validatePublicHost(parsedUrl.hostname, toolOptions?.lookupFn)
            const targetIp = validatedIps[0]
            if (!targetIp) {
              throw new Error(`Failed to resolve host "${parsedUrl.hostname}": no addresses found`)
            }

            const ipHost = targetIp.includes(':') ? `[${targetIp}]` : targetIp
            const portPart = parsedUrl.port ? `:${parsedUrl.port}` : ''
            const pinnedUrl = `${parsedUrl.protocol}//${ipHost}${portPart}${parsedUrl.pathname}${parsedUrl.search}`

            const fetchHeaders: Record<string, string> = {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              Accept:
                'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7',
              Host: parsedUrl.host,
            }

            const fetchOptions: RequestInit & { tls?: { serverName?: string } } = {
              headers: fetchHeaders,
              redirect: 'manual',
              signal: controller.signal,
            }

            if (parsedUrl.protocol === 'https:' && !isIP(parsedUrl.hostname)) {
              fetchOptions.tls = {
                serverName: parsedUrl.hostname,
              }
            }

            const fetchImpl = toolOptions?.fetchFn ?? fetch
            const resp = await fetchImpl(pinnedUrl, fetchOptions)

            if (resp.status >= 300 && resp.status < 400 && resp.headers.get('location')) {
              currentUrl = new URL(resp.headers.get('location')!, currentUrl).toString()
              continue
            }

            res = resp
            break
          }

          if (!res) {
            throw new Error(`Failed to fetch ${args.url}: too many redirects`)
          }

          if (!res.ok) {
            throw new Error(`Failed to fetch ${args.url}: HTTP ${res.status} ${res.statusText}`)
          }

          const contentType = res.headers.get('content-type') || ''
          const isAllowedType =
            contentType.includes('text/') ||
            contentType.includes('application/json') ||
            contentType.includes('application/xml') ||
            contentType.includes('application/xhtml+xml')

          if (!isAllowedType) {
            throw new Error(
              `Unsupported content type "${contentType}". Only text and HTML/XML/JSON content are supported.`,
            )
          }

          const isHtml = contentType.includes('html')

          // Read body with 5 MiB cap
          const reader = res.body?.getReader()
          let rawBody = ''
          if (reader) {
            const decoder = new TextDecoder()
            let bytesRead = 0
            const MAX_BYTES = 5 * 1024 * 1024
            while (true) {
              const { done, value } = await reader.read()
              if (done) break
              bytesRead += value.byteLength
              if (bytesRead > MAX_BYTES) {
                reader.cancel()
                throw new Error('Response body exceeded maximum limit of 5 MiB')
              }
              rawBody += decoder.decode(value, { stream: true })
            }
            rawBody += decoder.decode()
          } else {
            rawBody = await res.text()
          }

          let title = ''
          let formattedContent = ''

          if (isHtml) {
            const transformed = transformHtmlToReadableMarkdown(rawBody)
            title = transformed.title
            formattedContent = transformed.markdown
          } else {
            formattedContent = rawBody.trim()
          }

          const maxChars = args.maxChars ?? 25000
          const truncated = formattedContent.length > maxChars
          const contentSlice = truncated ? formattedContent.slice(0, maxChars) : formattedContent
          const chunks = chunkText(contentSlice, 8000)

          return {
            url: args.url,
            title: title || undefined,
            contentType,
            totalChars: formattedContent.length,
            returnedChars: contentSlice.length,
            truncated,
            totalChunks: chunks.length,
            content: contentSlice,
          }
        } finally {
          clearTimeout(timer)
          if (context.abortSignal) {
            context.abortSignal.removeEventListener('abort', onAbort)
          }
        }
      })
    },
  })
}

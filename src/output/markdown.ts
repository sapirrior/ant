import { marked, type Token, type Tokens } from 'marked'
import { highlight, supportsLanguage } from 'cli-highlight'
import { createColorFormatter, type ColorLevel } from './color.ts'

export interface MarkdownOptions {
  columns?: number
  colorLevel?: ColorLevel
}

const EOL = '\n'

let markedConfigured = false
function configureMarked(): void {
  if (markedConfigured) return
  markedConfigured = true
  marked.use({
    tokenizer: {
      del() {
        return undefined
      },
    },
  })
}

export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
}

export function stringWidth(text: string): number {
  return stripAnsi(text).length
}

export function getTerminalColumns(): number {
  const envCols = process.env.COLUMNS ? Number.parseInt(process.env.COLUMNS, 10) : NaN
  if (!Number.isNaN(envCols) && envCols > 0) {
    return Math.max(20, envCols)
  }
  const termCols = process.stdout.columns || 80
  // Sensible max margin to avoid overly long lines in wide terminals, while wrapping comfortably
  return Math.max(20, Math.min(termCols - 2, 120))
}

export function wrapParagraph(text: string, maxWidth: number): string {
  if (maxWidth <= 0 || text.length === 0) return text

  // Preserve pre-existing newlines within text blocks
  const rawLines = text.split(EOL)
  const wrappedLines: string[] = []

  for (const rawLine of rawLines) {
    if (!rawLine.trim()) {
      wrappedLines.push('')
      continue
    }

    // Preserve leading indentation if present
    const indentMatch = rawLine.match(/^(\s+)/)
    const indent = indentMatch ? indentMatch[1]! : ''
    const content = indentMatch ? rawLine.slice(indent.length) : rawLine

    const words = content.split(/ +/)
    let currentLine = indent
    let currentLineWidth = stringWidth(indent)

    for (const word of words) {
      if (!word) continue
      const wordWidth = stringWidth(word)

      if (currentLine === indent) {
        currentLine += word
        currentLineWidth += wordWidth
      } else if (currentLineWidth + 1 + wordWidth <= maxWidth) {
        currentLine += ' ' + word
        currentLineWidth += 1 + wordWidth
      } else {
        wrappedLines.push(currentLine)
        currentLine = indent + word
        currentLineWidth = stringWidth(indent) + wordWidth
      }
    }

    if (currentLine.length > 0) {
      wrappedLines.push(currentLine)
    }
  }

  return wrappedLines.join(EOL)
}

function formatToken(
  token: Token,
  fmt: ReturnType<typeof createColorFormatter>,
  listDepth = 0,
  orderedListNumber: number | null = null,
  parent: Token | null = null,
  maxWidth: number = 0
): string {
  switch (token.type) {
    case 'blockquote': {
      const inner = (token.tokens ?? [])
        .map((t: Token) => formatToken(t, fmt, 0, null, null, maxWidth > 2 ? maxWidth - 2 : maxWidth))
        .join('')
      const bar = fmt.muted('│')
      return (
        inner
          .split(EOL)
          .map((line: string) =>
            stripAnsi(line).trim() ? `${bar} ${fmt.italic(line)}` : line
          )
          .join(EOL) + EOL
      )
    }

    case 'code': {
      let code = token.text
      if (fmt.level > 0 && token.lang && supportsLanguage(token.lang)) {
        try {
          code = highlight(token.text, { language: token.lang })
        } catch {
          // fallback to plaintext
        }
      }
      return code + EOL
    }

    case 'codespan': {
      return fmt.secondary(token.text)
    }

    case 'em': {
      return fmt.italic(
        (token.tokens ?? [])
          .map((t: Token) => formatToken(t, fmt, 0, null, parent))
          .join('')
      )
    }

    case 'strong': {
      return fmt.bold(
        (token.tokens ?? [])
          .map((t: Token) => formatToken(t, fmt, 0, null, parent))
          .join('')
      )
    }

    case 'heading': {
      const headingText = (token.tokens ?? [])
        .map((t: Token) => formatToken(t, fmt, 0, null, null))
        .join('')
      if (token.depth === 1) {
        return fmt.underline(fmt.italic(fmt.bold(headingText))) + EOL + EOL
      }
      return fmt.bold(headingText) + EOL + EOL
    }

    case 'hr': {
      return '---' + EOL
    }

    case 'image': {
      return token.href
    }

    case 'link': {
      if (token.href.startsWith('mailto:')) {
        return token.href.replace(/^mailto:/, '')
      }
      const linkText = (token.tokens ?? [])
        .map((t: Token) => formatToken(t, fmt, 0, null, token))
        .join('')
      const plainLinkText = stripAnsi(linkText)
      if (plainLinkText && plainLinkText !== token.href) {
        return `${linkText} (${fmt.muted(token.href)})`
      }
      return token.href
    }

    case 'list': {
      return (
        token.items
          .map((item: Tokens.ListItem, index: number) =>
            formatToken(
              item,
              fmt,
              listDepth,
              token.ordered ? (token.start ?? 1) + index : null,
              token,
              maxWidth
            )
          )
          .join('')
      )
    }

    case 'list_item': {
      const indentWidth = listDepth * 2
      const remainingWidth = maxWidth > indentWidth ? maxWidth - indentWidth : maxWidth
      return (token.tokens ?? [])
        .map(
          (t: Token) =>
            `${'  '.repeat(listDepth)}${formatToken(t, fmt, listDepth + 1, orderedListNumber, token, remainingWidth)}`
        )
        .join('')
    }

    case 'paragraph': {
      const inner = (token.tokens ?? [])
        .map((t: Token) => formatToken(t, fmt, 0, null, null, maxWidth))
        .join('')
      if (maxWidth && maxWidth > 0) {
        return wrapParagraph(inner, maxWidth) + EOL
      }
      return inner + EOL
    }

    case 'space':
    case 'br': {
      return EOL
    }

    case 'text': {
      if (parent?.type === 'link') {
        return token.text
      }
      if (parent?.type === 'list_item') {
        const marker = orderedListNumber === null ? '-' : `${orderedListNumber}.`
        const textContent = token.tokens
          ? token.tokens
              .map((t: Token) => formatToken(t, fmt, listDepth, orderedListNumber, token))
              .join('')
          : token.text
        return `${marker} ${textContent}${EOL}`
      }
      return token.text
    }

    case 'table': {
      const tableToken = token as Tokens.Table

      function getDisplayText(tokens: Token[] | undefined): string {
        return stripAnsi(
          tokens?.map((t: Token) => formatToken(t, fmt, 0, null, null)).join('') ?? ''
        )
      }

      const columnWidths = tableToken.header.map((header: Tokens.Table['header'][number], index: number) => {
        let maxWidth = stringWidth(getDisplayText(header.tokens))
        for (const row of tableToken.rows) {
          const cellLength = stringWidth(getDisplayText(row[index]?.tokens))
          maxWidth = Math.max(maxWidth, cellLength)
        }
        return Math.max(maxWidth, 3)
      })

      let tableOutput = '| '
      tableToken.header.forEach((header: Tokens.Table['header'][number], index: number) => {
        const content =
          header.tokens?.map((t: Token) => formatToken(t, fmt, 0, null, null)).join('') ?? ''
        const width = columnWidths[index]!
        const padding = ' '.repeat(Math.max(0, width - stringWidth(content)))
        tableOutput += `${content}${padding} | `
      })
      tableOutput = tableOutput.trimEnd() + EOL

      tableOutput += '| '
      columnWidths.forEach((width: number) => {
        tableOutput += `${'-'.repeat(width)} | `
      })
      tableOutput = tableOutput.trimEnd() + EOL

      tableToken.rows.forEach((row: Tokens.Table['rows'][number]) => {
        tableOutput += '| '
        row.forEach((cell: Tokens.TableCell, index: number) => {
          const content =
            cell.tokens?.map((t: Token) => formatToken(t, fmt, 0, null, null)).join('') ?? ''
          const width = columnWidths[index]!
          const padding = ' '.repeat(Math.max(0, width - stringWidth(content)))
          tableOutput += `${content}${padding} | `
        })
        tableOutput = tableOutput.trimEnd() + EOL
      })

      return tableOutput
    }

    case 'escape': {
      return token.text
    }

    case 'def':
    case 'del':
    case 'html': {
      return ''
    }

    default: {
      return ''
    }
  }
}

export function renderMarkdown(content: string, options: MarkdownOptions = {}): string {
  configureMarked()
  const fmt = createColorFormatter(options.colorLevel)
  const columns = options.columns ?? getTerminalColumns()
  const tokens = marked.lexer(content)
  return tokens
    .map((t: Token) => formatToken(t, fmt, 0, null, null, columns))
    .join('')
    .trim()
}

/**
 * Streaming Markdown Renderer
 * Buffers partial lines and renders completed block/line structures in real-time
 */
export class StreamingMarkdownRenderer {
  private buffer = ''
  private insideCodeBlock = false
  private codeLang = ''
  private readonly fmt: ReturnType<typeof createColorFormatter>
  private readonly columns: number

  constructor(options: MarkdownOptions = {}) {
    this.fmt = createColorFormatter(options.colorLevel)
    this.columns = options.columns ?? getTerminalColumns()
  }

  append(delta: string): string {
    this.buffer += delta
    let output = ''

    while (true) {
      const newlineIdx = this.buffer.indexOf('\n')
      if (newlineIdx === -1) break

      const line = this.buffer.slice(0, newlineIdx)
      this.buffer = this.buffer.slice(newlineIdx + 1)

      output += this.renderLine(line) + '\n'
    }

    return output
  }

  flush(): string {
    if (this.buffer.length === 0) return ''
    const remaining = this.buffer
    this.buffer = ''
    return this.renderLine(remaining)
  }

  private renderLine(line: string): string {
    const trimmed = line.trim()

    // 1. Code fence check
    if (trimmed.startsWith('```')) {
      if (!this.insideCodeBlock) {
        this.insideCodeBlock = true
        this.codeLang = trimmed.slice(3).trim()
        return ''
      } else {
        this.insideCodeBlock = false
        this.codeLang = ''
        return ''
      }
    }

    // Inside code block
    if (this.insideCodeBlock) {
      if (this.fmt.level > 0 && this.codeLang && supportsLanguage(this.codeLang)) {
        try {
          return highlight(line, { language: this.codeLang })
        } catch {
          // fallback
        }
      }
      return line
    }

    // 2. Headings
    if (/^#{1,6}\s+/.test(trimmed)) {
      const headingText = trimmed.replace(/^#{1,6}\s+/, '')
      return this.fmt.bold(this.renderInline(headingText))
    }

    // 3. Blockquotes
    if (trimmed.startsWith('>')) {
      const quoteText = trimmed.replace(/^>\s*/, '')
      return `${this.fmt.muted('│')} ${this.fmt.italic(this.renderInline(quoteText))}`
    }

    // 4. Horizontal rules
    if (/^(\*\*\*|---|___)$/.test(trimmed)) {
      return this.fmt.muted('───')
    }

    // 5. Unordered lists
    if (/^[-*+]\s+/.test(trimmed)) {
      const itemText = trimmed.replace(/^[-*+]\s+/, '')
      return `  - ${this.renderInline(itemText)}`
    }

    // 6. Ordered lists
    if (/^\d+\.\s+/.test(trimmed)) {
      const match = trimmed.match(/^(\d+\.)\s+(.*)/)
      if (match) {
        return `  ${match[1]} ${this.renderInline(match[2]!)}`
      }
    }

    // Standard text paragraph line - smart wrap based on terminal columns
    const rendered = this.renderInline(line)
    if (this.columns > 0 && stringWidth(rendered) > this.columns) {
      return wrapParagraph(rendered, this.columns)
    }
    return rendered
  }

  private renderInline(text: string): string {
    // Codespan `code`
    let res = text.replace(/`([^`]+)`/g, (_, code) => this.fmt.secondary(code))
    // Bold **text**
    res = res.replace(/\*\*([^*]+)\*\*/g, (_, bold) => this.fmt.bold(bold))
    // Italic *text*
    res = res.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, (_, em) => this.fmt.italic(em))
    return res
  }
}

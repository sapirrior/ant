import { marked, type Token, type Tokens } from 'marked'
import { highlight, supportsLanguage, type Theme } from 'cli-highlight'
import { createColorFormatter, getSymbols, type ColorLevel, type ThemeMode } from './color.ts'
import { visibleWidth } from '../utils/format.ts'

export interface MarkdownOptions {
  columns?: number
  colorLevel?: ColorLevel
  theme?: ThemeMode
}

const EOL = '\n'

const LANGUAGE_ALIASES: Record<string, string> = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'typescript',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  bash: 'bash',
  py: 'python',
  python3: 'python',
  rb: 'ruby',
  rs: 'rust',
  yml: 'yaml',
  yaml: 'yaml',
  json: 'json',
  golang: 'go',
  go: 'go',
  html: 'xml',
  xml: 'xml',
  css: 'css',
  sql: 'sql',
  md: 'markdown',
  markdown: 'markdown',
}

export function resolveLanguage(rawLang?: string): string | undefined {
  if (!rawLang) return undefined
  const clean = rawLang.trim().split(/[\s:{]/)[0]?.toLowerCase()
  if (!clean) return undefined
  const aliased = LANGUAGE_ALIASES[clean] ?? clean
  if (supportsLanguage(aliased)) {
    return aliased
  }
  return undefined
}

export function createHighlightTheme(fmt: ReturnType<typeof createColorFormatter>): Theme {
  if (fmt.level === 0) {
    const plain = (s: string) => s
    return {
      default: plain,
      keyword: plain,
      built_in: plain,
      type: plain,
      literal: plain,
      number: plain,
      regexp: plain,
      string: plain,
      subst: plain,
      symbol: plain,
      class: plain,
      function: plain,
      title: plain,
      params: plain,
      comment: plain,
      doctag: plain,
      meta: plain,
      'meta-keyword': plain,
      'meta-string': plain,
      section: plain,
      tag: plain,
      name: plain,
      'builtin-name': plain,
      attr: plain,
      attribute: plain,
      variable: plain,
      bullet: plain,
      code: plain,
      emphasis: plain,
      strong: plain,
      formula: plain,
      link: plain,
      quote: plain,
      'selector-tag': plain,
      'selector-id': plain,
      'selector-class': plain,
      'selector-attr': plain,
      'selector-pseudo': plain,
      'template-tag': plain,
      'template-variable': plain,
      addition: plain,
      deletion: plain,
    }
  }

  return {
    // Keywords, tags, and CSS selectors -> primary brand color
    keyword: (s: string) => fmt.primary(s),
    'selector-tag': (s: string) => fmt.primary(s),
    tag: (s: string) => fmt.primary(s),
    name: (s: string) => fmt.primary(s),

    // Types, built-ins, classes, attributes -> secondary accent
    built_in: (s: string) => fmt.secondary(s),
    'builtin-name': (s: string) => fmt.secondary(s),
    type: (s: string) => fmt.secondary(s),
    class: (s: string) => fmt.secondary(s),
    attr: (s: string) => fmt.secondary(s),
    attribute: (s: string) => fmt.secondary(s),
    'selector-attr': (s: string) => fmt.secondary(s),
    'selector-class': (s: string) => fmt.secondary(s),
    'selector-id': (s: string) => fmt.secondary(s),
    'selector-pseudo': (s: string) => fmt.secondary(s),

    // Strings, regexps, diff additions -> success (green)
    string: (s: string) => fmt.success(s),
    regexp: (s: string) => fmt.success(s),
    'meta-string': (s: string) => fmt.success(s),
    addition: (s: string) => fmt.success(s),

    // Numbers, literals -> warning (amber)
    number: (s: string) => fmt.warning(s),
    literal: (s: string) => fmt.warning(s),

    // Comments, annotations, metadata -> muted / dim
    comment: (s: string) => fmt.muted(fmt.italic(s)),
    doctag: (s: string) => fmt.muted(s),
    meta: (s: string) => fmt.muted(s),
    'meta-keyword': (s: string) => fmt.muted(s),

    // Functions, titles, symbols -> electric accent
    function: (s: string) => fmt.accent(s),
    title: (s: string) => fmt.accent(s),
    symbol: (s: string) => fmt.accent(s),

    // Deletions -> error (red)
    deletion: (s: string) => fmt.error(s),

    // Text formatting
    emphasis: (s: string) => fmt.italic(s),
    strong: (s: string) => fmt.bold(s),
    link: (s: string) => fmt.underline(s),

    // Unstyled fallbacks
    variable: (s: string) => s,
    'template-variable': (s: string) => s,
    'template-tag': (s: string) => s,
    params: (s: string) => s,
    subst: (s: string) => s,
    section: (s: string) => s,
    bullet: (s: string) => s,
    code: (s: string) => s,
    quote: (s: string) => s,
    formula: (s: string) => s,
    default: (s: string) => s,
  }
}

export function highlightCode(
  code: string,
  rawLang: string | undefined,
  fmt: ReturnType<typeof createColorFormatter>,
  theme?: Theme
): string {
  if (fmt.level === 0 || !code) {
    return code
  }
  const highlightTheme = theme ?? createHighlightTheme(fmt)
  const lang = resolveLanguage(rawLang)
  try {
    if (lang) {
      return highlight(code, {
        language: lang,
        theme: highlightTheme,
        ignoreIllegals: true,
      })
    }
    return highlight(code, {
      theme: highlightTheme,
      ignoreIllegals: true,
    })
  } catch {
    return code
  }
}

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
  return visibleWidth(text)
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

export function wrapParagraph(text: string, maxWidth: number, continuationIndent?: string): string {
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
    const initialIndent = indentMatch ? indentMatch[1]! : ''
    const nextIndent = continuationIndent !== undefined ? continuationIndent : initialIndent
    const content = indentMatch ? rawLine.slice(initialIndent.length) : rawLine

    const words = content.split(/ +/)
    let currentLine = initialIndent
    let currentLineWidth = stringWidth(initialIndent)

    for (const word of words) {
      if (!word) continue
      const wordWidth = stringWidth(word)

      if (currentLine === initialIndent) {
        currentLine += word
        currentLineWidth += wordWidth
      } else if (currentLineWidth + 1 + wordWidth <= maxWidth) {
        currentLine += ' ' + word
        currentLineWidth += 1 + wordWidth
      } else {
        wrappedLines.push(currentLine)
        currentLine = nextIndent + word
        currentLineWidth = stringWidth(nextIndent) + wordWidth
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
      const code = highlightCode(token.text, token.lang, fmt)
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
        let maxColWidth = visibleWidth(getDisplayText(header.tokens))
        for (const row of tableToken.rows) {
          const cellLength = visibleWidth(getDisplayText(row[index]?.tokens))
          maxColWidth = Math.max(maxColWidth, cellLength)
        }
        return Math.max(maxColWidth, 3)
      })

      let tableOutput = '| '
      tableToken.header.forEach((header: Tokens.Table['header'][number], index: number) => {
        const content =
          header.tokens?.map((t: Token) => formatToken(t, fmt, 0, null, null)).join('') ?? ''
        const width = columnWidths[index]!
        const padding = ' '.repeat(Math.max(0, width - visibleWidth(content)))
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
          const padding = ' '.repeat(Math.max(0, width - visibleWidth(content)))
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
  const fmt = createColorFormatter(options.colorLevel, options.theme)
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
  private pendingTable: string[] = []
  private readonly fmt: ReturnType<typeof createColorFormatter>
  private readonly sym: ReturnType<typeof getSymbols>
  private readonly highlightTheme: Theme
  private readonly columns: number

  constructor(options: MarkdownOptions = {}) {
    this.fmt = createColorFormatter(options.colorLevel, options.theme)
    this.sym = getSymbols()
    this.highlightTheme = createHighlightTheme(this.fmt)
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

      const rendered = this.processLine(line)
      if (rendered) {
        output += rendered
      }
    }

    return output
  }

  flush(): string {
    let output = ''
    if (this.pendingTable.length > 0) {
      output += this.flushTable()
    }
    if (this.buffer.length > 0) {
      const remaining = this.buffer
      this.buffer = ''
      const rendered = this.processLine(remaining)
      if (rendered) {
        output += rendered
      }
    }
    return output
  }

  private processLine(line: string): string {
    const trimmed = line.trim()

    // 1. Code fence check
    if (trimmed.startsWith('```')) {
      let flushedTable = ''
      if (this.pendingTable.length > 0) {
        flushedTable = this.flushTable()
      }
      if (!this.insideCodeBlock) {
        this.insideCodeBlock = true
        this.codeLang = trimmed.slice(3).trim()
        return flushedTable
      } else {
        this.insideCodeBlock = false
        this.codeLang = ''
        return flushedTable
      }
    }

    // Inside code block - do not interpret as tables
    if (this.insideCodeBlock) {
      let rendered: string
      if (this.fmt.level > 0) {
        const highlighted = line.length > 0
          ? highlightCode(line, this.codeLang, this.fmt, this.highlightTheme)
          : line
        rendered = `${this.fmt.muted(this.sym.rail)} ${highlighted}`
      } else {
        rendered = line
      }
      return rendered + '\n'
    }

    // 2. Table row detection and buffering
    const isTableRow = trimmed.startsWith('|') && trimmed.endsWith('|')
    const isTableSeparator = /^\|(?:\s*:?-+:?\s*\|)+\s*$/.test(trimmed)

    if (this.pendingTable.length > 0) {
      if (this.pendingTable.length === 1) {
        // We have a candidate header
        if (isTableSeparator) {
          // Confirmed table! Buffer the separator
          this.pendingTable.push(line)
          return ''
        } else {
          // Not a table, flush previous candidate header as ordinary text
          const header = this.pendingTable[0]!
          this.pendingTable = []
          let flushed = this.renderOrdinaryLine(header) + '\n'
          if (isTableRow) {
            this.pendingTable.push(line)
          } else {
            const current = this.renderOrdinaryLine(line)
            if (current !== null) flushed += current + '\n'
          }
          return flushed
        }
      } else {
        // Table is active (header + separator already buffered)
        if (isTableRow) {
          this.pendingTable.push(line)
          return ''
        } else {
          // End of table, flush the table and process current line
          const flushed = this.flushTable()
          const current = this.renderOrdinaryLine(line)
          return flushed + (current !== null ? current + '\n' : '')
        }
      }
    } else if (isTableRow) {
      // Possible candidate header
      this.pendingTable.push(line)
      return ''
    }

    // Normal ordinary line
    const rendered = this.renderOrdinaryLine(line)
    return rendered !== null ? rendered + '\n' : ''
  }

  private flushTable(): string {
    if (this.pendingTable.length === 0) return ''
    const rows = this.pendingTable
    this.pendingTable = []

    if (rows.length < 2) {
      // Incomplete candidate table: fallback to ordinary lines
      return rows.map((r) => this.renderOrdinaryLine(r) + '\n').join('')
    }

    const rawTable = rows.join('\n')
    configureMarked()
    const tokens = marked.lexer(rawTable)
    const tableToken = tokens.find((t: Token) => t.type === 'table')

    if (tableToken) {
      return formatToken(tableToken, this.fmt, 0, null, null, this.columns)
    }

    // Tokenization did not yield a table, fallback to ordinary lines
    return rows.map((r) => this.renderOrdinaryLine(r) + '\n').join('')
  }

  private renderOrdinaryLine(line: string): string | null {
    const trimmed = line.trim()

    // 2. Headings
    if (/^#{1,6}\s+/.test(trimmed)) {
      const headingText = trimmed.replace(/^#{1,6}\s+/, '')
      return this.fmt.bold(this.renderInline(headingText))
    }

    // 3. Blockquotes: hanging indent with rail on continuation lines
    if (trimmed.startsWith('>')) {
      const quoteText = trimmed.replace(/^>\s*/, '')
      const rendered = this.renderInline(quoteText)
      const rail = this.fmt.muted(this.sym.rail)
      const quotePrefix = `${rail} `
      if (this.columns > 0 && visibleWidth(rendered) + visibleWidth(quotePrefix) > this.columns) {
        return wrapParagraph(`${quotePrefix}${this.fmt.italic(rendered)}`, this.columns, quotePrefix)
      }
      return `${quotePrefix}${this.fmt.italic(rendered)}`
    }

    // 4. Horizontal rules
    if (/^(\*\*\*|---|___)$/.test(trimmed)) {
      return this.fmt.muted(this.sym.rule.repeat(3))
    }

    // 5. Unordered lists: hanging indent under text
    if (/^[-*+]\s+/.test(trimmed)) {
      const itemText = trimmed.replace(/^[-*+]\s+/, '')
      const rendered = this.renderInline(itemText)
      const bullet = this.sym.bullet === '-' ? '-' : this.sym.bullet
      const firstPrefix = `  ${bullet} `
      const continuationPrefix = '    '
      if (this.columns > 0 && visibleWidth(rendered) + visibleWidth(firstPrefix) > this.columns) {
        return wrapParagraph(`${firstPrefix}${rendered}`, this.columns, continuationPrefix)
      }
      return `${firstPrefix}${rendered}`
    }

    // 6. Ordered lists: hanging indent aligned under text
    if (/^\d+\.\s+/.test(trimmed)) {
      const match = trimmed.match(/^(\d+\.)\s+(.*)/)
      if (match) {
        const numPart = match[1]!
        const rendered = this.renderInline(match[2]!)
        const firstPrefix = `  ${numPart} `
        const continuationPrefix = ' '.repeat(firstPrefix.length)
        if (this.columns > 0 && visibleWidth(rendered) + visibleWidth(firstPrefix) > this.columns) {
          return wrapParagraph(`${firstPrefix}${rendered}`, this.columns, continuationPrefix)
        }
        return `${firstPrefix}${rendered}`
      }
    }

    // Standard text paragraph line - smart wrap based on terminal columns
    const rendered = this.renderInline(line)
    if (this.columns > 0 && visibleWidth(rendered) > this.columns) {
      return wrapParagraph(rendered, this.columns)
    }
    return rendered
  }

  private renderInline(text: string): string {
    const codePlaceholders: string[] = []
    const linkPlaceholders: string[] = []

    // 1. Protect inline code spans `code`
    // Use delimiters without '_' or '*' so emphasis parsers cannot match across them
    let res = text.replace(/`([^`]+)`/g, (_, code) => {
      const idx = codePlaceholders.length
      codePlaceholders.push(this.fmt.secondary(code))
      return `\x1aCODE${idx}\x1f`
    })

    // 2. Protect links [label](url)
    res = res.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => {
      const idx = linkPlaceholders.length
      linkPlaceholders.push(`${this.fmt.accent(label)} (${this.fmt.muted(url)})`)
      return `\x1aLINK${idx}\x1f`
    })

    // 3. Bold **text** and __text__
    res = res.replace(/\*\*([^*]+)\*\*/g, (_, bold) => this.fmt.bold(bold))
    res = res.replace(/__([^_]+)__/g, (_, bold) => this.fmt.bold(bold))

    // 4. Italic *text* and _text_
    res = res.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, (_, em) => this.fmt.italic(em))
    res = res.replace(/(?<!_)_([^_]+)_(?!_)/g, (_, em) => this.fmt.italic(em))

    // 5. Restore links
    res = res.replace(/\x1aLINK(\d+)\x1f/g, (_, idx) => {
      return linkPlaceholders[Number(idx)] ?? ''
    })

    // 6. Restore code spans
    res = res.replace(/\x1aCODE(\d+)\x1f/g, (_, idx) => {
      return codePlaceholders[Number(idx)] ?? ''
    })

    return res
  }
}

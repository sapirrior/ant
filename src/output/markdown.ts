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

export function wrapParagraph(text: string, maxWidth: number): string {
  if (maxWidth <= 0 || text.length === 0) return text

  const words = text.split(/ +/)
  const lines: string[] = []
  let currentLine = ''
  let currentLineWidth = 0

  for (const word of words) {
    if (!word) continue
    const wordWidth = stringWidth(word)

    if (currentLine.length === 0) {
      currentLine = word
      currentLineWidth = wordWidth
    } else if (currentLineWidth + 1 + wordWidth <= maxWidth) {
      currentLine += ' ' + word
      currentLineWidth += 1 + wordWidth
    } else {
      lines.push(currentLine)
      currentLine = word
      currentLineWidth = wordWidth
    }
  }

  if (currentLine.length > 0) {
    lines.push(currentLine)
  }

  return lines.join(EOL)
}

function padAligned(
  content: string,
  contentLength: number,
  width: number,
  align?: 'center' | 'left' | 'right' | null
): string {
  if (contentLength >= width) return content
  const totalPadding = width - contentLength

  if (align === 'right') {
    return ' '.repeat(totalPadding) + content
  }
  if (align === 'center') {
    const left = Math.floor(totalPadding / 2)
    const right = totalPadding - left
    return ' '.repeat(left) + content + ' '.repeat(right)
  }
  return content + ' '.repeat(totalPadding)
}

function formatToken(
  token: Token,
  fmt: ReturnType<typeof createColorFormatter>,
  listDepth = 0,
  orderedListNumber: number | null = null,
  parent: Token | null = null
): string {
  switch (token.type) {
    case 'blockquote': {
      const inner = (token.tokens ?? [])
        .map((t: Token) => formatToken(t, fmt, 0, null, null))
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
      return code + EOL + EOL
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
      return fmt.bold(headingText) + EOL + EOL
    }

    case 'hr': {
      return '---' + EOL + EOL
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
              token
            )
          )
          .join('') + EOL
      )
    }

    case 'list_item': {
      return (token.tokens ?? [])
        .map(
          (t: Token) =>
            `${'  '.repeat(listDepth)}${formatToken(t, fmt, listDepth + 1, orderedListNumber, token)}`
        )
        .join('')
    }

    case 'paragraph': {
      return (
        (token.tokens ?? [])
          .map((t: Token) => formatToken(t, fmt, 0, null, null))
          .join('') +
        EOL +
        EOL
      )
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
        const displayText = getDisplayText(header.tokens)
        const width = columnWidths[index]!
        const align = tableToken.align?.[index]
        tableOutput += padAligned(content, stringWidth(displayText), width, align) + ' | '
      })
      tableOutput = tableOutput.trimEnd() + EOL

      tableOutput += '|'
      columnWidths.forEach((width: number) => {
        tableOutput += '-'.repeat(width + 2) + '|'
      })
      tableOutput += EOL

      tableToken.rows.forEach((row: Tokens.Table['rows'][number]) => {
        tableOutput += '| '
        row.forEach((cell: Tokens.Table['rows'][number][number], index: number) => {
          const content =
            cell.tokens?.map((t: Token) => formatToken(t, fmt, 0, null, null)).join('') ?? ''
          const displayText = getDisplayText(cell.tokens)
          const width = columnWidths[index]!
          const align = tableToken.align?.[index]
          tableOutput += padAligned(content, stringWidth(displayText), width, align) + ' | '
        })
        tableOutput = tableOutput.trimEnd() + EOL
      })

      return tableOutput + EOL
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
  const tokens = marked.lexer(content)
  const terminalCols =
    options.columns ??
    (process.stdout.columns ? Math.min(process.stdout.columns - 2, 100) : 80)
  const cols = Math.max(20, terminalCols)

  const rendered = tokens
    .map((token: Token) => {
      const part = formatToken(token, fmt, 0, null, null)
      if (token.type === 'paragraph') {
        const trimmed = part.trimEnd()
        return wrapParagraph(trimmed, cols) + EOL + EOL
      }
      return part
    })
    .join('')
    .trim()

  return rendered
}

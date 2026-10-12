import { describe, expect, it } from 'bun:test'
import { renderMarkdown, stripAnsi, wrapParagraph } from './markdown.ts'

describe('markdown renderer', () => {
  it('strips ANSI escape codes correctly', () => {
    const styled = '\x1b[31mred\x1b[0m \x1b[1mbold\x1b[0m'
    expect(stripAnsi(styled)).toBe('red bold')
  })

  it('wraps paragraphs at word boundaries', () => {
    const text = 'The quick brown fox jumps over the lazy dog'
    const wrapped = wrapParagraph(text, 20)
    const lines = wrapped.split('\n')
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(20)
    }
  })

  it('renders level 0 without any escape codes', () => {
    const md = '# Title\n\nHere is **bold**, *italic*, and `code`.\n\n- Item 1\n- Item 2\n\n```js\nconst x = 1;\n```'
    const output = renderMarkdown(md, { colorLevel: 0 })
    expect(output).not.toContain('\x1b')
    expect(output).toContain('Title')
    expect(output).toContain('Item 1')
    expect(output).toContain('const x = 1;')
  })

  it('renders formatted elements on level 3', () => {
    const md = 'Here is `inline code`'
    const output = renderMarkdown(md, { colorLevel: 3 })
    expect(output).toContain('inline code')
    expect(output).toContain('\x1b[38;2;')
  })

  it('renders tables with columns aligned', () => {
    const md = '| Name | Age |\n|---|---|\n| Alice | 30 |\n| Bob | 25 |'
    const output = renderMarkdown(md, { colorLevel: 0 })
    expect(output).toContain('| Name')
    expect(output).toContain('| Alice')
  })
})

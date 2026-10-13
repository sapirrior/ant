import { describe, expect, it } from 'bun:test'
import { renderMarkdown, stripAnsi, wrapParagraph, StreamingMarkdownRenderer } from './markdown.ts'

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

  it('smart wraps long paragraphs to specified terminal width', () => {
    const longText = 'Ant is a daily-use streaming agent CLI designed for speed, safety, and natural terminal ergonomics with model agnosticism.'
    const rendered = renderMarkdown(longText, { columns: 40, colorLevel: 0 })
    for (const line of rendered.split('\n')) {
      expect(line.length).toBeLessThanOrEqual(40)
    }
  })

  it('highlights code blocks with level 3 truecolor matching theme', () => {
    const md = '```ts\nconst greeting: string = "hello";\n```'
    const output = renderMarkdown(md, { colorLevel: 3 })
    // Should contain truecolor ANSI sequences (\x1b[38;2;)
    expect(output).toContain('\x1b[38;2;')
    expect(output).toContain('greeting')
    expect(output).toContain('hello')
  })

  it('highlights code blocks with level 1 ANSI 16-color matching theme', () => {
    const md = '```js\nfunction test() { return 42; }\n```'
    const output = renderMarkdown(md, { colorLevel: 1 })
    // Level 1 uses standard ANSI codes like \x1b[33m (yellow), \x1b[35m (magenta) etc.
    expect(output).toMatch(/\x1b\[\d+m/)
    expect(output).not.toContain('\x1b[38;2;')
    expect(output).toContain('test')
  })

  it('highlights code blocks with level 2 ANSI 256-color', () => {
    const md = '```python\ndef calculate():\n    return 100\n```'
    const output = renderMarkdown(md, { colorLevel: 2 })
    expect(output).toContain('\x1b[38;5;')
    expect(output).toContain('calculate')
  })

  it('normalizes language info strings and aliases', () => {
    const mdWithInfo = '```ts {1-3} line-numbers\nconst x = 1;\n```'
    const output = renderMarkdown(mdWithInfo, { colorLevel: 3 })
    expect(output).toContain('\x1b[38;2;')
    expect(output).toContain('x')

    const mdWithSh = '```sh\necho "hello"\n```'
    const outputSh = renderMarkdown(mdWithSh, { colorLevel: 3 })
    expect(outputSh).toContain('\x1b[38;2;')
  })

  it('handles code blocks in StreamingMarkdownRenderer without gap lines', () => {
    const renderer = new StreamingMarkdownRenderer({ colorLevel: 0 })
    let result = ''
    result += renderer.append('Here is code:\n')
    result += renderer.append('```ts\n')
    result += renderer.append('const count = 5;\n')
    result += renderer.append('```\n')
    result += renderer.append('End of message.\n')
    result += renderer.flush()

    expect(result).not.toContain('\x1b')
    expect(result).toContain('const count = 5;')
    expect(result).toContain('End of message.')
    // Verify no triple blank lines
    expect(result).not.toContain('\n\n\n')
  })
})

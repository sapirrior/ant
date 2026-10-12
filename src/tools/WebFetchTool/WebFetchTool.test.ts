import { describe, expect, it } from 'bun:test'
import {
  chunkText,
  transformHtmlToReadableMarkdown,
} from './WebFetchTool.ts'

describe('WebFetchTool HTML-to-markdown transformation and chunking', () => {
  it('strips script, style, nav, and footers while preserving headers and text', () => {
    const rawHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Bun Documentation</title>
        <style>body { font-family: sans-serif; }</style>
        <script>window.analytics = true;</script>
      </head>
      <body>
        <nav><a href="/home">Home</a> | <a href="/about">About</a></nav>
        <main>
          <h1>Getting Started</h1>
          <p>Bun is designed as a drop-in replacement for Node.js.</p>
          <h2>Installation</h2>
          <pre><code>curl -fsSL https://bun.sh/install | bash</code></pre>
          <p>Read more at <a href="https://bun.sh">Bun website</a>.</p>
          <ul>
            <li>Fast startup</li>
            <li>TypeScript support</li>
          </ul>
        </main>
        <footer>Copyright 2026 Oven</footer>
      </body>
      </html>
    `

    const { title, markdown } = transformHtmlToReadableMarkdown(rawHtml)
    expect(title).toBe('Bun Documentation')
    expect(markdown).not.toContain('font-family')
    expect(markdown).not.toContain('window.analytics')
    expect(markdown).not.toContain('Copyright 2026 Oven')

    expect(markdown).toContain('# Getting Started')
    expect(markdown).toContain('## Installation')
    expect(markdown).toContain('curl -fsSL https://bun.sh/install | bash')
    expect(markdown).toContain('[Bun website](https://bun.sh)')
    expect(markdown).toContain('- Fast startup')
    expect(markdown).toContain('- TypeScript support')
  })

  it('splits long markdown content into chunks at paragraph boundaries', () => {
    const para1 = 'First paragraph with some text explaining concepts.'
    const para2 = 'Second paragraph with more detailed explanations and examples.'
    const para3 = 'Third paragraph with concluding notes and links.'
    const fullText = `${para1}\n\n${para2}\n\n${para3}`

    const chunks = chunkText(fullText, 70)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.join('\n\n')).toContain(para1)
    expect(chunks.join('\n\n')).toContain(para2)
    expect(chunks.join('\n\n')).toContain(para3)
  })

  it('handles small text without chunking', () => {
    const shortText = 'A short text within chunk limits.'
    const chunks = chunkText(shortText, 1000)
    expect(chunks.length).toBe(1)
    expect(chunks[0]).toBe(shortText)
  })
})

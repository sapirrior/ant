import { describe, expect, it } from 'bun:test'
import { collapseInline, padEndVisible, padStartVisible, visibleWidth } from './format.ts'

describe('utils/format terminal layout and width utilities', () => {
  it('measures visibleWidth correctly for plain text, ANSI, CJK, and emoji', () => {
    expect(visibleWidth('hello')).toBe(5)
    expect(visibleWidth('')).toBe(0)

    // ANSI escape codes have 0 display width
    expect(visibleWidth('\x1b[31mhello\x1b[39m')).toBe(5)
    expect(visibleWidth('\x1b[38;2;255;100;50mbold red\x1b[0m')).toBe(8)

    // CJK wide characters count as 2 columns each
    expect(visibleWidth('你好')).toBe(4)
    expect(visibleWidth('世界 world')).toBe(10) // 4 + 1 + 5 = 10

    // Emoji column width
    expect(visibleWidth('🚀')).toBe(2)
  })

  it('pads end and start by visible width rather than raw string length', () => {
    const styled = '\x1b[32mok\x1b[39m' // visible width 2, raw length 11
    expect(padEndVisible(styled, 6)).toBe(`${styled}    `)
    expect(visibleWidth(padEndVisible(styled, 6))).toBe(6)

    expect(padStartVisible(styled, 6)).toBe(`    ${styled}`)
    expect(visibleWidth(padStartVisible(styled, 6))).toBe(6)

    // CJK padding
    const cjk = '你好' // visible width 4
    expect(padEndVisible(cjk, 6)).toBe('你好  ')
    expect(padStartVisible(cjk, 6)).toBe('  你好')

    // String already wider than or equal to targetWidth
    expect(padEndVisible('abcdef', 4)).toBe('abcdef')
    expect(padStartVisible('abcdef', 4)).toBe('abcdef')
  })

  it('collapses inline text: removes ANSI/control, collapses whitespace and newlines', () => {
    const raw = '  \x1b[31mHello\x1b[39m \n\t   world! \x1b[1mLine 2\x1b[22m   \r\n'
    expect(collapseInline(raw, 50)).toBe('Hello world! Line 2')
  })

  it('truncates on grapheme cluster boundaries with ellipsis', () => {
    const text = 'Hello, wonderful world of agents'
    const truncated = collapseInline(text, 15, '…')
    expect(visibleWidth(truncated)).toBeLessThanOrEqual(15)
    expect(truncated.endsWith('…')).toBe(true)

    // Grapheme cluster with multi-codepoint emoji (e.g. family or zwitter)
    const emojiText = 'Status: 👨‍👩‍👧‍👦 working hard'
    const truncatedEmoji = collapseInline(emojiText, 12, '…')
    expect(visibleWidth(truncatedEmoji)).toBeLessThanOrEqual(12)
    expect(truncatedEmoji.endsWith('…')).toBe(true)

    // When maxWidth is smaller than ellipsis width
    expect(collapseInline('Hello world', 0, '…')).toBe('')
    expect(collapseInline('Hello world', 1, '...')).toBe('H')
  })
})

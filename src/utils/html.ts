/**
 * Decodes HTML entities cleanly.
 * Decodes numeric entities first, then common named entities, and &amp; strictly last
 * so that entities like &amp;lt; are not doubly unescaped into <.
 */
export function decodeEntities(text: string): string {
  return text
    // 1. Numeric decimal entities: &#1234;
    .replace(/&#(\d+);/g, (match, code) => {
      try {
        const cp = Number.parseInt(code, 10)
        return String.fromCodePoint(cp)
      } catch {
        return match
      }
    })
    // 2. Numeric hex entities: &#x1a2b; or &#X1A2B;
    .replace(/&#x([0-9a-f]+);/gi, (match, hex) => {
      try {
        const cp = Number.parseInt(hex, 16)
        return String.fromCodePoint(cp)
      } catch {
        return match
      }
    })
    // 3. Common named entities
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/&mdash;/gi, '—')
    .replace(/&ndash;/gi, '–')
    .replace(/&hellip;/gi, '…')
    .replace(/&lsquo;/gi, '‘')
    .replace(/&rsquo;/gi, '’')
    .replace(/&ldquo;/gi, '“')
    .replace(/&rdquo;/gi, '”')
    .replace(/&laquo;/gi, '«')
    .replace(/&raquo;/gi, '»')
    // 4. Ampersand strictly last
    .replace(/&amp;/gi, '&')
}

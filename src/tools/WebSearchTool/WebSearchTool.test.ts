import { describe, expect, it } from 'bun:test'
import {
  decodeEntities,
  parseDuckDuckGoResults,
  resolveRedirectUrl,
} from './WebSearchTool.ts'

describe('WebSearchTool logic from example.ts', () => {
  it('decodes HTML entities and strips tags properly', () => {
    const raw = '&quot;Bun &amp; TypeScript&quot; &lt;runtime&gt; &#39;test&#39; &nbsp; &mdash; ok'
    const decoded = decodeEntities(raw)
    expect(decoded).toBe('"Bun & TypeScript" <runtime> \'test\' — ok')
  })

  it('un-redirects DuckDuckGo uddg URLs cleanly', () => {
    const ddgUrl = '//duckduckgo.com/l/?uddg=https%3A%2F%2Fbun.sh%2Fdocs&rut=123'
    const cleaned = resolveRedirectUrl(ddgUrl)
    expect(cleaned).toBe('https://bun.sh/docs')
  })

  it('parses DuckDuckGo standard HTML search result blocks into structured hits', () => {
    const sampleHtml = `
      <!DOCTYPE html>
      <html>
      <body>
        <div class="result results_links results_links_deep web-result">
          <div class="result__body links_main links_deep">
            <h2 class="result__title">
              <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fbun.sh&rut=abc">Bun - Fast all-in-one JavaScript runtime</a>
            </h2>
            <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fbun.sh&rut=abc">
              Develop, test, run, and bundle <b>JavaScript</b> &amp; TypeScript projects with Bun.
            </a>
          </div>
        </div>
        <div class="result results_links results_links_deep web-result">
          <div class="result__body links_main links_deep">
            <h2 class="result__title">
              <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fgithub.com%2Foven-sh%2Fbun&rut=def">GitHub - oven-sh/bun: Incredibly fast JavaScript runtime</a>
            </h2>
            <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fgithub.com%2Foven-sh%2Fbun&rut=def">
              Bun is an all-in-one JavaScript runtime &amp; toolkit designed for speed.
            </a>
          </div>
        </div>
      </body>
      </html>
    `

    const results = parseDuckDuckGoResults(sampleHtml, { query: 'bun' }, 5)
    expect(results.length).toBe(2)

    expect(results[0]?.title).toBe('Bun - Fast all-in-one JavaScript runtime')
    expect(results[0]?.url).toBe('https://bun.sh')
    expect(results[0]?.domain).toBe('bun.sh')
    expect(results[0]?.snippet).toBe('Develop, test, run, and bundle JavaScript & TypeScript projects with Bun.')

    expect(results[1]?.title).toContain('oven-sh/bun')
    expect(results[1]?.url).toBe('https://github.com/oven-sh/bun')
    expect(results[1]?.domain).toBe('github.com')
    expect(results[1]?.snippet).toBe('Bun is an all-in-one JavaScript runtime & toolkit designed for speed.')
  })

  it('filters by allowedDomains and blockedDomains', () => {
    const sampleHtml = `
      <div class="result results_links"><a class="result__a" href="https://github.com/foo">Github</a></div>
      <div class="result results_links"><a class="result__a" href="https://bun.sh/bar">Bun</a></div>
      <div class="result results_links"><a class="result__a" href="https://bad.com/baz">Bad</a></div>
    `
    const allowed = parseDuckDuckGoResults(sampleHtml, { query: 'test', allowedDomains: ['github.com'] }, 5)
    expect(allowed.length).toBe(1)
    expect(allowed[0]?.domain).toBe('github.com')

    const blocked = parseDuckDuckGoResults(sampleHtml, { query: 'test', blockedDomains: ['bad.com'] }, 5)
    expect(blocked.length).toBe(2)
    expect(blocked.some((h) => h.domain === 'bad.com')).toBe(false)
  })
})

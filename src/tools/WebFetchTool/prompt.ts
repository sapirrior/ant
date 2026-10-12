export const WEB_FETCH_TOOL_NAME = 'WebFetch'

export const WEB_FETCH_DESCRIPTION = `Fetch a web page via HTTP/HTTPS and transform its HTML content into clean, readable text/markdown chunks optimized for LLMs.
Strips boilerplate (scripts, styles, navigation, headers, footers, cookie banners) and extracts the main readable content.
- url: The full HTTP or HTTPS URL to fetch.
- maxChars: Maximum characters of text to return (default 25000, max 100000).`

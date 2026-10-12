export type ColorLevel = 0 | 1 | 2 | 3
export type ThemeMode = 'auto' | 'dark' | 'light' | 'ansi'

export interface ThemeColors {
  primary: [number, number, number]
  secondary: [number, number, number]
  accent: [number, number, number]
  success: [number, number, number]
  error: [number, number, number]
  warning: [number, number, number]
  info: [number, number, number]
  muted: [number, number, number]
  border: [number, number, number]
  text: [number, number, number] | null
}

export const DARK_THEME: ThemeColors = {
  primary: [0xfa, 0xb2, 0x83],   // #fab283
  secondary: [0x5c, 0x9c, 0xf5], // #5c9cf5
  accent: [0x9d, 0x7c, 0xd8],    // #9d7cd8
  error: [0xe0, 0x6c, 0x75],     // #e06c75
  warning: [0xf5, 0xa7, 0x42],   // #f5a742
  success: [0x7f, 0xd8, 0x8f],   // #7fd88f
  info: [0x56, 0xb6, 0xc2],      // #56b6c2
  muted: [0x80, 0x80, 0x80],     // #808080
  border: [0x55, 0x55, 0x55],
  text: null,
}

export const LIGHT_THEME: ThemeColors = {
  primary: [0x3b, 0x7d, 0xd8],   // #3b7dd8
  secondary: [0x7b, 0x5b, 0xb6], // #7b5bb6
  accent: [0xd6, 0x8c, 0x27],    // #d68c27
  error: [0xd1, 0x38, 0x3d],     // #d1383d
  warning: [0xd6, 0x8c, 0x27],   // #d68c27
  success: [0x3d, 0x9a, 0x57],   // #3d9a57
  info: [0x31, 0x87, 0x95],      // #318795
  muted: [0x8a, 0x8a, 0x8a],     // #8a8a8a
  border: [0xcc, 0xcc, 0xcc],
  text: null,
}

// 16-color table explicitly specified in Plan §10.2
export const ANSI_16_MAP: Record<keyof ThemeColors, number> = {
  primary: 33,   // yellow
  secondary: 94, // bright blue
  accent: 35,    // magenta
  error: 31,     // red
  warning: 93,   // bright yellow
  success: 32,   // green
  info: 36,      // cyan
  muted: 90,     // bright black
  border: 37,
  text: 39,      // default
}

export function detectColorLevel(
  env: NodeJS.ProcessEnv = process.env,
  isTTY: boolean = Boolean(process.stderr.isTTY)
): ColorLevel {
  const noColor = env.NO_COLOR
  if (noColor !== undefined && noColor !== '') return 0

  const forceColor = env.FORCE_COLOR
  if (forceColor === '0' || forceColor === 'false') return 0
  if (forceColor === '1') return 1
  if (forceColor === '2') return 2
  if (forceColor === '3') return 3

  if (!isTTY && forceColor === undefined) return 0
  if (env.TERM === 'dumb') return 0

  const colorTerm = env.COLORTERM
  if (colorTerm === 'truecolor' || colorTerm === '24bit') return 3

  const term = env.TERM || ''
  if (/256color/i.test(term)) return 2

  if (isTTY) return 1
  return 0
}

export function resolveTheme(
  themeSetting: ThemeMode = 'auto',
  env: NodeJS.ProcessEnv = process.env
): ThemeColors {
  if (themeSetting === 'light') return LIGHT_THEME
  if (themeSetting === 'dark') return DARK_THEME

  if (themeSetting === 'auto') {
    const fgbg = env.COLORFGBG
    if (fgbg) {
      const parts = fgbg.split(';')
      const bg = parts[parts.length - 1] ? Number.parseInt(parts[parts.length - 1]!, 10) : 0
      if (bg >= 7) return LIGHT_THEME
    }
  }

  return DARK_THEME
}

export function rgbToAnsi256(r: number, g: number, b: number): number {
  if (r === g && g === b) {
    if (r < 8) return 16
    if (r > 248) return 231
    return Math.round(((r - 8) / 247) * 23) + 232
  }
  const to6 = (v: number) => {
    if (v < 48) return 0
    if (v < 115) return 1
    return Math.min(5, Math.floor((v - 35) / 40))
  }
  return 16 + 36 * to6(r) + 6 * to6(g) + to6(b)
}

export function createColorFormatter(
  level: ColorLevel = detectColorLevel(),
  themeMode: ThemeMode = 'auto'
) {
  const isAnsiTheme = themeMode === 'ansi'
  const theme = resolveTheme(themeMode)

  function colorize(role: keyof ThemeColors, text: string): string {
    if (level === 0 || !text) return text

    if (level === 1 || isAnsiTheme) {
      const code = ANSI_16_MAP[role]
      return `\x1b[${code}m${text}\x1b[0m`
    }

    const rgb = theme[role]
    if (!rgb) {
      return text
    }

    if (level === 2) {
      const code256 = rgbToAnsi256(rgb[0], rgb[1], rgb[2])
      return `\x1b[38;5;${code256}m${text}\x1b[0m`
    }

    return `\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m${text}\x1b[0m`
  }

  return {
    level,
    primary: (text: string) => colorize('primary', text),
    secondary: (text: string) => colorize('secondary', text),
    accent: (text: string) => colorize('accent', text),
    success: (text: string) => colorize('success', text),
    error: (text: string) => colorize('error', text),
    warning: (text: string) => colorize('warning', text),
    info: (text: string) => colorize('info', text),
    muted: (text: string) => colorize('muted', text),
    border: (text: string) => colorize('border', text),
    text: (t: string) => t,
    bold: (text: string) => (level > 0 ? `\x1b[1m${text}\x1b[0m` : text),
    dim: (text: string) => (level > 0 ? `\x1b[2m${text}\x1b[0m` : text),
    italic: (text: string) => (level > 0 ? `\x1b[3m${text}\x1b[0m` : text),
    underline: (text: string) => (level > 0 ? `\x1b[4m${text}\x1b[0m` : text),
  }
}

export function detectUnicodeSupported(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.TERM === 'linux' || env.TERM === 'dumb') return false
  const lang = `${env.LC_ALL || ''} ${env.LC_CTYPE || ''} ${env.LANG || ''}`
  return /utf-?8/i.test(lang)
}

export interface TerminalSymbols {
  brand: string
  tool: string
  result: string
  ok: string
  fail: string
  prompt: string
  bgTask: string
}

export function getSymbols(unicode: boolean = detectUnicodeSupported()): TerminalSymbols {
  if (unicode) {
    return {
      brand: '◆',
      tool: '●',
      result: '⎿',
      ok: '✓',
      fail: '✗',
      prompt: '?',
      bgTask: '↗',
    }
  }
  return {
    brand: '*',
    tool: '*',
    result: '|_',
    ok: 'ok',
    fail: 'x',
    prompt: '?',
    bgTask: '>',
  }
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  const m = Math.floor(s / 60)
  const remSec = (s % 60).toFixed(0)
  return `${m}m ${remSec}s`
}

export function formatTokens(n: number): string {
  if (n < 1000) return `${n}`
  return `${(n / 1000).toFixed(1)}k`
}

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
  primary: [215, 119, 87],       // Warm brand orange #d77757
  secondary: [177, 185, 249],     // Light blue-purple #b1b9f9
  accent: [175, 135, 255],       // Electric violet #af87ff
  error: [255, 107, 128],        // Bright red #ff6b80
  warning: [255, 193, 7],        // Bright amber #ffc107
  success: [78, 186, 101],       // Bright green #4eba65
  info: [147, 165, 255],         // Medium blue
  muted: [153, 153, 153],        // Inactive / muted gray
  border: [80, 80, 80],          // Subtle border
  text: [255, 255, 255],
}

export const LIGHT_THEME: ThemeColors = {
  primary: [215, 119, 87],       // Warm brand orange #d77757
  secondary: [87, 105, 247],     // Medium blue
  accent: [135, 0, 255],         // Electric violet
  error: [171, 43, 63],          // Red
  warning: [150, 108, 30],       // Amber
  success: [44, 122, 57],        // Green
  info: [87, 105, 247],          // Blue
  muted: [102, 102, 102],        // Inactive gray
  border: [175, 175, 175],       // Subtle gray
  text: [0, 0, 0],
}

// Standard 16-color ANSI mapping
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
      if (bg === 7 || bg === 15) return LIGHT_THEME
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

export { formatDuration, formatTokens } from '../utils/format.ts'


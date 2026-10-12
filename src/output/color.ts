export type ColorLevel = 0 | 1 | 2 | 3

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
  primary: [215, 119, 87],
  secondary: [177, 185, 249],
  accent: [175, 135, 255],
  success: [78, 186, 101],
  error: [255, 107, 128],
  warning: [255, 193, 7],
  info: [72, 150, 140],
  muted: [153, 153, 153],
  border: [136, 136, 136],
  text: null,
}

export const ANSI_16_MAP: Record<keyof ThemeColors, number> = {
  primary: 91,
  secondary: 94,
  accent: 95,
  success: 92,
  error: 91,
  warning: 93,
  info: 96,
  muted: 90,
  border: 37,
  text: 39,
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
  theme: ThemeColors = DARK_THEME
) {
  function colorize(role: keyof ThemeColors, text: string): string {
    if (level === 0 || !text) return text

    if (level === 1) {
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
  return `${(ms / 1000).toFixed(1)}s`
}

export function formatTokens(count?: number): string {
  if (count === undefined) return '0'
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`
  return String(count)
}

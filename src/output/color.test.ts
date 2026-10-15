import { describe, expect, it } from 'bun:test'
import {
  createColorFormatter,
  detectColorLevel,
  detectUnicodeSupported,
  getSymbols,
  rgbToAnsi256,
} from './color.ts'

describe('output/color terminal UX formatting and theme levels', () => {
  it('detects color level 0 when NO_COLOR is set', () => {
    expect(detectColorLevel({ NO_COLOR: '1' }, true)).toBe(0)
    expect(detectColorLevel({ NO_COLOR: 'true' }, true)).toBe(0)
  })

  it('detects color levels from FORCE_COLOR overrides', () => {
    expect(detectColorLevel({ FORCE_COLOR: '0' }, true)).toBe(0)
    expect(detectColorLevel({ FORCE_COLOR: '1' }, false)).toBe(1)
    expect(detectColorLevel({ FORCE_COLOR: '2' }, false)).toBe(2)
    expect(detectColorLevel({ FORCE_COLOR: '3' }, false)).toBe(3)
  })

  it('detects truecolor level 3 when COLORTERM is set', () => {
    expect(detectColorLevel({ COLORTERM: 'truecolor' }, true)).toBe(3)
    expect(detectColorLevel({ COLORTERM: '24bit' }, true)).toBe(3)
  })

  it('detects 256color level 2 when TERM matches 256color', () => {
    expect(detectColorLevel({ TERM: 'xterm-256color' }, true)).toBe(2)
  })

  it('returns level 0 without any escape codes on level 0 formatter', () => {
    const fmt = createColorFormatter(0)
    expect(fmt.primary('text')).toBe('text')
    expect(fmt.bold('text')).toBe('text')
    expect(fmt.error('error')).toBe('error')
    expect(fmt.primary('text')).not.toContain('\x1b')
  })

  it('maps RGB to ANSI 256 ramp cleanly', () => {
    expect(rgbToAnsi256(0, 0, 0)).toBe(16)
    expect(rgbToAnsi256(255, 255, 255)).toBe(231)
    expect(rgbToAnsi256(128, 128, 128)).toBeGreaterThan(16)
  })

  it('switches between Unicode and ASCII symbols based on environment', () => {
    const unicodeSyms = getSymbols(true)
    expect(unicodeSyms.brand).toBe('◆')
    expect(unicodeSyms.tool).toBe('●')
    expect(unicodeSyms.result).toBe('⎿')
    expect(unicodeSyms.ok).toBe('✓')
    expect(unicodeSyms.fail).toBe('✗')

    const asciiSyms = getSymbols(false)
    expect(asciiSyms.brand).toBe('*')
    expect(asciiSyms.tool).toBe('*')
    expect(asciiSyms.result).toBe('|_')
    expect(asciiSyms.ok).toBe('ok')
    expect(asciiSyms.fail).toBe('x')

    expect(detectUnicodeSupported({ TERM: 'dumb' })).toBe(false)
    expect(detectUnicodeSupported({ TERM: 'linux' })).toBe(false)
    expect(detectUnicodeSupported({ LANG: 'en_US.UTF-8' })).toBe(true)
  })

  it('includes structural symbols with unicode and ascii fallbacks', () => {
    const unicodeSyms = getSymbols(true)
    expect(unicodeSyms.rail).toBe('│')
    expect(unicodeSyms.rule).toBe('─')
    expect(unicodeSyms.bullet).toBe('•')
    expect(unicodeSyms.ellipsis).toBe('…')

    const asciiSyms = getSymbols(false)
    expect(asciiSyms.rail).toBe('|')
    expect(asciiSyms.rule).toBe('-')
    expect(asciiSyms.bullet).toBe('-')
    expect(asciiSyms.ellipsis).toBe('...')
  })

  it('uses targeted SGR closes and restores parent styling when nested', () => {
    const fmt = createColorFormatter(1, 'ansi')

    // Bold closes with 22m, italic with 23m
    expect(fmt.bold('hello')).toBe('\x1b[1mhello\x1b[22m')
    expect(fmt.italic('hello')).toBe('\x1b[3mhello\x1b[23m')
    expect(fmt.dim('hello')).toBe('\x1b[2mhello\x1b[22m')
    expect(fmt.underline('hello')).toBe('\x1b[4mhello\x1b[24m')

    // Foreground closes with 39m
    expect(fmt.primary('hello')).toBe('\x1b[33mhello\x1b[39m')

    // Italic around bold: nested bold closing with 22m leaves italic active
    const italicBold = fmt.italic(`a ${fmt.bold('b')} c`)
    expect(italicBold).toBe('\x1b[3ma \x1b[1mb\x1b[22m c\x1b[23m')

    // Bold around foreground: foreground closing with 39m does not clear bold
    const boldPrimary = fmt.bold(`a ${fmt.primary('b')} c`)
    expect(boldPrimary).toBe('\x1b[1ma \x1b[33mb\x1b[39m c\x1b[22m')

    // Foreground around another foreground: outer foreground is restored after inner closes
    const nestedFg = fmt.primary(`a ${fmt.error('b')} c`)
    // primary is 33m, error is 31m. When 31m closes with 39m, outer 33m is restored: \x1b[39m\x1b[33m
    expect(nestedFg).toBe('\x1b[33ma \x1b[31mb\x1b[39m\x1b[33m c\x1b[39m')
  })
})

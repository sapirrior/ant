import { createColorFormatter, detectColorLevel, getSymbols, type ThemeMode } from './color.ts'

const BRAND = '' // set to 'ant: ' to re-introduce a prefix everywhere
let theme: ThemeMode = 'auto'

export const setNoticeTheme = (t: ThemeMode) => {
  theme = t
}

const errFmt = () =>
  createColorFormatter(detectColorLevel(process.env, Boolean(process.stderr.isTTY)), theme)

export const notice = {
  error: (msg: string) => process.stderr.write(`${BRAND}${errFmt().error('error:')} ${msg}\n`),
  warning: (msg: string) =>
    process.stderr.write(`${BRAND}${errFmt().warning('warning:')} ${msg}\n`),
  info: (msg: string) => process.stderr.write(`${BRAND}${msg}\n`),
  done: (msg: string) => {
    const f = createColorFormatter(
      detectColorLevel(process.env, Boolean(process.stdout.isTTY)),
      theme,
    )
    process.stdout.write(`${f.success(getSymbols().ok)} ${msg}\n`)
  },
}

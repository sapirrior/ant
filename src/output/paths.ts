import { homedir } from 'node:os'
import { isAbsolute, relative, sep } from 'node:path'

export function displayPath(p: string, opts: { home?: string; cwd?: string } = {}): string {
  const home = (opts.home ?? homedir()).replace(/[\\/]+$/, '')
  if (opts.cwd) {
    const rel = relative(opts.cwd, p)
    if (rel && !rel.startsWith('..') && !isAbsolute(rel)) {
      return rel.split(sep).join('/')
    }
  }
  if (!home || !p) return p
  const norm = (s: string) => (process.platform === 'win32' ? s.toLowerCase() : s)
  if (norm(p) === norm(home)) return '~'
  if (norm(p).startsWith(norm(home) + sep) || norm(p).startsWith(norm(home) + '/')) {
    return '~' + p.slice(home.length).replace(/\\/g, '/')
  }
  return p
}

/** For free-text messages that embed paths (error strings). */
export function tildifyText(s: string, home = homedir()): string {
  const h = home.replace(/[\\/]+$/, '')
  if (!h) return s
  const esc = h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regex = new RegExp(esc, 'g')
  return s.replace(regex, '~')
}

import { isAbsolute, normalize, relative, resolve } from 'node:path'

export type BashVerdict =
  | { status: 'safe' }
  | { status: 'ask'; reason: string }
  | { status: 'blocked'; reason: string }

const SENSITIVE_FILE_NAMES = new Set([
  '.env',
  '.env.local',
  '.env.production',
  '.env.development',
  'id_rsa',
  'id_ed25519',
  'id_ecdsa',
  'id_dsa',
  '.git-credentials',
  '.netrc',
  '.npmrc',
])

const PLAIN_SAFE_COMMANDS = new Set([
  'pwd',
  'ls',
  'cat',
  'head',
  'tail',
  'wc',
  'echo',
  'printf',
  'date',
  'whoami',
  'uname',
  'id',
  'which',
  'type',
  'file',
  'stat',
  'du',
  'df',
  'tree',
  'basename',
  'dirname',
  'realpath',
  'readlink',
  'diff',
  'cmp',
  'grep',
  'rg',
  'jq',
  'sort',
  'cut',
  'tr',
  'true',
  'false',
  'sleep',
  'seq',
  'cd',
  'test',
  '[',
  'git',
  'find',
])

const VERSION_ONLY_COMMANDS = new Set([
  'node',
  'bun',
  'npm',
  'pnpm',
  'yarn',
  'python3',
  'git',
  'tsc',
  'go',
  'cargo',
  'rustc',
])

const BLOCKED_COMMANDS = new Set([
  'sudo',
  'su',
  'doas',
  'pkexec',
  'shutdown',
  'reboot',
  'halt',
  'poweroff',
  'init',
  'telinit',
])

const INTERPRETERS = new Set([
  'sh',
  'bash',
  'zsh',
  'fish',
  'dash',
  'ksh',
  'python',
  'python2',
  'python3',
  'node',
  'bun',
  'deno',
  'perl',
  'ruby',
  'osascript',
])

const HINTS: Record<string, string> = {
  rm: 'deletes files',
  rmdir: 'deletes directories',
  mv: 'moves or overwrites files',
  cp: 'copies or overwrites files',
  touch: 'creates or updates files',
  mkdir: 'creates directories',
  chmod: 'modifies file permissions',
  chown: 'modifies file ownership',
  kill: 'terminates processes',
  pkill: 'terminates processes',
  killall: 'terminates processes',
  curl: 'network access',
  wget: 'network access',
  npm: 'package manager execution',
  pnpm: 'package manager execution',
  yarn: 'package manager execution',
  bun: 'package manager / runtime execution',
  pip: 'package manager execution',
  pip3: 'package manager execution',
  docker: 'container operations',
  podman: 'container operations',
}

// Tokenize a command line while respecting quotes and escapes
export function tokenizeCommandLine(cmd: string): { tokens: string[]; unterminated: boolean } {
  const tokens: string[] = []
  let current = ''
  let inSingle = false
  let inDouble = false
  let escaped = false

  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i]!

    if (escaped) {
      current += ch
      escaped = false
      continue
    }

    if (ch === '\\' && !inSingle) {
      escaped = true
      continue
    }

    if (ch === "'" && !inDouble) {
      inSingle = !inSingle
      continue
    }

    if (ch === '"' && !inSingle) {
      inDouble = !inDouble
      continue
    }

    if (!inSingle && !inDouble && /\s/.test(ch)) {
      if (current.length > 0) {
        tokens.push(current)
        current = ''
      }
      continue
    }

    current += ch
  }

  if (inSingle || inDouble || escaped) {
    return { tokens: [], unterminated: true }
  }

  if (current.length > 0) {
    tokens.push(current)
  }

  return { tokens, unterminated: false }
}

// Split command string into chained statements / pipelines
function splitStatements(cmd: string): { statements: string[]; unterminated: boolean } {
  const statements: string[] = []
  let current = ''
  let inSingle = false
  let inDouble = false
  let escaped = false

  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i]!

    if (escaped) {
      current += ch
      escaped = false
      continue
    }

    if (ch === '\\' && !inSingle) {
      escaped = true
      current += ch
      continue
    }

    if (ch === "'" && !inDouble) {
      inSingle = !inSingle
      current += ch
      continue
    }

    if (ch === '"' && !inSingle) {
      inDouble = !inDouble
      current += ch
      continue
    }

    if (!inSingle && !inDouble) {
      // Split on ; or \n
      if (ch === ';' || ch === '\n') {
        if (current.trim().length > 0) statements.push(current.trim())
        current = ''
        continue
      }
      // Split on && or ||
      if ((ch === '&' && cmd[i + 1] === '&') || (ch === '|' && cmd[i + 1] === '|')) {
        if (current.trim().length > 0) statements.push(current.trim())
        current = ''
        i++
        continue
      }
      // Background &
      if (ch === '&') {
        if (current.trim().length > 0) statements.push(current.trim())
        current = ''
        continue
      }
    }

    current += ch
  }

  if (inSingle || inDouble || escaped) {
    return { statements: [], unterminated: true }
  }

  if (current.trim().length > 0) {
    statements.push(current.trim())
  }

  return { statements, unterminated: false }
}

function normalizeProgram(raw: string): { name: string; isExplicitPath: boolean } {
  if (!raw.includes('/')) {
    return { name: raw, isExplicitPath: false }
  }

  // Allowed system prefix paths that normalize to their basename
  const allowedPrefixes = ['/bin/', '/usr/bin/', '/usr/local/bin/', '/opt/homebrew/bin/']
  for (const p of allowedPrefixes) {
    if (raw.startsWith(p)) {
      return { name: raw.slice(p.length), isExplicitPath: false }
    }
  }

  return { name: raw, isExplicitPath: true }
}

function checkPathArgument(arg: string, cwd: string): { ok: boolean; reason?: string } {
  if (arg === '/dev/null') return { ok: true }

  const base = arg.split('/').pop() || ''
  if (SENSITIVE_FILE_NAMES.has(base)) {
    return { ok: false, reason: `reads sensitive file "${base}"` }
  }

  if (arg.startsWith('~') || arg.startsWith('$') || isAbsolute(arg) || arg.includes('..')) {
    let resolved: string
    if (arg.startsWith('~')) {
      return { ok: false, reason: 'path outside workspace (home directory reference)' }
    }
    if (arg.startsWith('$')) {
      return { ok: false, reason: 'path with environment variable' }
    }
    resolved = resolve(cwd, arg)
    const rel = relative(cwd, resolved)
    if (rel.startsWith('..') || isAbsolute(rel)) {
      return { ok: false, reason: 'path outside workspace' }
    }
  }

  return { ok: true }
}

function classifyPipelineSegment(segment: string, cwd: string): BashVerdict {
  const trimmed = segment.trim()
  if (!trimmed) return { status: 'safe' }

  // Check fork-bomb shape
  if (/:?\(\)\s*\{/.test(trimmed)) {
    return { status: 'blocked', reason: 'fork-bomb pattern' }
  }

  // Check subshell substitutions
  if (/\$\(/.test(trimmed) || /`[^`]+`/.test(trimmed)) {
    return { status: 'ask', reason: 'contains command substitution' }
  }

  // Check output redirection
  if (/>\s*\/dev\/(?!null\b)/.test(trimmed)) {
    return { status: 'blocked', reason: 'device write redirection' }
  }

  const cleanRedirect = trimmed
    .replace(/>\s*\/dev\/null/g, '')
    .replace(/2>\s*\/dev\/null/g, '')
    .replace(/2>&1/g, '')
    .replace(/1>&2/g, '')

  if (/>>|(?<![12])>|>[|]|&>/.test(cleanRedirect)) {
    return { status: 'ask', reason: 'file output redirection' }
  }

  const { tokens, unterminated } = tokenizeCommandLine(trimmed)
  if (unterminated) {
    return { status: 'ask', reason: 'unterminated quote' }
  }

  if (tokens.length === 0) {
    return { status: 'safe' }
  }

  // Strip leading env var assignments e.g. FOO=1 BAR=2
  let idx = 0
  while (idx < tokens.length && /^[a-zA-Z_][a-zA-Z0-9_]*=/.test(tokens[idx]!)) {
    idx++
  }

  if (idx >= tokens.length) {
    return { status: 'safe' }
  }

  // Check if env var assignments were present
  if (idx > 0) {
    return { status: 'ask', reason: 'environment variable assignment before command' }
  }

  const rawProgram = tokens[idx]!
  const args = tokens.slice(idx + 1)

  // Blocked commands
  if (BLOCKED_COMMANDS.has(rawProgram)) {
    return { status: 'blocked', reason: `disallowed command "${rawProgram}"` }
  }

  if (rawProgram.startsWith('mkfs')) {
    return { status: 'blocked', reason: `filesystem creation command "${rawProgram}"` }
  }

  if (rawProgram === 'dd') {
    for (const a of args) {
      if (a.startsWith('of=/dev/') && a !== 'of=/dev/null') {
        return { status: 'blocked', reason: 'raw device overwrite via dd' }
      }
    }
  }

  if (rawProgram === 'rm') {
    const isRecursive = args.some((a) => a === '-r' || a === '-R' || a === '--recursive' || /^-[a-zA-Z]*r/i.test(a))
    if (isRecursive) {
      for (const a of args) {
        if (a === '/' || a === '~' || a === '$HOME' || a === '/*') {
          return { status: 'blocked', reason: 'recursive deletion of system root or root path' }
        }
        if (a.startsWith('/')) {
          const norm = normalize(a)
          if (norm === '/' || norm === '/root' || norm === '/home' || norm === '/etc') {
            return { status: 'blocked', reason: 'recursive deletion of system root or root path' }
          }
        }
      }
    }
  }

  if (rawProgram === 'chmod' || rawProgram === 'chown') {
    const isRecursive = args.some((a) => a === '-R' || a === '--recursive')
    if (isRecursive && args.some((a) => a === '/' || a === '~' || a === '$HOME')) {
      return { status: 'blocked', reason: 'recursive permission change on root or home' }
    }
  }

  const { name: program, isExplicitPath } = normalizeProgram(rawProgram)
  if (isExplicitPath) {
    return { status: 'ask', reason: `explicit non-standard path "${rawProgram}"` }
  }

  // Single --version check
  if (VERSION_ONLY_COMMANDS.has(program)) {
    if (args.length === 1 && (args[0] === '--version' || args[0] === '-v' || args[0] === '-V' || (program === 'go' && args[0] === 'version'))) {
      return { status: 'safe' }
    }
  }

  // Plain safe check
  if (PLAIN_SAFE_COMMANDS.has(program)) {
    // Check command-specific guards
    if (program === 'find') {
      const dangerousFindOpts = ['-delete', '-exec', '-execdir', '-ok', '-okdir', '-fprint', '-fprint0', '-fprintf', '-fls']
      if (args.some((a) => dangerousFindOpts.includes(a))) {
        return { status: 'ask', reason: 'find execution or deletion option' }
      }
    } else if (program === 'sort') {
      if (args.some((a) => a === '-o' || a.startsWith('--output') || a.startsWith('--compress-program'))) {
        return { status: 'ask', reason: 'sort output option' }
      }
    } else if (program === 'rg') {
      if (args.some((a) => a === '--pre' || a === '--hostname-bin' || a === '--search-zip' || a === '-z')) {
        return { status: 'ask', reason: 'ripgrep external execution option' }
      }
    } else if (program === 'tree') {
      if (args.some((a) => a === '-o')) {
        return { status: 'ask', reason: 'tree output option' }
      }
    } else if (program === 'date') {
      if (args.some((a) => a === '-s' || a.startsWith('--set'))) {
        return { status: 'ask', reason: 'date modification option' }
      }
    } else if (program === 'file') {
      if (args.some((a) => a === '-C' || a.startsWith('--compile'))) {
        return { status: 'ask', reason: 'file compilation option' }
      }
    } else if (program === 'git') {
      const gitSub = args[0]
      if (!gitSub) {
        return { status: 'safe' }
      }
      // Check for global options before subcommand
      if (gitSub.startsWith('-')) {
        return { status: 'ask', reason: 'git global option' }
      }
      const readOnlySubs = new Set([
        'status',
        'diff',
        'log',
        'show',
        'blame',
        'rev-parse',
        'ls-files',
        'ls-tree',
        'describe',
        'shortlog',
        'grep',
        'cat-file',
      ])
      if (readOnlySubs.has(gitSub)) {
        // Disallow dangerous pager/output flags
        const forbiddenGitFlags = ['--output', '--ext-diff', '--textconv', '-O', '--open-files-in-pager']
        if (args.some((a) => forbiddenGitFlags.some((f) => a.startsWith(f)))) {
          return { status: 'ask', reason: 'git custom output/pager flag' }
        }
      } else if (gitSub === 'branch' || gitSub === 'tag' || gitSub === 'remote' || gitSub === 'stash') {
        const subArgs = args.slice(1)
        if (gitSub === 'stash') {
          if (subArgs[0] !== 'list') return { status: 'ask', reason: 'git stash mutation' }
        } else if (gitSub === 'branch') {
          const allowedBranchFlags = new Set(['-a', '-r', '-v', '-vv', '--list', '--show-current'])
          if (subArgs.some((a) => !allowedBranchFlags.has(a))) {
            return { status: 'ask', reason: 'git branch modification' }
          }
        } else if (gitSub === 'tag') {
          if (!subArgs.every((a) => a === '-l' || a === '--list')) {
            return { status: 'ask', reason: 'git tag modification' }
          }
        } else if (gitSub === 'remote') {
          if (!subArgs.every((a) => a === '-v')) {
            return { status: 'ask', reason: 'git remote modification' }
          }
        }
      } else {
        return { status: 'ask', reason: `git mutating subcommand "${gitSub}"` }
      }
    }

    // Path argument checks for programs that take paths
    const noPathArgChecks = new Set(['echo', 'printf', 'true', 'false', 'sleep', 'seq', 'date', 'whoami', 'uname', 'id', 'pwd'])
    if (!noPathArgChecks.has(program)) {
      for (const a of args) {
        if (!a.startsWith('-')) {
          const pathRes = checkPathArgument(a, cwd)
          if (!pathRes.ok) {
            return { status: 'ask', reason: pathRes.reason || 'path outside workspace' }
          }
        }
      }
    }

    return { status: 'safe' }
  }

  // Not on safe list
  const hint = HINTS[program] || 'not on the read-only list'
  return { status: 'ask', reason: hint }
}

export function classifyBashCommand(command: string, cwd: string): BashVerdict {
  const trimmed = command.trim()
  if (!trimmed) {
    return { status: 'safe' }
  }

  // Check pipeline segments with download piped to interpreter
  // e.g. curl ... | sh
  const pipeParts = trimmed.split('|')
  if (pipeParts.length > 1) {
    for (let i = 0; i < pipeParts.length - 1; i++) {
      const leftPart = pipeParts[i]!.trim()
      const rightPart = pipeParts[i + 1]!.trim()
      const leftFirst = leftPart.split(/\s+/)[0] || ''
      const rightFirst = rightPart.split(/\s+/)[0] || ''
      if ((leftFirst === 'curl' || leftFirst === 'wget') && INTERPRETERS.has(rightFirst)) {
        return { status: 'blocked', reason: 'piping download into interpreter/shell' }
      }
    }
  }

  const { statements, unterminated } = splitStatements(trimmed)
  if (unterminated) {
    return { status: 'ask', reason: 'unterminated quote' }
  }

  let finalVerdict: BashVerdict = { status: 'safe' }

  for (const stmt of statements) {
    // Check if statement contains pipes
    const segments = stmt.split('|')
    for (const seg of segments) {
      const v = classifyPipelineSegment(seg, cwd)
      if (v.status === 'blocked') {
        return v
      }
      if (v.status === 'ask' && finalVerdict.status !== 'ask') {
        finalVerdict = v
      }
    }
  }

  return finalVerdict
}

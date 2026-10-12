export type OutputFormat = 'text' | 'md' | 'json'

export type LogLevel = 'error' | 'info' | 'debug'

export type Capability =
  | 'fs.read'
  | 'fs.write'
  | 'shell.run'
  | 'shell.destructive'

export interface Grants {
  readonly has: (cap: Capability) => boolean
  readonly capabilities: ReadonlySet<Capability>
}

export interface Config {
  readonly prompt?: string
  readonly stdinInput?: string
  readonly model: string
  readonly maxSteps: number
  readonly timeoutMs: number
  readonly outputFormat: OutputFormat
  readonly logLevel: LogLevel
  readonly grants: Grants
  readonly cwd: string
  readonly continueLatest: boolean
  readonly resumeThreadId?: string
}

import type { ExitCode, Status } from './types.ts'

export type ErrorCode =
  | 'usage_error'
  | 'thread_locked'
  | 'thread_not_found'
  | 'store_error'
  | 'config_error'
  | 'model_error'
  | 'internal_error'

export class AntError extends Error {
  readonly code: ErrorCode
  readonly status: Status
  readonly exitCode: ExitCode

  constructor(message: string, code: ErrorCode, status: Status, exitCode: ExitCode) {
    super(message)
    this.name = 'AntError'
    this.code = code
    this.status = status
    this.exitCode = exitCode
  }
}

export class UsageError extends AntError {
  constructor(message: string, code: ErrorCode = 'usage_error') {
    super(message, code, 'usage_error', 2)
    this.name = 'UsageError'
  }
}

export class ThreadLockedError extends AntError {
  constructor(message: string) {
    super(message, 'thread_locked', 'usage_error', 2)
    this.name = 'ThreadLockedError'
  }
}

export class ThreadNotFoundError extends AntError {
  constructor(message: string) {
    super(message, 'thread_not_found', 'usage_error', 2)
    this.name = 'ThreadNotFoundError'
  }
}

export class StoreError extends AntError {
  constructor(message: string) {
    super(message, 'store_error', 'internal_error', 5)
    this.name = 'StoreError'
  }
}

export class ConfigError extends AntError {
  constructor(message: string) {
    super(message, 'config_error', 'usage_error', 2)
    this.name = 'ConfigError'
  }
}

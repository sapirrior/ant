import { realpathSync, readFileSync, existsSync } from 'node:fs'
import { Command } from 'commander'
import { readPipedStdin } from '../core/input.ts'
import {
  parseToolRule,
  resolveEffectivePermissions,
  type PermissionMode,
  type ParsedToolRule,
  KNOWN_TOOLS,
} from '../policy/toolPermissions.ts'
import { Engine } from '../core/engine.ts'
import { validateModelConfig } from '../core/model.ts'
import { loadSettings, parseDurationMs, parseReasoning } from '../settings/index.ts'
import { parseIntStrict } from '../utils/number.ts'
import { notice } from '../output/notice.ts'
import type { Config, LogLevel, OutputFormat, Theme, ToolName } from '../core/types.ts'
import { PERMISSION_MODES } from '../constants/index.ts'

const collectRules = (v: string, prev: string[]) => [
  ...prev,
  ...v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
]

export function resolveOutputFormat(
  flagOutput?: string,
  envOutput?: string,
  settingsOutput?: string,
): OutputFormat {
  const chosen = flagOutput ?? envOutput ?? settingsOutput
  if (chosen) {
    if (chosen !== 'text' && chosen !== 'json' && chosen !== 'stream-json') {
      throw new Error(`Invalid output format: "${chosen}". Allowed: text, json, stream-json`)
    }
    return chosen as OutputFormat
  }
  return 'text'
}

export function registerRunCommand(program: Command): void {
  program
    .argument('[prompt]', 'Instruction prompt for the agent')
    .option('-p, --print', 'Run non-interactively in print mode')
    .option(
      '--tools <names>',
      'Filter tools exposed to the model (e.g. "default" or "ReadFile,EditFile")',
    )
    .option(
      '--allowed-tools <rule>',
      'Rule approving tool execution (e.g. "Bash", "Bash(git diff *)")',
      collectRules,
      [],
    )
    .option(
      '--disallowed-tools <rule>',
      'Rule denying tool execution (e.g. "Bash(rm *)", "WriteFile")',
      collectRules,
      [],
    )
    .option(
      '--permission-mode <mode>',
      'Permission mode: default | plan | acceptEdits | bypassPermissions',
    )
    .option('--dangerously-skip-permissions', 'Bypass all tool execution permission checks')
    .option('--bare', 'Suppress ambient ~/.ant/settings.json and project MCP discovery')
    .option(
      '--no-session-persistence',
      'Disable session transcripts, message storage, and checkpoints',
    )
    .option('-m, --model <provider/model-id>', 'Model to use (format: provider/model-id)')
    .option('-s, --max-turns <number>', 'Maximum agent interaction turns')
    .option('-t, --timeout <duration>', 'Wall-clock timeout e.g. "30m", "10s"')
    .option('--retries <number>', 'Number of API request retries (0-10)')
    .option('-o, --output-format <format>', 'Output format: text | json | stream-json')
    .option('-l, --log-level <level>', 'Log level: error | info | debug')
    .option('--verbose', 'Emit rich diagnostic progress to stderr')
    .option('--theme <theme>', 'Theme: auto | dark | light | ansi')
    .option(
      '-e, --effort <level>',
      'Reasoning effort: none | minimal | low | medium | high | xhigh | max',
    )
    .option(
      '--append-system-prompt <text>',
      'Append custom instructions after the base system prompt',
    )
    .option('--append-system-prompt-file <path>', 'Append instructions read from a file')
    .option('-c, --continue', 'Continue the latest conversation thread')
    .option('-r, --resume <thread_id>', 'Resume a specific conversation thread by ID')
    .action(async (positionalPrompt: string | undefined, options) => {
      try {
        const rawArgs = process.argv.slice(2)
        for (const arg of rawArgs) {
          const flagName = arg.split('=')[0]
          if (
            flagName &&
            [
              '--max-budget-usd',
              '--input-format',
              '--permission-prompt-tool',
              '--permission-prompts',
            ].includes(flagName)
          ) {
            throw new Error(
              `Unsupported option: "${flagName}". This feature is not supported in ant.`,
            )
          }
        }

        if (options.continue && options.resume) {
          throw new Error('Cannot specify both --continue and --resume')
        }

        if (
          positionalPrompt === undefined &&
          !options.continue &&
          !options.resume &&
          process.stdin.isTTY
        ) {
          program.help()
          return
        }

        if (positionalPrompt !== undefined && positionalPrompt.trim() === '') {
          throw new Error('Instruction prompt cannot be empty or whitespace only.')
        }

        const isBare = Boolean(options.bare)
        const userSettings = isBare ? {} : loadSettings()
        const env = process.env
        const prompt = positionalPrompt?.trim() ? positionalPrompt : undefined

        // 1. Resolve model: CLI flag > env > settings.json (no hardcoded default)
        const rawModel = options.model ?? env.ANT_MODEL ?? userSettings.model
        if (!rawModel) {
          throw new Error(
            'No model configured. Specify --model <provider/model-id>, set ANT_MODEL, or run "ant config set model <provider/model-id>".',
          )
        }
        validateModelConfig(rawModel, env)
        const model = rawModel

        // 2. Resolve maxTurns: CLI > env > settings > 30
        let maxTurns = 30
        const rawTurns = options.maxTurns ?? env.ANT_MAX_TURNS ?? env.ANT_MAX_STEPS
        if (rawTurns !== undefined) {
          maxTurns = parseIntStrict('--max-turns', rawTurns, { min: 1 })
        } else if (userSettings.maxTurns !== undefined && userSettings.maxTurns > 0) {
          maxTurns = userSettings.maxTurns
        } else if (userSettings.maxSteps !== undefined && userSettings.maxSteps > 0) {
          maxTurns = userSettings.maxSteps
        }

        // 3. Resolve timeout: CLI > env > settings > 30m
        const rawTimeout = options.timeout ?? env.ANT_TIMEOUT ?? userSettings.timeout ?? '30m'
        const timeoutMs = parseDurationMs(rawTimeout)

        // 4. Resolve retries: CLI > env > settings > 4
        let retries = 4
        if (options.retries !== undefined) {
          retries = parseIntStrict('--retries', options.retries, { min: 0, max: 10 })
        } else if (env.ANT_RETRIES) {
          retries = parseIntStrict('ANT_RETRIES', env.ANT_RETRIES, { min: 0, max: 10 })
        } else if (userSettings.retries !== undefined) {
          retries = userSettings.retries
        }

        // 5. Resolve output format
        const outputFormat = resolveOutputFormat(
          options.outputFormat,
          env.ANT_OUTPUT_FORMAT ?? env.ANT_OUTPUT,
          userSettings.outputFormat ?? userSettings.output,
        )

        // 6. Resolve logLevel & verbose
        const verbose = Boolean(options.verbose)
        if (outputFormat === 'stream-json' && !verbose) {
          throw new Error('When using --print, --output-format=stream-json requires --verbose')
        }

        let logLevel = (options.logLevel ??
          env.ANT_LOG_LEVEL ??
          userSettings.logLevel ??
          (verbose ? 'debug' : 'info')) as LogLevel
        if (logLevel !== 'error' && logLevel !== 'info' && logLevel !== 'debug') {
          throw new Error(`Invalid log-level: "${logLevel}". Allowed: error, info, debug`)
        }

        // 7. Resolve theme: CLI > env > settings > auto
        const theme = (options.theme ?? env.ANT_THEME ?? userSettings.theme ?? 'auto') as Theme
        if (theme !== 'auto' && theme !== 'dark' && theme !== 'light' && theme !== 'ansi') {
          throw new Error(`Invalid theme: "${theme}". Allowed: auto, dark, light, ansi`)
        }

        // 8. Resolve reasoning effort
        const rawEffort =
          options.effort ?? env.ANT_EFFORT ?? env.ANT_REASONING ?? userSettings.reasoning
        const effort = rawEffort ? parseReasoning(String(rawEffort)) : undefined

        // 9. Resolve permission mode and rules
        let permissionMode: PermissionMode = 'default'
        if (options.dangerouslySkipPermissions) {
          permissionMode = 'bypassPermissions'
        } else if (options.permissionMode) {
          const modeVal = options.permissionMode.trim()
          if (!PERMISSION_MODES.includes(modeVal as PermissionMode)) {
            throw new Error(
              `Invalid permission-mode: "${modeVal}". Allowed: ${PERMISSION_MODES.join(', ')}`,
            )
          }
          permissionMode = modeVal as PermissionMode
        } else if (userSettings.permissionMode) {
          permissionMode = userSettings.permissionMode
        }

        const rawAllowedRules: string[] = [
          ...(options.allowedTools ?? []),
          ...(userSettings.allowedTools ?? []),
        ]
        const rawDisallowedRules: string[] = [
          ...(options.disallowedTools ?? []),
          ...(userSettings.disallowedTools ?? []),
        ]

        const allowedToolsRules: ParsedToolRule[] = rawAllowedRules.map((r) => parseToolRule(r))
        const disallowedToolsRules: ParsedToolRule[] = rawDisallowedRules.map((r) =>
          parseToolRule(r),
        )

        // Tools visibility filter: empty filter fails closed ([]), 'default' leaves undefined
        let toolsFilter: ToolName[] | undefined
        if (options.tools !== undefined) {
          const filterStr = options.tools.trim()
          if (filterStr === '') {
            toolsFilter = []
          } else if (filterStr !== 'default') {
            const names = filterStr
              .split(',')
              .map((x: string) => x.trim() as ToolName)
              .filter(Boolean)
            for (const n of names) {
              if (!KNOWN_TOOLS.includes(n)) {
                throw new Error(`Unknown tool "${n}" in --tools filter.`)
              }
            }
            toolsFilter = names
          }
        }

        // System prompt file validation (fail-fast)
        let appendSystemPromptFileContent: string | undefined
        if (options.appendSystemPromptFile) {
          const filePath = options.appendSystemPromptFile
          if (!existsSync(filePath)) {
            throw new Error(`System prompt file not found: "${filePath}"`)
          }
          try {
            appendSystemPromptFileContent = readFileSync(filePath, 'utf-8')
          } catch (err) {
            throw new Error(
              `Failed to read system prompt file "${filePath}": ${err instanceof Error ? err.message : String(err)}`,
            )
          }
        }

        let combinedSystemPrompt: string | undefined
        const promptParts: string[] = []
        if (options.appendSystemPrompt) promptParts.push(options.appendSystemPrompt)
        if (appendSystemPromptFileContent) promptParts.push(appendSystemPromptFileContent)
        if (promptParts.length > 0) {
          combinedSystemPrompt = promptParts.join('\n\n')
        }

        let workspaceRoot = process.cwd()
        try {
          workspaceRoot = realpathSync(process.cwd())
        } catch {}

        const effectivePermissions = resolveEffectivePermissions({
          mode: permissionMode,
          allowedRules: allowedToolsRules,
          disallowedRules: disallowedToolsRules,
          exposedToolsFilter: toolsFilter,
          cwd: workspaceRoot,
        })

        const runStartTime = Date.now()
        let stdinInput: string | undefined
        try {
          const remainingStdinMs =
            timeoutMs > 0 ? Math.max(1, timeoutMs - (Date.now() - runStartTime)) : undefined
          stdinInput = await readPipedStdin(undefined, undefined, undefined, remainingStdinMs)
        } catch (err: any) {
          if (err.message?.includes('timed out waiting for piped stdin')) {
            notice.error('timed out waiting for piped stdin')
            process.exitCode = 4
            return
          }
          throw err
        }

        if (!prompt && !stdinInput && !options.continue && !options.resume) {
          throw new Error('No instruction provided. Pass a prompt or pipe input via stdin.')
        }

        const remainingTimeoutMs =
          timeoutMs > 0 ? Math.max(1, timeoutMs - (Date.now() - runStartTime)) : 0

        const config: Config = {
          prompt,
          stdinInput,
          model,
          maxTurns,
          timeoutMs: remainingTimeoutMs,
          retries,
          outputFormat,
          logLevel,
          theme,
          effort,
          effectivePermissions,
          cwd: workspaceRoot,
          continueLatest: Boolean(options.continue),
          resumeThreadId: options.resume,
          bare: isBare,
          noSessionPersistence:
            options.sessionPersistence === false || Boolean(options.noSessionPersistence),
          verbose,
          toolsFilter,
          permissionMode,
          allowedToolsRules,
          disallowedToolsRules,
          appendSystemPrompt: combinedSystemPrompt,
          settings: userSettings,
        }

        const engine = new Engine()
        const exitCode = await engine.run(config)
        process.exitCode = exitCode
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        notice.error(message)
        process.exitCode = 2
      }
    })
}

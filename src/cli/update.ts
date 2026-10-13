import { Command } from 'commander'
import { spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import pkg from '../../package.json' with { type: 'json' }
import { createColorFormatter } from '../output/color.ts'

const REPO = 'sapirrior/ant'

interface ReleaseInfo {
  tag_name: string
  name: string
  body: string
}

async function fetchLatestRelease(): Promise<ReleaseInfo> {
  const url = `https://api.github.com/repos/${REPO}/releases/latest`
  const res = await fetch(url, {
    headers: {
      'User-Agent': `ant-cli/${pkg.version}`,
      Accept: 'application/vnd.github.v3+json',
    },
  })

  if (!res.ok) {
    throw new Error(`GitHub API returned HTTP ${res.status} ${res.statusText}`)
  }

  return (await res.json()) as ReleaseInfo
}

function resolveAsset(): string {
  const isTermux = Boolean(process.env.PREFIX && existsSync(`${process.env.PREFIX}/bin`))
  if (isTermux) {
    return 'ant.js'
  }

  const platform = process.platform
  const arch = process.arch

  if (platform === 'linux') {
    if (arch === 'x64') return 'ant-linux-x64'
    if (arch === 'arm64') return 'ant-linux-arm64'
  } else if (platform === 'darwin') {
    if (arch === 'x64') return 'ant-darwin-x64'
    if (arch === 'arm64') return 'ant-darwin-arm64'
  } else if (platform === 'win32') {
    if (arch === 'x64') return 'ant-windows-x64.exe'
  }

  throw new Error(`Unsupported platform/architecture: ${platform}-${arch}`)
}

export function registerUpdateCommand(program: Command): void {
  program
    .command('update')
    .description('Check for updates or update ant to the latest version')
    .option('-c, --check', 'Check for updates without installing')
    .option('-f, --force', 'Force reinstall even if already on the latest version')
    .action(async (options: { check?: boolean; force?: boolean }) => {
      const fmt = createColorFormatter()
      const prefix = `${fmt.primary('[ant]')}`

      try {
        process.stderr.write(`${prefix} ${fmt.muted('Checking for updates...')}\n`)
        const release = await fetchLatestRelease()
        const latestTag = release.tag_name || ''
        const latestVersion = latestTag.replace(/^v/, '')
        const currentVersion = pkg.version.replace(/^v/, '')

        const isOutdated = latestVersion !== currentVersion

        if (!isOutdated && !options.force) {
          process.stdout.write(
            `${fmt.success('✔')} ant is up to date (${fmt.secondary(`v${currentVersion}`)}).\n`
          )
          process.exitCode = 0
          return
        }

        if (options.check) {
          if (isOutdated) {
            process.stdout.write(
              `A new version of ant is available: ${fmt.secondary(`v${latestVersion}`)} ${fmt.muted(`(current: v${currentVersion})`)}\nRun ${fmt.primary('ant update')} to upgrade.\n`
            )
          } else {
            process.stdout.write(`${fmt.success('✔')} ant is up to date (${fmt.secondary(`v${currentVersion}`)}).\n`)
          }
          process.exitCode = 0
          return
        }

        process.stderr.write(
          `${prefix} Updating from ${fmt.muted(`v${currentVersion}`)} to ${fmt.secondary(`v${latestVersion}`)}...\n`
        )

        const asset = resolveAsset()
        const downloadUrl = `https://github.com/${REPO}/releases/download/${latestTag}/${asset}`

        process.stderr.write(`${prefix} Downloading ${fmt.accent(asset)}...\n`)
        const dlRes = await fetch(downloadUrl)
        if (!dlRes.ok) {
          throw new Error(`Failed to download ${asset}: HTTP ${dlRes.status} ${dlRes.statusText}`)
        }

        const arrayBuffer = await dlRes.arrayBuffer()
        const buffer = Buffer.from(arrayBuffer)

        // Target path is ~/.ant/bin/ant (or ~/.ant/bin/ant.exe on Windows)
        const installDir = join(homedir(), '.ant', 'bin')
        mkdirSync(installDir, { recursive: true })
        const targetBin = join(installDir, process.platform === 'win32' ? 'ant.exe' : 'ant')

        writeFileSync(targetBin, buffer)
        if (process.platform !== 'win32') {
          chmodSync(targetBin, 0o755)
        }

        // Run termux-fix-shebang if in Termux
        if (process.env.PREFIX && existsSync(`${process.env.PREFIX}/bin/termux-fix-shebang`)) {
          spawn(`${process.env.PREFIX}/bin/termux-fix-shebang`, [targetBin], { stdio: 'ignore' })
        }

        process.stdout.write(
          `${fmt.success('✔')} Successfully updated ant to ${fmt.secondary(`v${latestVersion}`)}! ${fmt.muted(`(${targetBin})`)}\n`
        )
        process.exitCode = 0
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        process.stderr.write(`${prefix} ${fmt.error('error:')} ${msg}\n`)
        process.exitCode = 1
      }
    })
}

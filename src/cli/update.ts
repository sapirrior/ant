import { Command } from 'commander'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import pkg from '../../package.json' with { type: 'json' }
import { getAntHome } from '../paths.ts'
import { notice } from '../output/notice.ts'

const REPO = 'sapirrior/ant'

interface ReleaseInfo {
  tag_name: string
  name: string
  body: string
}

function isNewer(latest: string, current: string): boolean {
  const l = latest.split('.').map((n) => Number.parseInt(n, 10) || 0)
  const c = current.split('.').map((n) => Number.parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(l.length, c.length); i++) {
    const li = l[i] ?? 0
    const ci = c[i] ?? 0
    if (li > ci) return true
    if (li < ci) return false
  }
  return false
}

async function fetchLatestRelease(): Promise<ReleaseInfo> {
  const url = `https://api.github.com/repos/${REPO}/releases/latest`
  const res = await fetch(url, {
    headers: {
      'User-Agent': `ant-cli/${pkg.version}`,
      Accept: 'application/vnd.github.v3+json',
    },
    signal: AbortSignal.timeout(15000),
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
      try {
        notice.info('Checking for updates...')
        const release = await fetchLatestRelease()
        const latestTag = release.tag_name || ''
        const latestVersion = latestTag.replace(/^v/, '')
        const currentVersion = pkg.version.replace(/^v/, '')

        const isOutdated = isNewer(latestVersion, currentVersion)

        if (!isOutdated && !options.force) {
          notice.done(`ant is up to date (v${currentVersion}).`)
          process.exitCode = 0
          return
        }

        if (options.check) {
          if (isOutdated) {
            notice.info(
              `A new version of ant is available: v${latestVersion} (current: v${currentVersion})\nRun ant update to upgrade.`,
            )
          } else {
            notice.done(`ant is up to date (v${currentVersion}).`)
          }
          process.exitCode = 0
          return
        }

        notice.info(`Updating from v${currentVersion} to v${latestVersion}...`)

        const asset = resolveAsset()
        const downloadUrl = `https://github.com/${REPO}/releases/download/${latestTag}/${asset}`

        notice.info(`Downloading ${asset}...`)
        const dlRes = await fetch(downloadUrl, { signal: AbortSignal.timeout(30000) })
        if (!dlRes.ok) {
          throw new Error(`Failed to download ${asset}: HTTP ${dlRes.status} ${dlRes.statusText}`)
        }

        const arrayBuffer = await dlRes.arrayBuffer()
        const buffer = Buffer.from(arrayBuffer)

        // Verify SHA-256 against checksums.txt if available
        try {
          const checksumRes = await fetch(
            `https://github.com/${REPO}/releases/download/${latestTag}/checksums.txt`,
            { signal: AbortSignal.timeout(15000) },
          )
          if (checksumRes.ok) {
            const checksumsText = await checksumRes.text()
            const match = checksumsText
              .split('\n')
              .map((l) => l.trim().split(/\s+/))
              .find((parts) => parts[1] === asset)
            if (match && match[0]) {
              const expectedHash = match[0].toLowerCase()
              const actualHash = createHash('sha256').update(buffer).digest('hex').toLowerCase()
              if (expectedHash !== actualHash) {
                throw new Error(`Checksum verification failed for ${asset}`)
              }
            }
          }
        } catch (checksumErr) {
          if (
            checksumErr instanceof Error &&
            checksumErr.message.includes('Checksum verification failed')
          ) {
            throw checksumErr
          }
        }

        // Target path is ~/.ant/bin/ant (or ANT_HOME/bin/ant)
        const installDir = join(getAntHome(), 'bin')
        mkdirSync(installDir, { recursive: true })
        const targetBin = join(installDir, process.platform === 'win32' ? 'ant.exe' : 'ant')
        const tempBin = `${targetBin}.new`

        writeFileSync(tempBin, buffer)
        if (process.platform !== 'win32') {
          chmodSync(tempBin, 0o755)
        }

        if (process.platform === 'win32') {
          const oldBin = `${targetBin}.old`
          try {
            if (existsSync(targetBin)) renameSync(targetBin, oldBin)
          } catch {}
          renameSync(tempBin, targetBin)
          try {
            if (existsSync(oldBin)) unlinkSync(oldBin)
          } catch {}
        } else {
          renameSync(tempBin, targetBin)
        }

        // In Termux: ensure ant.js is stored and compile native executable if bun is available
        const isTermux = Boolean(process.env.PREFIX && existsSync(`${process.env.PREFIX}/bin`))
        if (isTermux) {
          const antJsPath = join(installDir, 'ant.js')
          writeFileSync(antJsPath, buffer)
          if (existsSync(`${process.env.PREFIX}/bin/termux-fix-shebang`)) {
            spawnSync(`${process.env.PREFIX}/bin/termux-fix-shebang`, [antJsPath, targetBin], {
              stdio: 'ignore',
            })
          }
          const hasBun = spawnSync('which', ['bun'], { stdio: 'ignore' }).status === 0
          if (hasBun) {
            spawnSync(
              'bun',
              ['build', '--compile', '--no-env-file', antJsPath, '--outfile', targetBin],
              {
                stdio: 'ignore',
              },
            )
            chmodSync(targetBin, 0o755)
          }
        }

        writeFileSync(join(installDir, '.version'), latestVersion, 'utf-8')

        notice.done(`Successfully updated ant to v${latestVersion}! (${targetBin})`)
        process.exitCode = 0
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        notice.error(msg)
        process.exitCode = 1
      }
    })
}

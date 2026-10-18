#!/usr/bin/env node

/**
 * ant-actions launcher
 * Zero-dependency bridge for npm / npx execution.
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawnSync, spawn } from 'node:child_process'
import https from 'node:https'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'))
const REPO = 'sapirrior/ant'

function getAntHome() {
  return process.env.ANT_HOME || path.join(os.homedir(), '.ant')
}

export function handleSpawnResult(res) {
  if (res.error) {
    process.stderr.write(`error: Failed to execute ant: ${res.error.message}\n`)
    return 1
  }
  if (typeof res.status === 'number') {
    return res.status
  }
  if (res.signal) {
    const sigNum = os.constants?.signals?.[res.signal]
    return typeof sigNum === 'number' ? 128 + sigNum : 1
  }
  return 1
}

function resolveAsset() {
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

  throw new Error(`Unsupported platform or architecture: ${platform}-${arch}`)
}

function downloadBinary(url, dest) {
  return new Promise((resolve, reject) => {
    const request = (targetUrl) => {
      https
        .get(targetUrl, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            return request(res.headers.location)
          }
          if (res.statusCode !== 200) {
            return reject(
              new Error(`Download failed with status ${res.statusCode}: ${res.statusMessage}`),
            )
          }

          const fileStream = fs.createWriteStream(dest)
          res.pipe(fileStream)
          fileStream.on('finish', () => {
            fileStream.close(() => resolve())
          })
          fileStream.on('error', (err) => {
            fs.unlink(dest, () => {})
            reject(err)
          })
        })
        .on('error', (err) => {
          fs.unlink(dest, () => {})
          reject(err)
        })
    }

    request(url)
  })
}

async function main() {
  const args = process.argv.slice(2)
  const isTermux = Boolean(
    process.env.PREFIX && fs.existsSync(path.join(process.env.PREFIX, 'bin')),
  )
  const antHome = getAntHome()
  const binDir = path.join(antHome, 'bin')
  const exeName = process.platform === 'win32' ? 'ant.exe' : 'ant'
  const targetExe = path.join(binDir, exeName)
  const versionFile = path.join(binDir, '.version')

  if (!fs.existsSync(binDir)) {
    fs.mkdirSync(binDir, { recursive: true })
  }

  const isCurrentVersion =
    fs.existsSync(targetExe) &&
    fs.existsSync(versionFile) &&
    fs.readFileSync(versionFile, 'utf-8').trim() === pkg.version

  if (isCurrentVersion) {
    const res = spawnSync(targetExe, args, { stdio: 'inherit' })
    process.exit(handleSpawnResult(res))
  }

  if (isTermux) {
    const cachedJs = path.join(binDir, 'ant.js')
    const localBundledJs = path.join(__dirname, '..', 'dist', 'ant.js')
    let jsRuntime = fs.existsSync(localBundledJs) ? localBundledJs : cachedJs

    const isJsCurrent =
      fs.existsSync(jsRuntime) &&
      fs.existsSync(versionFile) &&
      fs.readFileSync(versionFile, 'utf-8').trim() === pkg.version

    if (!isJsCurrent && !fs.existsSync(localBundledJs)) {
      try {
        process.stderr.write(`ant: fetching v${pkg.version} runtime for Termux...\n`)
        const downloadUrl = `https://github.com/${REPO}/releases/download/v${pkg.version}/ant.js`
        const tempJs = `${cachedJs}.dl`
        await downloadBinary(downloadUrl, tempJs)
        fs.renameSync(tempJs, cachedJs)
        fs.chmodSync(cachedJs, 0o755)
        jsRuntime = cachedJs
      } catch (err) {
        process.stderr.write(`error: Failed to download ant runtime: ${err.message}\n`)
        process.exit(1)
      }
    }

    // Check if bun is available in Termux
    const checkBun = spawnSync('which', ['bun'], { stdio: 'ignore' })
    if (checkBun.status !== 0) {
      process.stderr.write(
        `error: Termux requires Bun to run ant.\nInstall Bun via: pkg install bun\n`,
      )
      process.exit(1)
    }

    // Spawn background compilation to build native binary for future runs
    const compileScript = `
      bun build --compile --no-env-file "${jsRuntime}" --outfile "${targetExe}.tmp" 2>/dev/null && \
      mv "${targetExe}.tmp" "${targetExe}" && \
      chmod 755 "${targetExe}" && \
      echo "${pkg.version}" > "${versionFile}"
    `
    const bgProc = spawn('sh', ['-c', compileScript], {
      detached: true,
      stdio: 'ignore',
    })
    bgProc.unref()

    // Execute immediately via bun for this invocation
    const runRes = spawnSync('bun', [jsRuntime, ...args], { stdio: 'inherit' })
    process.exit(handleSpawnResult(runRes))
  }

  // Desktop platforms (Linux, macOS, Windows)
  try {
    const asset = resolveAsset()
    const downloadUrl = `https://github.com/${REPO}/releases/download/v${pkg.version}/${asset}`

    process.stderr.write(`ant: fetching native binary (v${pkg.version} for ${asset})...\n`)

    const tempExe = `${targetExe}.dl`
    await downloadBinary(downloadUrl, tempExe)

    if (process.platform !== 'win32') {
      fs.chmodSync(tempExe, 0o755)
    }

    fs.renameSync(tempExe, targetExe)
    fs.writeFileSync(versionFile, pkg.version, 'utf-8')

    const res = spawnSync(targetExe, args, { stdio: 'inherit' })
    process.exit(handleSpawnResult(res))
  } catch (err) {
    process.stderr.write(`error: Failed to launch native ant binary: ${err.message}\n`)
    process.exit(1)
  }
}

const isDirectRun =
  typeof import.meta.main === 'boolean'
    ? import.meta.main
    : Boolean(process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))

if (isDirectRun) {
  main().catch((err) => {
    process.stderr.write(`error: ${err.message}\n`)
    process.exit(1)
  })
}

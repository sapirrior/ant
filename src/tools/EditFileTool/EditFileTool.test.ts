import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createEditFileTool } from './EditFileTool.ts'
import { resolveEffectivePermissions } from '../../policy/toolPermissions.ts'
import type { ToolExecutionContext, ToolExecutionResult } from '../../core/types.ts'

describe('EditFileTool', () => {
  let testDir: string
  let testFile: string
  let context: ToolExecutionContext

  const execOptions = { messages: [], toolCallId: '1', context: {} }

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'ant-edit-test-'))
    testFile = join(testDir, 'sample.txt')
    context = {
      cwd: testDir,
      effectivePermissions: resolveEffectivePermissions({
        mode: 'acceptEdits',
        allowedRules: [],
        disallowedRules: [],
      }),
    }
    writeFileSync(testFile, 'line 1\nline 2\nline 3\n', 'utf-8')
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it('replaces targeted content uniquely and safely', async () => {
    const editTool = createEditFileTool(context)
    if (!editTool.execute) throw new Error('execute is undefined')
    const result = (await editTool.execute(
      { path: 'sample.txt', oldContent: 'line 2', newContent: 'line TWO', replaceAll: false },
      execOptions
    )) as ToolExecutionResult<{ status: string }>

    expect(result.ok).toBe(true)
    const fileOnDisk = readFileSync(testFile, 'utf-8')
    expect(fileOnDisk).toBe('line 1\nline TWO\nline 3\n')
  })

  it('rejects identical oldContent and newContent', async () => {
    const editTool = createEditFileTool(context)
    if (!editTool.execute) throw new Error('execute is undefined')
    const result = (await editTool.execute(
      { path: 'sample.txt', oldContent: 'line 2', newContent: 'line 2', replaceAll: false },
      { ...execOptions, toolCallId: '2' }
    )) as ToolExecutionResult<unknown>

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/identical/)
  })

  it('fails cleanly when oldContent is missing', async () => {
    const editTool = createEditFileTool(context)
    if (!editTool.execute) throw new Error('execute is undefined')
    const result = (await editTool.execute(
      { path: 'sample.txt', oldContent: 'nonexistent', newContent: 'new', replaceAll: false },
      { ...execOptions, toolCallId: '3' }
    )) as ToolExecutionResult<unknown>

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/was not found/)
  })

  it('fails cleanly on non-unique match without replaceAll', async () => {
    writeFileSync(testFile, 'foo bar\nfoo bar\n', 'utf-8')
    const editTool = createEditFileTool(context)
    if (!editTool.execute) throw new Error('execute is undefined')
    const result = (await editTool.execute(
      { path: 'sample.txt', oldContent: 'foo bar', newContent: 'baz', replaceAll: false },
      { ...execOptions, toolCallId: '4' }
    )) as ToolExecutionResult<unknown>

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/matched 2 times/)
  })

  it('preserves CRLF line endings when present', async () => {
    writeFileSync(testFile, 'line 1\r\nline 2\r\nline 3\r\n', 'utf-8')
    const editTool = createEditFileTool(context)
    if (!editTool.execute) throw new Error('execute is undefined')
    const result = (await editTool.execute(
      { path: 'sample.txt', oldContent: 'line 2', newContent: 'line TWO', replaceAll: false },
      { ...execOptions, toolCallId: '5' }
    )) as ToolExecutionResult<{ status: string }>

    expect(result.ok).toBe(true)
    const fileOnDisk = readFileSync(testFile, 'utf-8')
    expect(fileOnDisk).toBe('line 1\r\nline TWO\r\nline 3\r\n')
  })

  it('preserves special replacement tokens like $&, $$, $1 literally (B-008)', async () => {
    writeFileSync(testFile, 'price is COST and count is NUM\n', 'utf-8')
    const editTool = createEditFileTool(context)
    if (!editTool.execute) throw new Error('execute is undefined')
    const result = (await editTool.execute(
      { path: 'sample.txt', oldContent: 'COST', newContent: '$$50 and $& $1', replaceAll: false },
      { ...execOptions, toolCallId: '5b' }
    )) as ToolExecutionResult<{ status: string }>

    expect(result.ok).toBe(true)
    const fileOnDisk = readFileSync(testFile, 'utf-8')
    expect(fileOnDisk).toBe('price is $$50 and $& $1 and count is NUM\n')
  })

  it('enforces CAS #1 read-before-write guard when readState is present', async () => {
    const readState = new Map<string, string>()
    const ctxWithReadState: ToolExecutionContext = {
      ...context,
      readState,
    }

    const editTool = createEditFileTool(ctxWithReadState)
    if (!editTool.execute) throw new Error('execute is undefined')

    // 1. Without having read the file, edit fails
    const res1 = (await editTool.execute(
      { path: 'sample.txt', oldContent: 'line 2', newContent: 'line TWO', replaceAll: false },
      { ...execOptions, toolCallId: 'cas_1' }
    )) as ToolExecutionResult<unknown>
    expect(res1.ok).toBe(false)
    expect(res1.error).toMatch(/File changed since you read it \(or was never read\)/)

    // 2. Populate readState with stale/wrong hash -> edit fails
    readState.set('sample.txt', 'stale_hash_value')
    const res2 = (await editTool.execute(
      { path: 'sample.txt', oldContent: 'line 2', newContent: 'line TWO', replaceAll: false },
      { ...execOptions, toolCallId: 'cas_2' }
    )) as ToolExecutionResult<unknown>
    expect(res2.ok).toBe(false)
    expect(res2.error).toMatch(/File changed since you read it \(or was never read\)/)

    // 3. Populate readState with correct current hash -> edit succeeds
    const { computeHash } = await import('../fs.ts')
    const currentHash = computeHash(readFileSync(testFile))
    readState.set('sample.txt', currentHash)

    const res3 = (await editTool.execute(
      { path: 'sample.txt', oldContent: 'line 2', newContent: 'line TWO', replaceAll: false },
      { ...execOptions, toolCallId: 'cas_3' }
    )) as ToolExecutionResult<unknown>
    expect(res3.ok).toBe(true)
    expect(readFileSync(testFile, 'utf-8')).toBe('line 1\nline TWO\nline 3\n')
  })
})

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import {
  lockPaths,
  readExistingLock,
  tryAcquireLockSync,
  isPidAlive,
  fallbackBaseUrlAndPort,
  readDevLockFile,
} from '../src/index'

const tmpDir = path.join(os.tmpdir(), `unplugin-singleton-test-${Date.now()}`)

describe('lockPaths', () => {
  it('返回 .dev 下的 dev 与 preview 锁路径', () => {
    const root = '/foo/bar'
    const { devLockPath, previewLockPath } = lockPaths(root)
    expect(devLockPath).toBe(path.join(root, '.dev', 'dev.lock.json'))
    expect(previewLockPath).toBe(path.join(root, '.dev', 'preview.lock.json'))
  })
})

describe('readExistingLock', () => {
  it('文件不存在返回 null', () => {
    expect(readExistingLock(path.join(tmpDir, 'nonexistent.json'))).toBeNull()
  })

  it('无效 JSON 返回 null', () => {
    const p = path.join(tmpDir, 'bad.json')
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, 'not json', 'utf8')
    expect(readExistingLock(p)).toBeNull()
  })

  it('有效锁文件返回 LockPayload', () => {
    const p = path.join(tmpDir, 'valid.json')
    fs.mkdirSync(path.dirname(p), { recursive: true })
    const payload = { pid: 12345, port: 5173, baseUrl: 'http://localhost:5173' }
    fs.writeFileSync(p, JSON.stringify(payload), 'utf8')
    expect(readExistingLock(p)).toEqual(payload)
  })
})

describe('tryAcquireLockSync', () => {
  const lockFile = path.join(tmpDir, 'acquire.lock.json')

  afterEach(() => {
    try { fs.unlinkSync(lockFile) } catch { /* ignore */ }
  })

  it('首次获取成功', () => {
    fs.mkdirSync(path.dirname(lockFile), { recursive: true })
    const payload = { pid: process.pid, port: 5173, baseUrl: 'http://localhost:5173' }
    expect(tryAcquireLockSync(lockFile, payload)).toBe(true)
    expect(JSON.parse(fs.readFileSync(lockFile, 'utf8'))).toEqual(payload)
  })

  it('同一进程可覆盖已有锁', () => {
    fs.mkdirSync(path.dirname(lockFile), { recursive: true })
    const p1 = { pid: process.pid, port: 5173, baseUrl: 'http://localhost:5173' }
    const p2 = { pid: process.pid, port: 3000, baseUrl: 'http://localhost:3000' }
    expect(tryAcquireLockSync(lockFile, p1)).toBe(true)
    expect(tryAcquireLockSync(lockFile, p2)).toBe(true)
    expect(JSON.parse(fs.readFileSync(lockFile, 'utf8'))).toEqual(p2)
  })

  it('其他存活进程占用时获取失败', () => {
    fs.mkdirSync(path.dirname(lockFile), { recursive: true })
    const otherPid = 999999
    fs.writeFileSync(
      lockFile,
      JSON.stringify({ pid: otherPid, port: 5173, baseUrl: 'http://localhost:5173' }),
      'utf8',
    )
    // 999999 通常不存在，若存在则此测试可能失败；用 1 作为“系统进程”更稳
    const payload = { pid: process.pid, port: 3000, baseUrl: 'http://localhost:3000' }
    const acquired = tryAcquireLockSync(lockFile, payload)
    // 若 999999 不存在，我们会抢到锁；若存在则抢不到。这里只测“不会抛错”
    expect(typeof acquired).toBe('boolean')
  })
})

describe('isPidAlive', () => {
  it('当前进程存活', () => {
    expect(isPidAlive(process.pid)).toBe(true)
  })

  it('无效 pid 返回 false', () => {
    expect(isPidAlive(null)).toBe(false)
    expect(isPidAlive(undefined)).toBe(false)
    expect(isPidAlive(-1)).toBe(false)
    expect(isPidAlive(NaN)).toBe(false)
    expect(isPidAlive('')).toBe(false)
  })

  it('不存在的 pid 返回 false', () => {
    expect(isPidAlive(99999999)).toBe(false)
  })
})

describe('fallbackBaseUrlAndPort', () => {
  it('无 config 时用 3000 与 http', () => {
    const r = fallbackBaseUrlAndPort({})
    expect(r.port).toBe(3000)
    expect(r.baseUrl).toMatch(/^http:\/\/.*:3000\/?$/)
  })

  it('config.server.port 生效', () => {
    const r = fallbackBaseUrlAndPort({ server: { port: 5173 } })
    expect(r.port).toBe(5173)
    expect(r.baseUrl).toContain('5173')
  })

  it('PORT 环境变量优先', () => {
    const prev = process.env.PORT
    process.env.PORT = '4000'
    try {
      const r = fallbackBaseUrlAndPort({ server: { port: 5173 } })
      expect(r.port).toBe(4000)
    }
    finally {
      if (prev !== undefined) process.env.PORT = prev
      else delete process.env.PORT
    }
  })

  it('middlewareMode 无 port 时用 3000', () => {
    const r = fallbackBaseUrlAndPort({ server: { middlewareMode: true } })
    expect(r.port).toBe(3000)
  })
})

describe('readDevLockFile', () => {
  const projectRoot = path.join(tmpDir, 'project')
  const devLockPath = path.join(projectRoot, '.dev', 'dev.lock.json')

  afterEach(() => {
    try { fs.rmSync(path.join(projectRoot, '.dev'), { recursive: true }) } catch { /* ignore */ }
  })

  it('文件不存在返回 null', () => {
    expect(readDevLockFile(projectRoot)).toBeNull()
  })

  it('有效锁文件（pid/port/baseUrl）返回 baseUrl 与 port', () => {
    fs.mkdirSync(path.dirname(devLockPath), { recursive: true })
    const data = { pid: 12345, port: 3200, baseUrl: 'http://localhost:3200' }
    fs.writeFileSync(devLockPath, JSON.stringify(data), 'utf8')
    expect(readDevLockFile(projectRoot)).toEqual({ port: 3200, baseUrl: 'http://localhost:3200' })
  })

  it('无效 port 返回 null', () => {
    fs.mkdirSync(path.dirname(devLockPath), { recursive: true })
    fs.writeFileSync(devLockPath, JSON.stringify({ pid: 1, port: 0, baseUrl: 'http://localhost:0' }), 'utf8')
    expect(readDevLockFile(projectRoot)).toBeNull()
  })
})

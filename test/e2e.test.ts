import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import kill from 'tree-kill'

const rootDir = path.resolve(__dirname, '..')
const DEV_LOCK = '.dev/dev.lock.json'

async function waitForDevLock(cwd: string, timeout = 30_000): Promise<string> {
  const lockPath = path.join(cwd, DEV_LOCK)
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (fs.existsSync(lockPath)) {
      const raw = fs.readFileSync(lockPath, 'utf8')
      const data = JSON.parse(raw) as { pid?: number, port?: number, baseUrl?: string }
      if (typeof data?.port === 'number' && data.port > 0 && data.baseUrl)
        return lockPath
    }
    await new Promise(r => setTimeout(r, 200))
  }
  throw new Error(`${cwd}/${DEV_LOCK} 未在 ${timeout}ms 内出现且含有效 port/baseUrl`)
}

function killProc(proc: ReturnType<typeof spawn>): Promise<void> {
  if (!proc.pid)
    return Promise.resolve()
  return new Promise(resolve => kill(proc.pid!, 'SIGTERM', () => resolve()))
}

describe('e2e', () => {
  describe('nuxt', () => {
    const cwd = path.join(rootDir, 'playground/nuxt')
    const lockPath = path.join(cwd, DEV_LOCK)
    let proc: ReturnType<typeof spawn>

    beforeAll(async () => {
      proc = spawn('bun', ['run', 'dev'], { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
      await waitForDevLock(cwd)
    }, 40_000)

    afterAll(() => killProc(proc))

    it('插件写入 .dev/dev.lock.json 且含 pid、port、baseUrl', () => {
      expect(fs.existsSync(lockPath)).toBe(true)
      const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as { pid?: number, port?: number, baseUrl?: string }
      expect(lock).toHaveProperty('pid')
      expect(typeof lock.pid).toBe('number')
      expect(lock).toHaveProperty('port')
      expect(typeof lock.port).toBe('number')
      expect(lock.port).toBeGreaterThan(0)
      expect(lock.port).toBeLessThanOrEqual(65535)
      expect(lock).toHaveProperty('baseUrl')
      expect(String(lock.baseUrl)).toContain(String(lock.port))
    })
  })

  describe('vite', () => {
    const cwd = path.join(rootDir, 'playground/vite')
    const lockPath = path.join(cwd, DEV_LOCK)
    let proc: ReturnType<typeof spawn>

    beforeAll(async () => {
      proc = spawn('bun', ['x', 'vite'], { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
      await waitForDevLock(cwd)
    }, 40_000)

    afterAll(() => killProc(proc))

    it('插件写入 .dev/dev.lock.json 且含 pid、port、baseUrl', () => {
      expect(fs.existsSync(lockPath)).toBe(true)
      const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as { pid?: number, port?: number, baseUrl?: string }
      expect(lock).toHaveProperty('pid')
      expect(typeof lock.pid).toBe('number')
      expect(lock).toHaveProperty('port')
      expect(typeof lock.port).toBe('number')
      expect(lock.port).toBeGreaterThan(0)
      expect(lock.port).toBeLessThanOrEqual(65535)
      expect(lock).toHaveProperty('baseUrl')
      expect(String(lock.baseUrl)).toContain(String(lock.port))
    })
  })
})

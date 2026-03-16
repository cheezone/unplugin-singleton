import { spawn } from 'node:child_process'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const rootDir = path.resolve(__dirname, '..')

const NUXT_DEV_PORT = 30555
const VITE_DEV_PORT = 30556

async function fetchWithTimeout(url: string, ms: number): Promise<Response | null> {
  const c = new AbortController()
  const t = setTimeout(() => c.abort(), ms)
  try {
    const r = await fetch(url, { signal: c.signal })
    return r
  }
  catch {
    return null
  }
  finally {
    clearTimeout(t)
  }
}

async function waitForServer(
  url: string,
  timeout = 25_000,
  fallbackUrl?: string,
): Promise<string> {
  const start = Date.now()
  const urls = [url, ...(fallbackUrl ? [fallbackUrl] : [])]
  while (Date.now() - start < timeout) {
    for (const u of urls) {
      const r = await fetchWithTimeout(u, 2000)
      if (r?.ok)
        return u
    }
    await new Promise(r => setTimeout(r, 200))
  }
  throw new Error(`Server did not become ready: ${url}`)
}

describe('e2e', () => {
  describe('nuxt 环境', () => {
    let proc: ReturnType<typeof spawn>
    let baseUrl: string

    beforeAll(async () => {
      const cwd = path.join(rootDir, 'playground/nuxt')
      proc = spawn('bun', ['run', 'dev'], {
        cwd,
        env: { ...process.env, PORT: String(NUXT_DEV_PORT), NUXT_PORT: String(NUXT_DEV_PORT) },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      baseUrl = await waitForServer(`http://localhost:${NUXT_DEV_PORT}`)
    }, 30_000)

    afterAll(() => proc.kill('SIGTERM'))

    it('首页有内容（含插件输出）', async () => {
      const res = await fetch(baseUrl)
      const html = await res.text()
      expect(res.ok).toBe(true)
      expect(html).toContain('Mini Nuxt')
      expect(html).toContain('插件输出')
    })
  })

  describe('vite 环境', () => {
    let proc: ReturnType<typeof spawn>
    let viteBaseUrl: string
    const viteRoot = path.join(rootDir, 'playground/vite')
    const devLockPath = path.join(viteRoot, '.dev', 'dev.lock.json')

    beforeAll(async () => {
      proc = spawn('bun', ['x', 'vite', '--port', String(VITE_DEV_PORT)], {
        cwd: viteRoot,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      // 以锁文件为真实 port/baseUrl 来源（Vite 若请求端口被占用会改用下一端口）
      // 非 macOS（如 Linux CI）上 Vite 的 listening 回调更晚，需更长等待
      const { readFileSync, existsSync } = await import('node:fs')
      const lockDeadline = Date.now() + 25_000
      while (Date.now() < lockDeadline) {
        if (existsSync(devLockPath)) {
          const lock = JSON.parse(readFileSync(devLockPath, 'utf8')) as { pid?: number, port?: number, baseUrl?: string }
          if (lock.pid === proc.pid && typeof lock.port === 'number' && lock.baseUrl) {
            viteBaseUrl = String(lock.baseUrl).replace(/\/+$/, '')
            await waitForServer(viteBaseUrl)
            return
          }
        }
        await new Promise(r => setTimeout(r, 100))
      }
      throw new Error('Vite 未在超时内写入 .dev/dev.lock.json')
    }, 30_000)

    afterAll(() => proc.kill('SIGTERM'))

    it('首页有内容（含 app 挂载点）', async () => {
      const res = await fetch(viteBaseUrl)
      const html = await res.text()
      expect(res.ok).toBe(true)
      expect(html).toContain('id="app"')
      expect(html).toMatch(/<script[^>]*src=.*main\.ts/)
    })

    it('插件写入 .dev/dev.lock.json 且含 pid、port、baseUrl', async () => {
      const { readFileSync, existsSync } = await import('node:fs')
      expect(existsSync(devLockPath)).toBe(true)
      const lock = JSON.parse(readFileSync(devLockPath, 'utf8')) as { pid?: number, port?: number, baseUrl?: string }
      expect(lock).toHaveProperty('pid', proc.pid)
      expect(lock).toHaveProperty('port')
      expect(typeof lock.port).toBe('number')
      expect(lock.port).toBeGreaterThan(0)
      expect(lock.port).toBeLessThanOrEqual(65535)
      expect(lock).toHaveProperty('baseUrl')
      expect(String(lock.baseUrl)).toContain(String(lock.port))
    })
  })
})

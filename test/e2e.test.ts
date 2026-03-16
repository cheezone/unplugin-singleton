import { spawn } from 'node:child_process'
import fs from 'node:fs'
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
      const lockDeadline = Date.now() + 25_000
      while (Date.now() < lockDeadline) {
        if (fs.existsSync(devLockPath)) {
          const lock = JSON.parse(fs.readFileSync(devLockPath, 'utf8')) as { pid?: number, port?: number, baseUrl?: string }
          if (lock.pid === proc.pid && typeof lock.port === 'number' && lock.baseUrl) {
            viteBaseUrl = String(lock.baseUrl).replace(/\/+$/, '')
            await waitForServer(viteBaseUrl)
            return
          }
        }
        await new Promise(r => setTimeout(r, 100))
      }
      // 调试信息：便于在非 macOS 上排查“未写入”是路径、权限还是时序问题
      const devDir = path.join(viteRoot, '.dev')
      const devDirExists = fs.existsSync(devDir)
      const lockFileExists = fs.existsSync(devLockPath)
      const debug: Record<string, unknown> = {
        platform: process.platform,
        viteRoot: path.resolve(viteRoot),
        devLockPath: path.resolve(devLockPath),
        devDirExists,
        lockFileExists,
        spawnPid: proc.pid,
        spawnCwd: viteRoot,
        processCwd: process.cwd(),
      }
      if (devDirExists) {
        try {
          debug['.dev 目录内容'] = fs.readdirSync(devDir)
        }
        catch (e) {
          debug['.dev readdir 异常'] = String(e)
        }
      }
      if (lockFileExists) {
        try {
          debug['锁文件内容'] = JSON.parse(fs.readFileSync(devLockPath, 'utf8'))
        }
        catch (e) {
          debug['锁文件读取异常'] = String(e)
        }
      }
      console.error('[e2e 调试] 等锁文件超时:', debug)
      throw new Error(`Vite 未在超时内写入 .dev/dev.lock.json。调试: ${JSON.stringify(debug, null, 2)}`)
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
      expect(fs.existsSync(devLockPath)).toBe(true)
      const lock = JSON.parse(fs.readFileSync(devLockPath, 'utf8')) as { pid?: number, port?: number, baseUrl?: string }
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

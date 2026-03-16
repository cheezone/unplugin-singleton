/**
 * Nuxt 模块：在 listen 时写入统一的 .dev/dev.lock.json（与 Vite 插件相同格式），
 * 关闭时删除。不注册 Vite 插件，逻辑完全在本模块内。
 * 用法：nuxt.config 的 modules 里加 'unplugin-singleton/nuxt' 即可。
 */
import fs from 'node:fs'
import path from 'node:path'
import pc from 'picocolors'
import { defineNuxtModule } from '@nuxt/kit'
import { NUXT_CONFIG_KEY, NUXT_MODULE_NAME } from './constants'
import type { LockPayload } from './types'

const DEV_LOCK_FILE = '.dev/dev.lock.json'

function readExistingLock(lockFilePath: string): LockPayload | null {
  try {
    const raw = fs.readFileSync(lockFilePath, 'utf8')
    const data = JSON.parse(raw) as { pid?: number; port?: number; baseUrl?: string }
    return data && typeof data.pid === 'number' && typeof data.port === 'number' && typeof data.baseUrl === 'string'
      ? { pid: data.pid, port: data.port, baseUrl: data.baseUrl }
      : null
  }
  catch {
    return null
  }
}

function isPidAlive(pid: number): boolean {
  if (pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  }
  catch {
    return false
  }
}

function tryAcquireLockSync(lockFilePath: string, payload: LockPayload): boolean {
  try {
    const fd = fs.openSync(lockFilePath, 'wx')
    try {
      fs.writeFileSync(fd, JSON.stringify(payload, null, 2), 'utf8')
      return true
    }
    finally {
      fs.closeSync(fd)
    }
  }
  catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code
    if (code !== 'EEXIST') throw err
    const existing = readExistingLock(lockFilePath)
    if (!existing) return false
    if (existing.pid === process.pid) {
      try {
        fs.writeFileSync(lockFilePath, JSON.stringify(payload, null, 2), 'utf8')
        return true
      }
      catch {
        return false
      }
    }
    if (isPidAlive(existing.pid)) return false
    try {
      fs.unlinkSync(lockFilePath)
    }
    catch {
      // ignore
    }
    try {
      const fd = fs.openSync(lockFilePath, 'wx')
      try {
        fs.writeFileSync(fd, JSON.stringify(payload, null, 2), 'utf8')
        return true
      }
      finally {
        fs.closeSync(fd)
      }
    }
    catch (err2: unknown) {
      if ((err2 as NodeJS.ErrnoException).code !== 'EEXIST') return false
      throw err2
    }
  }
}

function removeLockFile(rootDir: string): void {
  const p = path.join(rootDir, DEV_LOCK_FILE)
  try {
    if (fs.existsSync(p)) fs.unlinkSync(p)
  }
  catch {
    // ignore
  }
}

export default defineNuxtModule({
  meta: {
    name: NUXT_MODULE_NAME,
    configKey: NUXT_CONFIG_KEY,
  },
  setup(_options, nuxt) {
    const rootDir = nuxt.options.rootDir
    const lockPath = path.join(rootDir, DEV_LOCK_FILE)

    const writeLock = (port: number, baseUrl: string): void => {
      if (!port || port <= 0 || port > 65535 || !baseUrl) return
      const existing = readExistingLock(lockPath)
      if (existing && isPidAlive(existing.pid) && existing.pid !== process.pid) {
        const logger = (nuxt as { logger?: { info: (s: string) => void } }).logger
        logger?.info(
          `  ${pc.green('➜')}  ${pc.bold('dev')} 已在运行 (pid ${existing.pid})，本次退出。${pc.cyan(existing.baseUrl ?? '')}`,
        )
        process.exit(0)
      }
      const dir = path.dirname(lockPath)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      const payload: LockPayload = { pid: process.pid, port, baseUrl: String(baseUrl).replace(/\/+$/, '') }
      const acquired = tryAcquireLockSync(lockPath, payload)
      if (!acquired) {
        const logger = (nuxt as { logger?: { info: (s: string) => void } }).logger
        logger?.info(`  ${pc.green('➜')}  ${pc.bold('dev')} 锁被占用，本次退出。`)
        process.exit(0)
      }
    }

    const removeLock = () => removeLockFile(rootDir)

    nuxt.hook('listen', (_server: unknown, listener: unknown) => {
      const l = listener as Record<string, unknown> | undefined
      const url: string | undefined =
        typeof l?.url === 'string'
          ? l.url
          : Array.isArray(l?.listeners) && l.listeners[0] && typeof (l.listeners[0] as Record<string, unknown>)?.url === 'string'
            ? (l.listeners[0] as { url: string }).url
            : Array.isArray(l?.urls) ? (l.urls[0] as string | undefined) : undefined
      if (!url) return
      const baseUrl = String(url).replace(/\/+$/, '')
      const parsed = baseUrl.startsWith('http') ? new URL(baseUrl) : new URL(`http://${baseUrl}`)
      const port = Number(parsed.port)
      writeLock(port, baseUrl)
    })

    let written = false
    const pollMs = 200
    const maxWait = 25000
    const start = Date.now()
    const tid = setInterval(() => {
      if (written) return
      const dev = nuxt.options.devServer as { port?: number; host?: string; url?: string } | undefined
      const port = dev?.port
      const host = dev?.host ?? 'localhost'
      const baseUrl = port && host ? `http://${host}:${port}` : (dev?.url ?? null)
      if (port && baseUrl) {
        written = true
        clearInterval(tid)
        writeLock(port, baseUrl)
      }
      else if (Date.now() - start > maxWait) {
        clearInterval(tid)
      }
    }, pollMs)

    nuxt.hook('close', () => {
      clearInterval(tid)
      removeLock()
    })

    process.once('SIGINT', removeLock)
    process.once('SIGTERM', removeLock)
    process.on('exit', removeLock)
  },
})

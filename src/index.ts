import type { LockPayload } from './types'
/**
 * unplugin-singleton：单例 dev/preview，就绪后写锁文件（pid、port、baseUrl），供 E2E/脚本读取。
 */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import pc from 'picocolors'
import { createUnplugin } from 'unplugin'
import { PLUGIN_NAME } from './constants'
import { ensureGitignoreDev } from './gitignore'

/** 统一锁文件路径（Vite 与 Nuxt 均使用，格式一致） */
const DEV_LOCK_FILE = '.dev/dev.lock.json'
const DEV_LOCK_POLL_MS = 200
const DEV_LOCK_TIMEOUT_MS = 20000

const TRAILING_SLASHES_RE = /\/+$/
function isLoopback(address: string): boolean {
  return address === '::' || address === '0.0.0.0' || address === '::1' || address === '127.0.0.1'
}

function baseUrlFromAddr(
  addr: { address?: string, port: number },
  config: { server?: { https?: boolean } },
): string {
  const protocol = config?.server?.https ? 'https' : 'http'
  const host
    = typeof addr.address === 'string' && isLoopback(addr.address)
      ? 'localhost'
      : (addr.address ?? 'localhost')
  return `${protocol}://${host}:${addr.port}`.replace(TRAILING_SLASHES_RE, '')
}

/** 读取统一的 dev 锁文件（.dev/dev.lock.json），Vite 无 httpServer 时或 Nuxt 由本包 Nuxt 模块写入 */
function readDevLockFile(root: string): { baseUrl: string, port: number } | null {
  const p = path.join(root, DEV_LOCK_FILE)
  const payload = readExistingLock(p)
  if (!payload || payload.port <= 0 || payload.port > 65535)
    return null
  return { baseUrl: payload.baseUrl.replace(TRAILING_SLASHES_RE, ''), port: payload.port }
}

interface ResolvedConfigLike {
  server?: {
    https?: boolean
    host?: string | boolean
    port?: number | string
    middlewareMode?: boolean
  }
}

function fallbackBaseUrlAndPort(config: ResolvedConfigLike): { baseUrl: string, port: number } {
  const protocol = config?.server?.https ? 'https' : 'http'
  const h = config?.server?.host
  const host
    = h === true || h === '0.0.0.0' || h === '::'
      ? 'localhost'
      : (typeof h === 'string' ? h : 'localhost')
  const fromEnv = process.env.PORT != null && process.env.PORT !== '' ? Number(process.env.PORT) : Number.NaN
  const fromConfig
    = typeof config?.server?.port === 'number'
      ? config.server.port
      : typeof config?.server?.port === 'string' && config?.server?.port !== ''
        ? Number(config.server.port)
        : Number.NaN
  const isMiddlewareMode = config?.server?.middlewareMode === true
  const port = !Number.isNaN(fromEnv)
    ? fromEnv
    : isMiddlewareMode
      ? 3000
      : (Number.isNaN(fromConfig) ? 3000 : fromConfig)
  const baseUrl = `${protocol}://${host}:${port}`.replace(TRAILING_SLASHES_RE, '')
  return { baseUrl, port }
}

function isPidAlive(pid: number | string | null | undefined): boolean {
  if (pid == null || (typeof pid !== 'number' && typeof pid !== 'string'))
    return false
  const n = Number(pid)
  if (Number.isNaN(n) || n <= 0)
    return false
  try {
    process.kill(n, 0)
    return true
  }
  catch {
    return false
  }
}

function readExistingLock(lockFilePath: string): LockPayload | null {
  try {
    const raw = fs.readFileSync(lockFilePath, 'utf8')
    const data = JSON.parse(raw) as { pid?: number, port?: number, baseUrl?: string }
    return data && typeof data === 'object' && typeof data.pid === 'number' && typeof data.port === 'number' && typeof data.baseUrl === 'string'
      ? { pid: data.pid, port: data.port, baseUrl: data.baseUrl }
      : null
  }
  catch {
    return null
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
    if (code !== 'EEXIST')
      throw err
    const existing = readExistingLock(lockFilePath)
    if (!existing)
      return false
    if (existing.pid === process.pid) {
      try {
        fs.writeFileSync(lockFilePath, JSON.stringify(payload, null, 2), 'utf8')
        return true
      }
      catch {
        return false
      }
    }
    if (isPidAlive(existing.pid))
      return false
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
      if ((err2 as NodeJS.ErrnoException).code !== 'EEXIST')
        return false
      throw err2
    }
  }
}

function lockPaths(root: string): { devLockPath: string, previewLockPath: string } {
  const dir = path.join(root, '.dev')
  return {
    devLockPath: path.join(dir, 'dev.lock.json'),
    previewLockPath: path.join(dir, 'preview.lock.json'),
  }
}

interface ViteServer {
  config: { root: string, logger: { info: (s: string) => void, warn: (s: string) => void }, server?: ResolvedConfigLike['server'] }
  httpServer?: import('node:http').Server | null
}

function setupLockOnServer(
  server: ViteServer,
  lockPath: string,
  serverLabel: string,
): void {
  const httpServer = server.httpServer
  const logger = server.config.logger
  const removeLock = (): void => {
    try {
      if (fs.existsSync(lockPath))
        fs.unlinkSync(lockPath)
    }
    catch {
      // ignore
    }
  }

  if (!httpServer) {
    const existing = readExistingLock(lockPath)
    if (existing && isPidAlive(existing.pid) && existing.pid !== process.pid) {
      const url = existing.baseUrl ?? '(unknown url)'
      logger.info(
        `  ${pc.green('➜')}  ${pc.bold(serverLabel)} 已在运行 (pid ${existing.pid})，本次退出。${pc.cyan(url)}`,
      )
      process.exit(0)
    }
    const root = server.config.root
    const dir = path.dirname(lockPath)
    const doWriteLock = (payload: LockPayload): void => {
      if (!fs.existsSync(dir))
        fs.mkdirSync(dir, { recursive: true })
      const acquired = tryAcquireLockSync(lockPath, payload)
      if (!acquired) {
        logger.info(`  ${pc.green('➜')}  ${pc.bold(serverLabel)} 锁被占用，本次退出。`)
        process.exit(0)
      }
    }
    let settled = false
    const start = Date.now()
    const id = setInterval(() => {
      if (settled)
        return
      const fromFile = readDevLockFile(root)
      if (fromFile && fromFile.port > 0 && fromFile.port <= 65535) {
        settled = true
        clearInterval(id)
        doWriteLock({ pid: process.pid, port: fromFile.port, baseUrl: fromFile.baseUrl })
        return
      }
      if (Date.now() - start >= DEV_LOCK_TIMEOUT_MS) {
        settled = true
        clearInterval(id)
        const fallback = fallbackBaseUrlAndPort(server.config as ResolvedConfigLike)
        if ((server.config as ResolvedConfigLike)?.server?.middlewareMode) {
          logger.warn(
            `  ${pc.yellow('➜')} 未读到 .dev/dev.lock.json，使用回退端口 ${fallback.port}。请在 nuxt.config 的 modules 中加入 "unplugin-singleton/nuxt" 以写入锁文件。`,
          )
        }
        doWriteLock({ pid: process.pid, port: fallback.port, baseUrl: fallback.baseUrl })
      }
    }, DEV_LOCK_POLL_MS)
    process.once('SIGINT', removeLock)
    process.once('SIGTERM', removeLock)
    process.on('exit', removeLock)
    return
  }

  const existing = readExistingLock(lockPath)
  if (existing && isPidAlive(existing.pid) && existing.pid !== process.pid) {
    const url = existing.baseUrl ?? '(unknown url)'
    logger.info(
      `  ${pc.green('➜')}  ${pc.bold(serverLabel)} 已在运行 (pid ${existing.pid})，本次退出。${pc.cyan(url)}`,
    )
    process.exit(0)
  }

  const onListening = (): void => {
    const addr = httpServer!.address()
    if (!addr || typeof addr !== 'object' || typeof (addr as { port?: number }).port !== 'number') {
      throw new Error('[unplugin-singleton] 无法从 httpServer.address() 获取 port')
    }
    const a = addr as { address?: string, port: number }
    const baseUrl = baseUrlFromAddr(a, server.config as { server?: { https?: boolean } })
    const payload: LockPayload = { pid: process.pid, port: a.port, baseUrl }
    const dir = path.dirname(lockPath)
    if (!fs.existsSync(dir))
      fs.mkdirSync(dir, { recursive: true })
    const acquired = tryAcquireLockSync(lockPath, payload)
    if (!acquired) {
      logger.info(`  ${pc.green('➜')}  ${pc.bold(serverLabel)} 锁被占用，本次退出。`)
      process.exit(0)
    }
  }

  if (httpServer.listening) {
    onListening()
  }
  else {
    httpServer.once('listening', onListening)
  }

  httpServer.once('close', removeLock)
  process.once('SIGINT', removeLock)
  process.once('SIGTERM', removeLock)
  process.on('exit', removeLock)
}

function createPluginBody(): { name: string, configureServer: (server: ViteServer) => void, configurePreviewServer: (server: ViteServer) => void } {
  return {
    name: PLUGIN_NAME,
    configureServer(server) {
      const root = server.config.root
      ensureGitignoreDev(root)
      const { devLockPath } = lockPaths(root)
      setupLockOnServer(server, devLockPath, 'dev')
    },
    configurePreviewServer(server) {
      const { previewLockPath } = lockPaths(server.config.root)
      setupLockOnServer(server, previewLockPath, 'preview')
    },
  }
}

export const unpluginFactory = (_options?: unknown, _meta?: unknown): ReturnType<typeof createPluginBody> => createPluginBody()
export const unplugin = /* #__PURE__ */ createUnplugin(unpluginFactory)

export { fallbackBaseUrlAndPort, isPidAlive, lockPaths, readDevLockFile, readExistingLock, tryAcquireLockSync }
export default unplugin

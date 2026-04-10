import type { LockPayload } from './types';
/**
 * Nuxt 模块：在 listen 时写入统一的 .dev/dev.lock.json（与 Vite 插件相同格式），
 * 关闭时删除。不注册 Vite 插件，逻辑完全在本模块内。
 * 用法：nuxt.config 的 modules 里加 'unplugin-singleton/nuxt' 即可。
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { defineNuxtModule } from '@nuxt/kit';
import { NUXT_CONFIG_KEY, NUXT_MODULE_NAME } from './constants';
import { ensureDevDirGitignore } from './gitignore';

const DEV_LOCK_FILE = '.dev/dev.lock.json';
const KILL_FLAGS = new Set(['-k', '--kill']);

const TRAILING_SLASHES_RE = /\/+$/;
type LoggerLike = { info?: (s: string) => void; warn?: (s: string) => void };

function resolveLogger(nuxt: unknown): LoggerLike {
  if (typeof nuxt !== 'object' || nuxt === null) return {};
  const raw = (nuxt as { logger?: unknown }).logger;
  if (!raw || typeof raw !== 'object') return {};
  return raw as LoggerLike;
}

function logInfo(logger: LoggerLike, msg: string): void {
  if (typeof logger.info === 'function') {
    logger.info(msg);
    return;
  }
  console.info(msg);
}

function logError(logger: LoggerLike, msg: string): void {
  if (typeof logger.warn === 'function') {
    logger.warn(msg);
    return;
  }
  console.error(msg);
}

function hasKillFlag(): boolean {
  return process.argv.some((arg) => KILL_FLAGS.has(arg));
}

function tryKillExistingPid(pid: number, logger: LoggerLike): boolean {
  if (pid <= 0) return false;
  try {
    process.kill(pid, 'SIGTERM');
    logInfo(
      logger,
      `[unplugin-singleton] 已执行 --kill：向旧实例发送 SIGTERM（pid=${pid}），正在接管。`,
    );
    return true;
  } catch {
    return false;
  }
}

function readExistingLock(lockFilePath: string): LockPayload | null {
  try {
    const raw = fs.readFileSync(lockFilePath, 'utf8');
    const data = JSON.parse(raw) as { pid?: number; port?: number; baseUrl?: string };
    return data &&
      typeof data.pid === 'number' &&
      typeof data.port === 'number' &&
      typeof data.baseUrl === 'string'
      ? { pid: data.pid, port: data.port, baseUrl: data.baseUrl }
      : null;
  } catch {
    return null;
  }
}

function isPidAlive(pid: number): boolean {
  if (pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function tryAcquireLockSync(lockFilePath: string, payload: LockPayload): boolean {
  try {
    const fd = fs.openSync(lockFilePath, 'wx');
    try {
      fs.writeFileSync(fd, JSON.stringify(payload, null, 2), 'utf8');
      return true;
    } finally {
      fs.closeSync(fd);
    }
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'EEXIST') throw err;
    const existing = readExistingLock(lockFilePath);
    if (!existing) return false;
    if (existing.pid === process.pid) {
      try {
        fs.writeFileSync(lockFilePath, JSON.stringify(payload, null, 2), 'utf8');
        return true;
      } catch {
        return false;
      }
    }
    if (isPidAlive(existing.pid)) return false;
    try {
      fs.unlinkSync(lockFilePath);
    } catch {
      // ignore
    }
    try {
      const fd = fs.openSync(lockFilePath, 'wx');
      try {
        fs.writeFileSync(fd, JSON.stringify(payload, null, 2), 'utf8');
        return true;
      } finally {
        fs.closeSync(fd);
      }
    } catch (err2: unknown) {
      if ((err2 as NodeJS.ErrnoException).code !== 'EEXIST') return false;
      throw err2;
    }
  }
}

function removeLockFile(rootDir: string): void {
  const p = path.join(rootDir, DEV_LOCK_FILE);
  try {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch {
    // ignore
  }
}

export default defineNuxtModule({
  meta: {
    name: NUXT_MODULE_NAME,
    configKey: NUXT_CONFIG_KEY,
  },
  setup(_options, nuxt) {
    const rootDir = nuxt.options.rootDir;
    const logger = resolveLogger(nuxt);
    ensureDevDirGitignore(rootDir);
    const lockPath = path.join(rootDir, DEV_LOCK_FILE);
    const existing = readExistingLock(lockPath);
    if (existing && isPidAlive(existing.pid) && existing.pid !== process.pid) {
      if (hasKillFlag() && tryKillExistingPid(existing.pid, logger)) {
        // 继续启动，由后续写锁判断是否成功接管
      } else {
        logError(
          logger,
          `[unplugin-singleton] 该应用程序只允许同时运行一个 dev 实例。检测到已有实例正在运行（pid=${existing.pid}），当前进程已退出。若需接管，请在命令后追加 \`--kill\`（或 \`-k\`），例如：\`nuxt dev --kill\`。`,
        );
        process.exit(1);
      }
    }

    const writeLock = (port: number, baseUrl: string): void => {
      if (!port || port <= 0 || port > 65535 || !baseUrl) return;
      const existing = readExistingLock(lockPath);
      if (existing && isPidAlive(existing.pid) && existing.pid !== process.pid) {
        logError(
          logger,
          `[unplugin-singleton] 该应用程序只允许同时运行一个 dev 实例。检测到已有实例正在运行（pid=${existing.pid}），当前进程已退出。若需接管，请在命令后追加 \`--kill\`（或 \`-k\`），例如：\`nuxt dev --kill\`。`,
        );
        process.exit(1);
      }
      const dir = path.dirname(lockPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const payload: LockPayload = {
        pid: process.pid,
        port,
        baseUrl: String(baseUrl).replace(TRAILING_SLASHES_RE, ''),
      };
      const acquired = tryAcquireLockSync(lockPath, payload);
      if (!acquired) {
        logError(
          logger,
          '[unplugin-singleton] 该应用程序只允许同时运行一个 dev 实例。检测到实例锁已被占用，当前进程已退出。若需接管，请在命令后追加 `--kill`（或 `-k`），例如：`nuxt dev --kill`。',
        );
        process.exit(1);
      }
    };

    const removeLock = (): void => removeLockFile(rootDir);

    nuxt.hook('listen', (_server: unknown, listener: unknown): void => {
      const l = listener as Record<string, unknown> | undefined;
      const url: string | undefined =
        typeof l?.url === 'string'
          ? l.url
          : Array.isArray(l?.listeners) &&
              l.listeners[0] &&
              typeof (l.listeners[0] as Record<string, unknown>)?.url === 'string'
            ? (l.listeners[0] as { url: string }).url
            : Array.isArray(l?.urls)
              ? (l.urls[0] as string | undefined)
              : undefined;
      if (!url) return;
      const baseUrl = String(url).replace(TRAILING_SLASHES_RE, '');
      const parsed = baseUrl.startsWith('http') ? new URL(baseUrl) : new URL(`http://${baseUrl}`);
      const port = Number(parsed.port);
      writeLock(port, baseUrl);
    });

    nuxt.hook('close', () => {
      removeLock();
    });

    process.once('SIGINT', removeLock);
    process.once('SIGTERM', removeLock);
    process.on('exit', removeLock);
  },
});

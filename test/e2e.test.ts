import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import kill from 'tree-kill';
import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test';

const rootDir = path.resolve(__dirname, '..');
const DEV_LOCK = '.dev/dev.lock.json';
const vpBin = 'vp';

type SpawnedProc = ReturnType<typeof spawn>;

async function waitForDevLock(
  cwd: string,
  proc?: SpawnedProc,
  procLabel = 'dev-server',
  timeout = 30_000,
): Promise<string> {
  const lockPath = path.join(cwd, DEV_LOCK);
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (proc && proc.exitCode !== null) {
      throw new Error(
        `${procLabel} 提前退出（exitCode=${proc.exitCode}），锁文件未生成: ${lockPath}`,
      );
    }
    if (fs.existsSync(lockPath)) {
      const raw = fs.readFileSync(lockPath, 'utf8');
      const data = JSON.parse(raw) as { pid?: number; port?: number; baseUrl?: string };
      if (typeof data?.port === 'number' && data.port > 0 && data.baseUrl) return lockPath;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`${cwd}/${DEV_LOCK} 未在 ${timeout}ms 内出现且含有效 port/baseUrl`);
}

function spawnVp(args: string[], cwd: string) {
  const options = {
    cwd,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  } as const;
  if (process.platform === 'win32') {
    const comspec = process.env.ComSpec ?? 'cmd.exe';
    return spawn(comspec, ['/d', '/s', '/c', vpBin, ...args], options);
  }
  return spawn(vpBin, args, options);
}

function killProc(proc: ReturnType<typeof spawn>): Promise<void> {
  if (!proc) return Promise.resolve();
  if (!proc.pid) return Promise.resolve();
  return new Promise((resolve) => kill(proc.pid!, 'SIGTERM', () => resolve()));
}

describe('e2e', () => {
  describe('nuxt', () => {
    const cwd = path.join(rootDir, 'playground/nuxt');
    const lockPath = path.join(cwd, DEV_LOCK);
    let proc: ReturnType<typeof spawn>;

    beforeAll(async () => {
      proc = spawnVp(['exec', 'nuxt', 'dev', '--host', '127.0.0.1', '--port', '3000'], cwd);
      await waitForDevLock(cwd, proc, 'nuxt-dev');
    }, 40_000);

    afterAll(() => killProc(proc));

    it('插件写入 .dev/dev.lock.json 且含 pid、port、baseUrl', () => {
      expect(fs.existsSync(lockPath)).toBe(true);
      const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as {
        pid?: number;
        port?: number;
        baseUrl?: string;
      };
      expect(lock).toHaveProperty('pid');
      expect(typeof lock.pid).toBe('number');
      expect(lock).toHaveProperty('port');
      expect(typeof lock.port).toBe('number');
      expect(lock.port).toBeGreaterThan(0);
      expect(lock.port).toBeLessThanOrEqual(65535);
      expect(lock).toHaveProperty('baseUrl');
      expect(String(lock.baseUrl)).toContain(String(lock.port));
    });
  });

  describe('vite', () => {
    const cwd = path.join(rootDir, 'playground/vite');
    const lockPath = path.join(cwd, DEV_LOCK);
    let proc: ReturnType<typeof spawn>;

    beforeAll(async () => {
      proc = spawnVp(['dev', '--host', '127.0.0.1', '--port', '5173'], cwd);
      await waitForDevLock(cwd, proc, 'vite-dev');
    }, 40_000);

    afterAll(() => killProc(proc));

    it('插件写入 .dev/dev.lock.json 且含 pid、port、baseUrl', () => {
      expect(fs.existsSync(lockPath)).toBe(true);
      const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as {
        pid?: number;
        port?: number;
        baseUrl?: string;
      };
      expect(lock).toHaveProperty('pid');
      expect(typeof lock.pid).toBe('number');
      expect(lock).toHaveProperty('port');
      expect(typeof lock.port).toBe('number');
      expect(lock.port).toBeGreaterThan(0);
      expect(lock.port).toBeLessThanOrEqual(65535);
      expect(lock).toHaveProperty('baseUrl');
      expect(String(lock.baseUrl)).toContain(String(lock.port));
    });
  });
});

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import kill from 'tree-kill';
import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test';

const rootDir = path.resolve(__dirname, '..');
const DEV_LOCK = '.dev/dev.lock.json';
const vpBin = process.platform === 'win32' ? 'vp.cmd' : 'vp';

async function waitForDevLock(cwd: string, timeout = 30_000): Promise<string> {
  const lockPath = path.join(cwd, DEV_LOCK);
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (fs.existsSync(lockPath)) {
      const raw = fs.readFileSync(lockPath, 'utf8');
      const data = JSON.parse(raw) as { pid?: number; port?: number; baseUrl?: string };
      if (typeof data?.port === 'number' && data.port > 0 && data.baseUrl) return lockPath;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`${cwd}/${DEV_LOCK} 未在 ${timeout}ms 内出现且含有效 port/baseUrl`);
}

async function waitForLockPidChange(cwd: string, oldPid: number, timeout = 30_000): Promise<number> {
  const lockPath = path.join(cwd, DEV_LOCK);
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (fs.existsSync(lockPath)) {
      const raw = fs.readFileSync(lockPath, 'utf8');
      const data = JSON.parse(raw) as { pid?: number };
      if (typeof data.pid === 'number' && data.pid > 0 && data.pid !== oldPid) return data.pid;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`锁文件 PID 未在 ${timeout}ms 内从 ${oldPid} 切换`);
}

function isPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function spawnVp(args: string[], cwd: string) {
  return spawn(vpBin, args, {
    cwd,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  });
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
      await waitForDevLock(cwd);
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

  describe('nuxt --kill takeover', () => {
    const cwd = path.join(rootDir, 'playground/nuxt');
    const lockPath = path.join(cwd, DEV_LOCK);
    let proc1: ReturnType<typeof spawn>;
    let proc2: ReturnType<typeof spawn>;

    afterAll(async () => {
      await killProc(proc2);
      await killProc(proc1);
    });

    it('第二个实例携带 --kill 时可接管并更新锁文件 pid', async () => {
      proc1 = spawnVp(['exec', 'nuxt', 'dev', '--host', '127.0.0.1', '--port', '3011'], cwd);
      await waitForDevLock(cwd, 40_000);
      const lock1 = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as { pid?: number };
      expect(typeof lock1.pid).toBe('number');
      const firstPid = lock1.pid as number;

      proc2 = spawnVp(
        ['exec', 'nuxt', 'dev', '--host', '127.0.0.1', '--port', '3011', '--kill'],
        cwd,
      );
      const secondPid = await waitForLockPidChange(cwd, firstPid, 40_000);
      expect(secondPid).not.toBe(firstPid);

      // 允许系统信号传递有轻微延迟
      await new Promise((r) => setTimeout(r, 400));
      expect(isPidAlive(firstPid)).toBe(false);
      expect(isPidAlive(secondPid)).toBe(true);
    }, 70_000);
  });

  describe('vite', () => {
    const cwd = path.join(rootDir, 'playground/vite');
    const lockPath = path.join(cwd, DEV_LOCK);
    let proc: ReturnType<typeof spawn>;

    beforeAll(async () => {
      proc = spawnVp(['dev', '--host', '127.0.0.1', '--port', '5173'], cwd);
      await waitForDevLock(cwd);
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

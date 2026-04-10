import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureDevDirGitignore } from '../src/gitignore';

const base = path.join(os.tmpdir(), `singleton-gitignore-${Date.now()}`);

afterEach(() => {
  try {
    fs.rmSync(base, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe('ensureDevDirGitignore', () => {
  it('创建 .dev/.gitignore 且内容为 *', () => {
    const root = path.join(base, 'a');
    fs.mkdirSync(root, { recursive: true });
    ensureDevDirGitignore(root);
    expect(fs.readFileSync(path.join(root, '.dev', '.gitignore'), 'utf8')).toBe('*\n');
  });

  it('已有内容不是 *\\n 时覆盖为 *', () => {
    const root = path.join(base, 'b');
    const devDir = path.join(root, '.dev');
    fs.mkdirSync(devDir, { recursive: true });
    fs.writeFileSync(path.join(devDir, '.gitignore'), 'custom\n', 'utf8');
    ensureDevDirGitignore(root);
    expect(fs.readFileSync(path.join(devDir, '.gitignore'), 'utf8')).toBe('*\n');
  });
});

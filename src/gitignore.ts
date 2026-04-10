/**
 * 在 `<root>/.dev/.gitignore` 写入 `*`，不修改项目根 `.gitignore`。
 */
import fs from 'node:fs';
import path from 'node:path';

const CONTENT = '*\n';

export function ensureDevDirGitignore(rootDir: string): void {
  const devDir = path.join(rootDir, '.dev');
  const gitignorePath = path.join(devDir, '.gitignore');
  try {
    try {
      if (fs.readFileSync(gitignorePath, 'utf8') === CONTENT) return;
    } catch {
      // 文件不存在则继续写入
    }
    if (!fs.existsSync(devDir)) fs.mkdirSync(devDir, { recursive: true });
    fs.writeFileSync(gitignorePath, CONTENT, 'utf8');
  } catch {
    // 无写权限或只读时忽略
  }
}

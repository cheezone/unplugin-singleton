/**
 * 在使用方项目根目录的 .gitignore 中追加 .dev（若尚未存在）。
 */
import fs from 'node:fs';
import path from 'node:path';

const GITIGNORE_ENTRY = '.dev';
const COMMENT = '# unplugin-singleton';

const LINE_SPLIT_RE = /\r?\n/;
export function ensureGitignoreDev(rootDir: string): void {
  const gitignorePath = path.join(rootDir, '.gitignore');
  let content: string;
  try {
    content = fs.readFileSync(gitignorePath, 'utf8');
  } catch {
    content = '';
  }
  const lines = content.split(LINE_SPLIT_RE).map((line) => line.trim());
  const hasDev = lines.some(
    (line) => line === GITIGNORE_ENTRY || line === '.dev/' || line === '/.dev',
  );
  if (hasDev) return;
  const addition =
    content.length > 0 && !content.endsWith('\n')
      ? `\n${COMMENT}\n${GITIGNORE_ENTRY}\n`
      : `${COMMENT}\n${GITIGNORE_ENTRY}\n`;
  try {
    fs.appendFileSync(gitignorePath, addition);
  } catch {
    // 无写权限或只读时忽略
  }
}

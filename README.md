# unplugin-singleton

[![NPM version](https://img.shields.io/npm/v/unplugin-singleton?color=a1b858&label=)](https://www.npmjs.com/package/unplugin-singleton)

[Unplugin](https://unplugin.unjs.io/) 约定：**单例** dev/preview，就绪后写入锁文件（`pid`、`port`、`baseUrl`），供 E2E、脚本读取。
dev 与 preview 各一把锁，路径固定为项目 root 下的 `.dev/`。

## 安装

```bash
pnpm add -D unplugin-singleton
# or
npm i -D unplugin-singleton
```

## 使用

**Vite**（推荐用子路径 `/vite`）：

```js
// vite.config.js / vite.config.ts
import Singleton from 'unplugin-singleton/vite';

export default defineConfig({
  plugins: [Singleton()],
});
```

也可 `import p from 'unplugin-singleton'; plugins: [p.vite()]`。

## 锁文件

- **dev**：dev 服务器就绪后写入 **`<root>/.dev/dev.lock.json`**，关闭时删除。
- **preview**：preview 就绪后写入 **`<root>/.dev/preview.lock.json`**，关闭时删除。

格式（两者相同）：

```json
{
  "pid": 12345,
  "port": 5173,
  "baseUrl": "http://localhost:5173"
}
```

- **pid**：当前进程 PID，用于单例检测（锁存在且 pid 存活则不再起第二个）。
- **port**：实际监听端口。
- **baseUrl**：可直接用于 E2E 或脚本的根 URL。

Monorepo 下每个 app 用自己的 root，锁自然落在各自 root 的 `.dev/` 下，无需额外配置。

首次运行时会确保 **`<root>/.dev/.gitignore`** 为一行 `*`（忽略 `.dev` 下全部文件），**不会**修改项目根目录的 `.gitignore`。

## Nuxt

子路径 `unplugin-singleton/nuxt`，只加 **modules** 即可（不注册 Vite 插件，逻辑在模块内完成）：

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['unplugin-singleton/nuxt'],
  devServer: { port: 3200 }, // 可选，默认 3000
});
```

模块在 `listen` 时写入**与 Vite 相同的** `.dev/dev.lock.json`（pid、port、baseUrl），关闭时删除。输出格式与 Vite 下一致，无 Nuxt 专用文件。

## 消费者示例（Shell）

读取 dev baseUrl：

```bash
BASE_URL=$(node -e "console.log(JSON.parse(require('fs').readFileSync('.dev/dev.lock.json','utf8')).baseUrl)")
```

读取 preview baseUrl：

```bash
BASE_URL=$(node -e "console.log(JSON.parse(require('fs').readFileSync('.dev/preview.lock.json','utf8')).baseUrl)")
```

## 开发

- 监听构建：`vp run dev`
- 测试：`vp test`
- 构建：`vp run build`
- Vite playground：`vp run play:vite`
- Nuxt playground：`vp run play:nuxt`

## License

MIT

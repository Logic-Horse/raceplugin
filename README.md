# 賽馬熱錢流（浏览器扩展）

面向香港赛马会投注站点（`bet.hkjc.com` / `speedbet.hkjc.com`）的 **Chrome Manifest V3** 扩展，提供热钱流相关快速投注与界面增强。本仓库说明如何本地开发与加载调试。

## 环境要求

- **Google Chrome**（或基于 Chromium 的浏览器，需支持 Manifest V3）
- 无需 Node.js / 构建步骤；扩展以静态资源形式直接加载

## 仓库结构

| 路径 | 说明 |
|------|------|
| 仓库根目录 | 当前主线扩展包（`manifest.json` 中版本见各文件） |
| `raceplugincode/` | 另一套并行源码（名称与版本与根目录可能不同，含控制台相关页面与样式等） |

两套目录均包含 `manifest.json`、`background.js`（Service Worker）、`popup.html` / `popup.js`、注入页面的 `init.js` 与样式等。开发时请**选定其中一个目录**作为「扩展根目录」加载，避免混用路径。

## 本地加载（开发者模式）

1. 打开 Chrome，地址栏输入 `chrome://extensions/`。
2. 打开右上角 **开发者模式**。
3. 点击 **加载已解压的扩展程序**。
4. 选择本仓库中的扩展根目录（例如根目录 `raceplugin/`，或 `raceplugin/raceplugincode/`）。
5. 修改代码后，在扩展卡片上点击 **重新加载** 即可生效。

调试建议：

- **弹出页**：扩展图标右键 →「检查弹出内容」，或从 `chrome://extensions` 进入弹出页开发者工具。
- **后台**：`chrome://extensions` → 对应扩展 →「Service Worker」旁的「检查视图」。
- **内容脚本**：在已注入的 HKJC 投注页按 F12，在 Console / Sources 中查看（脚本在页面上下文中运行）。

## 扩展组成（概要）

- **`manifest.json`**：扩展元数据、权限、`content_scripts` 匹配规则、Service Worker 与弹出页入口。
- **`background.js`**：后台 Service Worker（如图标切换、标签页与消息等逻辑）。
- **`popup.html` / `popup.js`**：工具栏图标点击后的弹出界面。
- **内容脚本**（在 `manifest.json` 的 `content_scripts` 中声明）：如 `jquery.js`、`init.js`、`cors.js` 等，在匹配的 HKJC 页面 `document_end` 注入；`mf007_styles.css` 为页面样式。

权限与 `host_permissions` 仅限 manifest 中列出的 HKJC 相关域名，修改域名或接口时需同步更新 `manifest.json`。

## 发布打包

在扩展根目录内选取扩展所需全部文件（与 `manifest.json` 引用一致），打包为 zip 即可用于上架或离线安装。**不要**把 `.git` 或无关说明文件打进包里，除非你有意包含。

## 许可与声明

若本仓库未包含许可证文件，使用前请与项目维护者确认授权范围。涉及第三方投注与资金操作，请遵守当地法律法规及香港赛马会服务条款。

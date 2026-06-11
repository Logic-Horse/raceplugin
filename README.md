# 賽馬注單助手

面向香港赛马会投注站点（`bet.hkjc.com`）的 **Chrome Manifest V3** 浏览器扩展。提供高密度注单界面，点击工具栏图标在浏览器**右侧边栏**打开，不遮挡马会主页；支持将注项同步至 HKJC 投注区。

## 环境要求

- **Google Chrome** 114+（或支持 Manifest V3 与 Side Panel API 的 Chromium 内核浏览器）
- 无需 Node.js；扩展为静态资源，可直接加载或 zip 安装

## 仓库结构

| 路径 | 说明 |
|------|------|
| `extension/` | 扩展源码（加载或打包时使用此目录） |
| `extension/manifest.json` | 扩展元数据、权限、版本号 |
| `extension/background.js` | Service Worker（边栏、消息转发、脚本注入） |
| `extension/popup.html` / `popup.js` / `popup.css` | 注单侧栏界面 |
| `extension/content-hkjc.js` | 注入 `bet.hkjc.com` 的内容脚本 |
| `scripts/package.sh` | 本地打包脚本 |
| `.github/workflows/release.yml` | 推送 `v*` 标签时自动打包并创建 GitHub Release |

## 安装（Release 包）

1. 打开 [Releases](https://github.com/Logic-Horse/raceplugin/releases) 页面，下载最新 `Logic_投注助手_v*_*.zip`。
2. 解压到任意文件夹。
3. Chrome 地址栏输入 `chrome://extensions/`。
4. 开启右上角 **开发者模式**。
5. 点击 **加载已解压的扩展程序**，选择解压后的文件夹（内含 `manifest.json`）。

## 本地开发

1. 打开 `chrome://extensions/`，开启 **开发者模式**。
2. **加载已解压的扩展程序**，选择本仓库的 `extension/` 目录。
3. 修改代码后，在扩展卡片上点击 **重新加载**。

调试建议：

- **侧栏界面**：点击扩展图标打开侧栏 → 侧栏内右键 →「检查」。
- **Service Worker**：`chrome://extensions` → 对应扩展 →「Service Worker」旁的「检查视图」。
- **内容脚本**：在已打开的 `bet.hkjc.com` 投注页按 F12，于 Console / Sources 中查看。

## 打包

版本号以 `extension/manifest.json` 中的 `"version"` 为准。

```bash
./scripts/package.sh
```

输出：`dist/Logic_投注助手_v{版本}_{YYYYMMDD}.zip`（zip 根目录即为扩展文件，可直接用于加载或发布）。

## 发布 Release

**自动（推荐）**：有仓库写权限时，推送与 manifest 版本对应的标签即可触发 CI：

```bash
git tag v1.0.0
git push origin v1.0.0
```

GitHub Actions 会自动打包并在 [Releases](https://github.com/Logic-Horse/raceplugin/releases) 上传 zip。

**手动**：在 GitHub 仓库 **Releases → Draft a new release** 中创建 tag、填写说明，并上传 `./scripts/package.sh` 生成的 zip。

## 许可与声明

使用本扩展涉及第三方投注操作，请遵守当地法律法规及香港赛马会服务条款。若需商用或二次分发，请与项目维护者确认授权。

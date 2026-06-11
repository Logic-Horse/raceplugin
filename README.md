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

## 马会同步优化说明

针对「同步慢（胆拖 5–6 秒）」与「金额写入后仍为 $10、预览/发送不一致」等问题，采用**分层优化**：导航可快、填额必慢、验收必严。当前内容脚本版本为 **v50**（与 `background.js` 中 `HKJC_CONTENT_SCRIPT_VERSION` 一致）；修改 `content-hkjc.js` 后须在 `chrome://extensions` **重新加载扩展**，并**刷新马会投注页**，否则会沿用旧脚本。

### 背景问题

| 现象 | 原因 |
|------|------|
| 胆拖 6–7 匹马同步约 5–6 秒 | 每场全页扫 checkbox、重复 `waitForRaceReady`、逐条勾选+填额串行 |
| 输入框显示 $160，总投/预览却是 $10 | React 受控输入：DOM `input.value` 已变，但马会内部状态未提交 |
| 曾尝试全局 `activeSyncFast` 加速 | 缩短填额等待导致上述金额问题，已**不采用**该方案 |

### 优化分层（P0–P5）

| 阶段 | 目标 | 要点 |
|------|------|------|
| **P0** 金额验收 | 杜绝「看起来填对了」 | 读注单行「投注金额」小计 + 底部「总投注金额」；`HKJC_STAKE_TOTAL_MISMATCH` 时同步失败 |
| **P1** 填额慢路径 | 填额与导航节奏隔离 | 仅 `typeStakeIntoInput`（`stakeFill` 模式），不用 paste；专用 `stakeFillPollMs` 等常量 |
| **P2** 两阶段同步 | 勾选与填额解耦 | 阶段一：批量加入投注区（默认 $10）；阶段二：`fillStakeEntriesPhase2` 统一慢填 + 补扫 |
| **P3** 胆拖导航 | 只加速勾选/切 tab | `isRaceDomReady` 跳过等待；`uncheckQinTableForRace` 替代全页清空；胆拖模式已激活则跳过切换 |
| **P4** Direct Panel | 同场次最快路径 | 直接向 `#betslip-panel` 注入 `.bet-line`，失败则 `removeRacepluginInjectedLines` 并回退点击路径；`preferDirectPanel: true` |
| **P5** 确认闸门 | 用户侧最后一道关 | 同步成功后 popup 再验总投，绿色条「可发送」/ 红色条「请勿发送」 |

### 同步路径（优先级）

```
preferDirectPanel + 场次一致 + 有投注区
  → Direct Panel（direct-slip-primary）
  → 失败则清除注入行 → semi-auto-click-two-phase（勾选路径）
```

填额逻辑在 Direct 与点击两条路径上均走 **P1 慢填 + P0 验收**。

### 相关配置（`popup.js` → `buildHkjcSyncPayload`）

- `preferDirectPanel: true` — 优先快速注入（P4）
- `strictSamePage: true` — 不自动跳转马会页，避免清空未发送注项
- `syncMode: "direct-or-click"` — 先 Direct，再点击回退

## 建议测试内容

测试前请：**重新加载扩展** → 打开/刷新 `bet.hkjc.com` 并登录 → 侧栏场次与马会页顶栏**同场同马场**。

### 1. 独赢多马 + 金额正确性（P0 / P1 / P2 / P5）

1. 侧栏加入 3 匹独赢，金额例如 **$160、$20、$120**（总预期 **$300**）。
2. 点击「同步到马会」。
3. **预期**：
   - 马会投注区出现 3 行，底部「总投注金额」为 **$300**（不是 $140 等错误合计）。
   - 侧栏按钮区出现**绿色持久提示**：总投已核对一致，可按「发送注项」。
4. 在马会点「发送注项」→ 预览：三笔金额分别为 $160、$20、$120。

### 2. 连赢胆拖速度（P2 / P3）

1. 手动打开马会 **连赢 → 胆拖**，并选好对应场次。
2. 侧栏 1 胆拖 **6–7 脚**（同金额），同步。
3. **预期**：明显快于优化前（目标约 **2–4 秒** 量级，视网络与页面而定）；投注区一行胆拖，注数与脚数一致，金额正确。

### 3. Direct Panel 与回退（P4）

1. 同场次、右侧已有投注区时同步 2–3 项独赢。
2. **预期**：几乎瞬间出现注单行，再逐行变为正确金额；`mode` 为 `direct-slip-primary`（开发者可在 content 响应中查看）。
3. 若 Direct 验收失败：应自动回退点击路径，且**不重复**残留注入行。

### 4. 失败与闸门（P0 / P5）

1. 若总投与插件预期不符：同步应 **失败** 或侧栏显示**红色持久条**「请勿发送注项」。
2. **勿**在红色提示下点击马会「发送注项」；应刷新马会页后重试同步。

### 5. 回归检查清单

- [ ] 仅同步当前 Tab 玩法（独赢/位置/连赢/位置Q），不会把其他 Tab 注项写入马会
- [ ] 同步成功后后端记录（已登录时）与马会写入项一致
- [ ] 场次不一致时提示 `PAGE_MISMATCH`，不强行改 URL
- [ ] 修改代码并 bump 版本后，旧 content script 会被强制重新注入（ping 版本不符）

## 许可与声明

使用本扩展涉及第三方投注操作，请遵守当地法律法规及香港赛马会服务条款。若需商用或二次分发，请与项目维护者确认授权。

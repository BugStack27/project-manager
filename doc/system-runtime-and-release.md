---
date: 2026-10-31
description: 窗口关闭驻留托盘与退出询问、独立启动窗与白屏消除、打包版自动更新、tag 触发的发布流水线与崩溃留痕诊断包
status: accepted
---

# 系统运行与发布 — 决策记录

> 状态：✅ 已验收（2026-10-31）

## 1. 目标与范围

本篇记录应用「从启动到退出、从打包到发版」的既定契约：关闭窗口驻留托盘、真正退出前的进程处置、启动窗与首屏显示时机、最小化恢复的渲染降级、打包版自动更新、GitHub Actions 发版流水线，以及主 / 渲染 / 子进程异常与诊断包。

- **做**：托盘驻留与恢复、退出询问与清理链路、启动加载窗与 `pm:renderer-ready`、恢复白屏的三项 Chromium 开关、`electron-updater` 状态机、`v*` 标签发布与版本一致性校验、崩溃落盘与诊断包导出。
- **不做**：开机自启与托盘状态提示、静默下载 / 强制升级 / 灰度渠道、macOS 与 Linux 的 CI 构建、崩溃自动上传与聚合、把业务内容写进诊断包。
- 相关文档：分离进程的运行态见 `doc/launch-and-runs.md`；备份恢复守卫见 `doc/backup-and-restore.md`；渲染端壳层与 `App.jsx` 分模块见 `doc/app-shell-and-navigation.md`；IPC 通道与 runner 分层见 `doc/architecture-and-channels.md`。

## 2. 关键决策

| 决策点 | 结论 | 理由 |
|---|---|---|
| 关闭语义 | 非退出流程拦截主窗口 `close`，隐藏窗口驻留托盘，不弹确认 | 后台任务与 MCP HTTP 服务需继续运行；重复确认只会增加摩擦 |
| 恢复白屏 | 遮挡检测与后台降级两类开关同时开，且窗口 `backgroundThrottling: false` | 两条成因互不替代，只修一层仍会白 |
| 更新权限 | 只对打包版启用，开发态直接短路为 `unsupported` | 开发机没有 `app-update.yml`，检查只会产出无意义错误 |
| 安装时机 | `autoDownload = false`、`autoInstallOnAppQuit = false`，下载与安装均由用户点击 | 机器上可能在跑安装或容器，静默拉包与静默重启不可接受 |
| 发版触发 | 推 `v*` 标签跑 Actions，构建前校验 tag 与 `package.json.version` 一致 | `latest.yml` 版本取自 `package.json`，对不上会发出装不上的更新 |

### 2.1 托盘与窗口生命周期

- **驻留与恢复**：左键 `click` 恢复并聚焦主窗口，右键菜单提供「显示主窗口 / 退出」；`showMainWindow` 统一负责显示 / 聚焦 / 异常销毁后重建，`second-instance` 复用它，多入口行为一致。
- **图标资源**：`tray/tray-{16,20,24,28,32,36,40,48}.png` 每个尺寸独立原生栅格化（4×4 超采样），不重采样；按主屏 `scaleFactor` 取最接近尺寸，`display-metrics-changed` 时 `setImage` 换图。
- **应用图标**：`build/icon.ico`（16/24/32/48/64/128/256；小尺寸 DIB、大尺寸 PNG）由 `scripts/make-app-icon.js` 生成，字形与托盘同源但四周留 1 网格单位；`build.win.icon` 与 `nsis.installerIcon` / `uninstallerIcon` 都指向它，`electron/assets/app-icon.png` 给 `BrowserWindow.icon` 用。
- **资源定位与缺失**：路径由 `__dirname` 拼 `assets/tray`，不依赖 `cwd`；取不到依次退到 16 / 48，仍失败则抛明确错误，让打包漏资源在启动日志里被点名。
- **退出链路**：托盘「退出」走 `app.quit()`，复用 `before-quit` → `shutdown()` → `app.exit(0)`，退出前 `tray.destroy()`；`window-all-closed` 仅在 `quitting` 为真时退出。
- **退出询问**：有活动命令时先 `showMainWindow()` 再询问「分离 / 停止 / 取消」，默认分离、Esc 取消；无活动命令保持原路径直接退出。`quitPending` 守卫挡住托盘连点与 second-instance 重复弹窗，取消后 `quitting` 仍为 false。
- **询问框形态**：主进程推 `pm:quit-ask`（次数 + 前 5 条命令），`QuitPrompt.jsx` 用应用自己的 `Modal` 自绘两个带后果说明的动作卡片；回话走独立通道 `pm:quit-answer`，不进 dispatch 能力表。
- **询问兜底**：渲染端不可用或 8 秒未回话时自动退回系统消息框，并补发 `pm:quit-ask {dismiss:true}` 收起自绘弹窗，避免两个框同时出现。
- **活动口径**：退出提示、停止并退出、恢复备份拦截统一用 `runner.isActive`，已分离但宿主仍存活的进程同样计入。

### 2.2 启动窗与白屏

- **独立加载窗**：`createSplashWindow` 建独立 `BrowserWindow` 加载 `electron/splash.html`，不在主窗口叠层；320×220、无边框、透明只浮 268px 卡片，`alwaysOnTop` / `skipTaskbar` / `focusable:false` / `showInactive`，不抢焦点、不进任务栏。
- **显示时机**：不挂 `ready-to-show` / `did-finish-load`；等 App `booted` 后双 rAF 发 `pm:renderer-ready` 才 show，绑定的就是「数据就绪后的完整首屏」。
- **最短展示与兜底**：启动窗至少展示 300ms，避免一闪而过；`reveal` 带 3s 兜底主动显示，兼容透明窗口 `ready-to-show` 不派发的情况。
- **主线程时序**：`whenReady` 先建启动窗并等其上屏，再读库 / 建 IPC / 起 MCP，避免同步初始化把窗口显示排到日志之后。
- **恢复白屏开关**：仅 win32 关闭 `CalculateNativeWinOcclusion`；追加 `disable-renderer-backgrounding`、`disable-backgrounding-occluded-windows`，并设 `backgroundThrottling: false`，避免恢复时整页重画只显示窗口底色。
- **焦点刷新**：修改记录页 focus 静默刷新延后 300ms，不与恢复首帧抢主线程。
- **启动期窗口调用**：启动期间 `showMainWindow` 被忽略，统一等 reveal 收尾。

### 2.3 自动更新

- **实现与源**：`electron-updater`；更新源由 `package.json` 的 `build.publish` 指向 GitHub 仓库，打包产出 `app-update.yml`；临时换源用 `PM_UPDATE_URL` + generic provider，只认 http(s)，避免误指 `file:`。
- **检查节奏**：启动 8 秒后首检，之后每 6 小时一轮；失败进入 `error` 相位不立即重试，下一轮仍会检查，也可由用户手动「检查更新」。
- **状态机**：`idle / checking / available / downloading / downloaded / up-to-date / error / unsupported / unconfigured`；`available` 与 `downloaded` 是两个停点，界面只吃主进程推送 `pm:update`，不本地推断「已下载」。
- **错误降级**：非打包 → `unsupported`；无更新源 → `unconfigured`；网络 / 验签失败 → `error` 并把 `ENOENT app-update.yml`、`net::ERR_*`、`sha512` 翻译成可操作提示，任何一层只降级不抛错。
- **安装前清理**：`install()` 先跑 `beforeInstall`（`shutdown('stop')`、关 MCP、存库），再 `quitAndInstall(false, true)`，绕开退出询问。
- **入口**：侧栏「设置与数据 → 检查更新」，`UpdateModal.jsx` 展示当前版本、相位文案、单一主按钮、下载进度与错误。

### 2.4 发布流水线

- 推 `v*` 标签触发 `.github/workflows/release.yml`，Windows runner 上 `npm ci` → 前端构建 → `electron-builder --publish always`；`--publish always` 才会把 exe、blockmap 与 `latest.yml` 挂到 Release。
- 构建前校验「标签去掉 `v` 前缀」与 `package.json.version` 完全一致，不一致直接失败。
- 发布权限用 `permissions.contents: write` + `GITHUB_TOKEN` 上传资产，不需要个人 PAT；按 tag 串行、不取消进行中的发布。

### 2.5 崩溃留痕与诊断包

- **记录范围**：`uncaughtException`、`unhandledRejection`、`render-process-gone`、`child-process-gone`、渲染端 `ErrorBoundary` 上报，统一写 `<数据目录>/crash/<时间戳>-<kind>.json`，按 kind 分文件便于排查。
- **原生转储**：`crashDumps` 指向 `<数据目录>/crash/dumps`，`crashReporter.start({ uploadToServer:false })`；`setPath` 必须在 ready 之前。
- **写入方式**：同步写 JSON，记录 / 剪枝 / 序列化全部包 `try/catch` 并静默失败，短崩溃路径不再抛一次。
- **保留策略**：同类最多 20 条、新的在前，按 kind 分桶剪枝，GPU 进程周期性崩溃不会挤掉主进程异常。
- **诊断包内容**：`exportedAt` + 应用与系统信息 + 全部崩溃记录 + 转储文件名 + 运行时计数（项目 / 需求 / 命令 / 运行中 / 数据目录 / MCP 端口）；不含项目内容、需求正文与 diff。
- **导出方式**：系统保存对话框默认落到下载目录 `project-manager-diag-<时间戳>.json`，导出后定位文件。
- **渲染端兜底**：`ErrorBoundary` 包住 `App`，捕获后上报 `pm:crash record` 并给出「重新加载界面 / 导出诊断包」，未捕获异常不再白屏。
- **初始化与依赖**：`crash.init({dataDir, collect})` 置于 `startGui()` 最外层、`store.configure` 与建窗之前；运行时计数由 `main.js` 注入，crash 服务不反向依赖领域层。

## 3. 交付物

| 文件（相对路径） | 职责 |
|---|---|
| `electron/main.js` | `createTray` / `refreshTrayIcon` / `trayIconForScale` / `showMainWindow`、`close` 拦截；`createSplashWindow` / `waitSplashShown` / `closeSplash` 与 reveal 兜底；退出询问与 `quitting` 门槛；白屏三项开关；`updater.init`、最外层 `crash.init` |
| `electron/splash.html` | 启动窗卡片、三点动态省略号，版本号经 query 注入 |
| `electron/preload.js` | `pm.signalReady` → `pm:renderer-ready`；`pm:update` / `pm:crash` / `pm:quit-answer` 包装 |
| `electron/ipc.js` | 更新动作通道（state / check / download / install）、`pm:crash` 的 list / record / export |
| `electron/services/updater.js` | 更新状态机、首检与周期检查、下载安装、错误翻译、`PM_UPDATE_URL` 覆盖、安装前清理回调 |
| `electron/services/crash.js` | 崩溃记录、转储目录初始化、按 kind 剪枝、列表、诊断包导出 |
| `scripts/make-tray-icons.js` | 字形定义 + 逐尺寸栅格化 + PNG 编码（零依赖），`npm run icons:tray` 重生成 |
| `scripts/make-app-icon.js` | 复用托盘字形生成多尺寸 ICO 与窗口 PNG，`npm run icons:app` 重生成 |
| `electron/assets/tray/tray-*.png` | 8 个尺寸的托盘图标（RGBA，共约 3KB） |
| `build/icon.ico` | 7 个尺寸（16~256）的应用图标，electron-builder 据此改写 exe / NSIS 图标 |
| `electron/assets/app-icon.png` | 256px 窗口图标，随 `electron/**/*` 进包 |
| `package.json` | `icons:tray` / `icons:app` 脚本、`build.win.icon` / `build.nsis` 图标、`electron-updater` 依赖、`build.publish` 与版本号 |
| `.github/workflows/release.yml` | tag 触发、版本一致性校验、双端 `npm ci`、构建与发布 |
| `web/src/App.jsx` | `booted` 后双 rAF 通知主进程；更新入口与弹窗装配 |
| `web/src/main.jsx` | 用 `ErrorBoundary` 包住 `App` |
| `web/src/hooks/useUpdater.js` | 版本号、更新状态、动作调用与诊断包导出，状态只吃主进程推送 |
| `web/src/hooks/useGit.js` | focus 静默刷新延后 300ms |
| `web/src/components/{QuitPrompt,UpdateModal,ErrorBoundary,AppModals}.jsx` | 退出询问自绘、更新弹窗与诊断包入口、渲染异常兜底、弹窗分支装配 |
| `README.md` | 构建、发版、更新源、崩溃目录与诊断包隐私边界说明 |

## 4. 关键修正与教训

- **`window-all-closed` 缺 `quitting` 门槛** → 所有退出路径都要由 `quitting` 区分「正常关闭」与「真正退出」，否则隐藏语义会被兜底逻辑破坏。
- **托盘图标模糊是三个原因叠加**：原图无 alpha 呈灰砖、1024px 插画压到 16px 丢掉细节、写死 16×16 被 shell 二次拉伸；只修一个都还糊。图标要先定「目标尺寸上还能剩几个可辨识元素」再画，16px 的预算是 1 个形状 + 3 道线。
- **PNG 无 alpha 不会报错** → 验收图标要显式检查角落像素的 alpha 与 color type，否则托盘上多出一块底色。
- **首帧 ≠ 完整首屏**，且主线程忙会让窗口反而晚出现 → 显示时机绑数据就绪，先等启动窗上屏再读库 / 起服务。
- **同一白屏有两条独立成因** → 遮挡判定拦截出帧、隐藏窗口图块回收互不替代；开关是否真生效要拿进程命令行核对。白屏定性先用窗口底色染色实验区分合成器空档与 DOM 问题。
- **恢复耗时与实例负载相关** → 长时间运行的重页面实例白约 1s、新实例 150–300ms，验收必须在真实实例上量。
- **透明启动窗的 `ready-to-show` 可能不派发** → 需要短兜底主动显示。
- **退出询问的兜底链路必须留着** → 渲染端不可用或 8 秒无回话要退回系统框，退出是关键时刻，宁可不美观也不能卡住退不出去。
- **`quitAndInstall` 会撞上退出询问** → 安装前必须自己跑完 `shutdown('stop')`、置真 `quitting` 并销毁托盘。
- **没有 `build.publish` 就没有 `app-update.yml`** → 安装包能装但永远停在 `unconfigured`；更新源必须在打包配置里，不能运行时拼 URL。发布缺 `latest.yml` 则客户端永远 `up-to-date`。
- **打包 exe 显示 Electron 默认图标不是打包失败** → `build/` 里没有 `icon.ico` 时 electron-builder 静默沿用自带图标；必须显式配 `win.icon` / NSIS 图标，且 ICO 至少含 256×256，否则大图标视图仍会退化。
- **`setPath('crashDumps')` 晚于 ready 无效**；全局 FIFO 剪枝会让 GPU 噪声挤掉真崩溃；Windows 文件名不能带冒号，时间戳需把 `:` / `.` 换成 `-`。
- **崩溃记录服务自身崩溃会死循环**，诊断包最容易顺手带上业务数据 → 全部静默 `try/catch`，内容只留应用信息、崩溃记录、转储文件名与计数。

## 5. 已知边界

- 按 Windows 行为实现（退出兜底带非 darwin 判断）；多屏缩放不同时托盘图标只按主屏取，非标准缩放（133% / 175%）由 shell 做极小幅度缩放。
- 不做开机自启，不提示「已最小化到托盘」；应用窗口、exe 与安装包图标统一取 `build/icon.ico`（2026-11-12 补上，此前沿用 electron-builder 默认图标）。
- 启动窗依赖 Windows 合成，个别机器边缘描边时可改不透明 320×240；只浮卡片，没有灰色舞台底。
- `backgroundThrottling: false` 让隐藏时仍在渲染，接受这点后台开销；三项开关的效果需在长时间运行的实例上复测。
- 只有打包安装版走更新通道；更新源默认 GitHub Release，自建目录只能 `PM_UPDATE_URL` 临时覆盖；CI 只构建 Windows NSIS 安装包；安装包未签名，可能有未知发布者提示。
- 真实升级链路（下载 / 重启 / 安装完成）与真实崩溃路径（渲染进程 / GPU）依赖运行期或发版后回归，当前只验证到状态机、构建产物与注入路径。
- 崩溃记录每类最多 20 条，只列 `.dmp` 文件名不打包内容；组件内被 `try/catch` 吞掉的错误不留痕，也不含完整操作序列。
- 不上传不联网：诊断包只能由用户手动发出。

## 6. 后续候选

- 开机自启、托盘状态提示。
- 若恢复白屏仍出现，转向降低重页面首屏光栅化成本（长列表虚拟化 / `content-visibility`），而不是继续加 Chromium 开关。
- 启动超过 10s 时在启动窗提供重试 / 导出诊断入口；`[window] splash shown after` 偏大时延后主进程 domain/services 的 `require`。
- macOS / Linux 的 CI 构建与发布、Release 说明自动生成、stable / beta 渠道、更新包与 Windows 代码签名。
- 检查更新失败后的退避重试与「稍后提醒」。
- 可选诊断包上传端点（明确用户同意后）、设置页内浏览 / 清理崩溃记录、崩溃前操作面包屑。

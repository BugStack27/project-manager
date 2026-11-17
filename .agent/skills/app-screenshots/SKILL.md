---
name: app-screenshots
description: 给 project-manager（项目管理台 Electron 应用）生成宣传/文档用的界面截图。当用户说“截个总览/统计/需求中心/需求看板/需求详情引用/启动台/修改记录/Agent 询问/Agent 恢复的图”“更新宣传图/README 截图”“要亮色/深色截图”“按默认窗口截高清图”时使用。注入虚构项目数据驱动真实前端，用无头 Chromium 逐页截取，默认应用窗口 1280×860 @2x，不会暴露本机真实项目。
---

# 应用界面截图

## 概述

用真实前端构建 + 一份虚构数据桥（`assets/mock-base.js` + 生成器）替代 Electron IPC，在无头 Chromium 里逐页操作并截图。默认亮色、应用默认窗口 1280×860、2x 高清（2560×1720），输出到 `doc/screenshots/`。

数据是虚构的（星港数据平台、极光移动端等），但规模参考真实使用：约 20 个项目、60 条需求、30+ 条命令、8 个有改动项目，用于让页面看起来“有事发生”。

## 用法

在仓库根目录执行：

```bash
# 全部 9 页，亮色
node .agent/skills/app-screenshots/scripts/capture.cjs

# 深色
node .agent/skills/app-screenshots/scripts/capture.cjs --theme dark

# 只重截某几页
node .agent/skills/app-screenshots/scripts/capture.cjs --only overview,launch

# 换尺寸/输出目录；加 --no-build 跳过 npm run build
node .agent/skills/app-screenshots/scripts/capture.cjs --width 1440 --height 900 --out doc/tmp-shots --no-build
```

脚本默认先执行 `npm run build`，所以截图反映最新前端。运行结束后逐张打印文件与体积。

| 参数 | 默认 | 说明 |
|---|---|---|
| `--theme` | `light` | `light` / `dark` |
| `--width` / `--height` | `1280` / `860` | CSS 视口，默认与 Electron 主窗口一致 |
| `--scale` | `2` | 设备像素比，2 = 高清 |
| `--only` | 全部 | 逗号分隔：`overview,statistics,requirements-board,requirements,requirement-refs,launch,changes,agent-resume,agent-question` |
| `--out` | `doc/screenshots` | 相对仓库根目录 |
| `--no-build` | 关 | 跳过构建，直接用现有 `electron/renderer` |
| `--root` | 自动推断 | skill 被复制到别处时指定项目根目录 |

## 九个场景

| 名称 | 内容 | 关键状态 |
|---|---|---|
| `overview` | 总览 | 多项目、待审核/进行中、未提交文件、运行中服务 |
| `statistics` | 统计 | 7 天提交量、增删行、需求处理趋势、项目明细 |
| `requirements-board` | 需求看板 | 候选池 / 未完成（进行中、待审核置顶）/ 已完成·已拒绝 三列，卡片显示状态图标、认领人与时间 |
| `requirements` | 需求中心 | 未完成列表 + 右面板“已交付，等你验收” |
| `requirement-refs` | 需求详情引用 | 正文里 `@{项目}` / `@{#需求}` / `@{file:路径}` / `{UseSkill:技能}` 四种 chip，悬停「引用文件」行展开文件内容卡 |
| `launch` | 启动台 | 运行中命令 + ANSI 日志 |
| `changes` | 修改记录 | 未提交文件、提交历史、右侧 diff |
| `agent-resume` | Agent 恢复 | doing 需求被认领，详情底部「解锁项目」（下一轮还给 Agent 继续做） |
| `agent-question` | Agent 询问 | doing 需求「卡在这里等你回答」提问卡片：候选、回答框、时间线 |

页面切换、点击需求、滚动右面板、悬停 chip 等步骤都在 `scripts/capture.cjs` 的 `main()` 末尾；选择器与每个场景的流程见 [references/shot-plan.md](references/shot-plan.md)。

## 改数据

虚构数据在 `scripts/gen-mock.cjs` 顶部：

- `newProjects`：项目名、路径、技术栈（栈标识必须是 `android / obsidian-plugin / electron / intellij / javafx / spring-boot / kotlin / java / gradle / maven / npm`）；
- `newRequirements`：需求标题、状态、认领/交付/提问；`claim`、`completion`、`question` 都带 `agentName`；需要展示引用时再补 `refs` / `reqRefs` / `fileRefs` / `skills`（解构形状与服务端 `reqView` 一致，见 `references/shot-plan.md`）；
- `newCommands`：命令与运行记录（`status: 'running'` 才算在跑）；
- `newChanges` / `behindMap`：未提交文件数、远程落后提交数；
- `weights` / `doneByOffset`：统计页的提交量与需求处理量。

只改名字和文案即可，不要接入真实用户数据；生成器会把数据插进 `assets/mock-base.js` 并补齐当前版本的视图字段（`candidateCount`、`questionCount`、`stacks`、`unlock` 等）。`gen-mock.cjs` 同时按需求生成时间线，避免切到别的需求时串台。

## 已知坑

- **不能用 file:// 打开**：构建产物是 ES module，必须起本地 HTTP（脚本内置随机端口）。
- **Playwright 包没装**：直接用 Playwright 缓存里的 Chromium（`%LOCALAPPDATA%/ms-playwright/chromium-*/chrome-win64/chrome.exe`）经 CDP 驱动；其他机器可用 `CHROMIUM_PATH` 指定。
- **Windows 上的 Edge / Chrome 启动器会立刻退出**：真正的浏览器进程留在后台，stderr 里也没有调试地址。脚本从 profile 的 `DevToolsActivePort` 读端口，结束时用 CDP `Browser.close` 关闭（杀子进程管不到它），不要改回靠 stderr 判断。
- **提问卡片是 sticky**：切换需求后先 `rpanel-body.scrollTop = 0`，等 300ms 再 `scrollIntoView`，否则会截到被裁一半的卡片。
- **悬停卡只认真实鼠标事件**：`requirement-refs` 场景靠 CDP 的 `Input.dispatchMouseEvent` 发 `mouseMoved` 到 chip 上（脚本里的 `hoverText`），手拼 `MouseEvent('mouseenter')` 不会触发 React 的 enter 处理。
- **右面板是覆盖式抽屉**：点击需求行才会展开；进入总览/统计会自动收起。
- **主题**：脚本往构建后的 `index.html` 注入 localStorage 与 `data-theme`，必须写在模块脚本执行前（见 `capture.cjs` 的 `prepareSite`）。
- **数据日期**：生成器按运行时刻计算相对时间，隔一段时间重截也会显示“今天/昨天”。

## 资源

- `scripts/capture.cjs`：构建、注入、起服务、Chromium/CDP、九页截图。
- `scripts/gen-mock.cjs`：把虚构数据与当前视图字段合成为 `mock.js`。
- `assets/mock-base.js`：演示桥底座（`window.api` 替身与各页面演示数据）。
- `references/shot-plan.md`：每个场景的点击步骤、选择器与排障。

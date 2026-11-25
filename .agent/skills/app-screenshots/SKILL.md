---
name: app-screenshots
description: 给 project-manager（项目管理台 Electron 应用）生成宣传/文档用的界面截图。当用户说“截个总览/统计/需求中心/需求看板/需求详情引用/启动台/修改记录/Agent 询问/Agent 恢复的图”“截 1.4.0 笔记用的局部图（关联提交/文件夹悬停/技术栈悬停/复制路径/数据与外观菜单/SVG 预览）”“更新宣传图/README 截图/笔记截图”“要亮色/深色截图”“按默认窗口截高清图”时使用。注入虚构项目数据驱动真实前端，用无头 Chromium 逐页截取，默认应用窗口 1280×860 @2x，不会暴露本机真实项目。
---

# 应用界面截图

## 概述

用真实前端构建 + 一份虚构数据桥（`assets/mock-base.js` + 生成器）替代 Electron IPC，在无头 Chromium 里逐页操作并截图。默认亮色、应用默认窗口 1280×860、2x 高清（2560×1720）。

两套场景共用一份数据：

- `--suite readme`（默认）：整窗九页，输出 `doc/screenshots/`，供 README 的「界面」章节。
- `--suite note`：七张局部特写，输出 `.screenshots/note/`，供公众号 / 知识库笔记（1.4.0 那篇按 `r140-01…07` 改名后放进笔记的 `assets/`）。

数据全部虚构：10 个可见项目、约 39 条需求、16 条命令。**左栏刻意留白**——只有真的需要你动手的项目才亮灯（最多「需求 + 改动/同步 + 运行」三盏），橙点只留给有未提交改动或未拉取提交的项目，候选池角标与「AI 停」各只出现一两次。截图要让人一眼看到「有事发生」，而不是一屏全是点与圈。

## 用法

在仓库根目录执行：

```bash
# README 九页，亮色
node .agent/skills/app-screenshots/scripts/capture.cjs

# 笔记七张
node .agent/skills/app-screenshots/scripts/capture.cjs --suite note

# 深色
node .agent/skills/app-screenshots/scripts/capture.cjs --theme dark

# 只重截某几页
node .agent/skills/app-screenshots/scripts/capture.cjs --only overview,launch
node .agent/skills/app-screenshots/scripts/capture.cjs --suite note --only note-svg-preview

# 换尺寸/输出目录；加 --no-build 跳过 npm run build
node .agent/skills/app-screenshots/scripts/capture.cjs --width 1440 --height 900 --out doc/tmp-shots --no-build
```

脚本默认先执行 `npm run build`，所以截图反映最新前端。运行结束后逐张打印文件与体积。

| 参数 | 默认 | 说明 |
|---|---|---|
| `--suite` | `readme` | `readme` / `note`；决定场景列表与默认输出目录 |
| `--theme` | `light` | `light` / `dark` |
| `--width` / `--height` | `1280` / `860` | CSS 视口，默认与 Electron 主窗口一致 |
| `--scale` | `2` | 设备像素比，2 = 高清 |
| `--only` | 全部 | 逗号分隔的场景名 |
| `--out` | 按 suite | readme → `doc/screenshots`；note → `.screenshots/note` |
| `--no-build` | 关 | 跳过构建，直接用现有 `electron/renderer` |
| `--root` | 自动推断 | skill 被复制到别处时指定项目根目录 |

## 场景

### README（整窗九页）

| 名称 | 内容 | 关键状态 |
|---|---|---|
| `overview` | 总览 | 多项目、待审核/进行中、未提交文件、运行中服务 |
| `statistics` | 统计 | 7 天提交量、增删行、需求处理趋势、项目明细 |
| `requirements-board` | 需求看板 | 候选池 / 未完成（进行中、待审核置顶）/ 已完成·已拒绝 三列 |
| `requirements` | 需求中心 | 未完成列表 + 右面板「已交付，等你验收」与关联提交 |
| `requirement-refs` | 需求详情引用 | `@{项目}` / `@{#需求}` / `@{file:文件}` / `@{file:目录}` / `{UseSkill:技能}`，悬停「引用文件」行展开内容卡 |
| `launch` | 启动台 | 运行中命令 + ANSI 日志 |
| `changes` | 修改记录 | 未提交文件、提交历史、右侧 diff |
| `agent-resume` | Agent 恢复 | doing 需求被认领，详情底部「解锁项目」 |
| `agent-question` | Agent 询问 | doing 需求的提问卡片：候选、回答框、时间线 |

### 笔记（七张特写）

| 名称 | 内容 | 关键状态 |
|---|---|---|
| `note-commit-links` | 提交挂到需求 | #15「已交付，等你验收」+ 关联提交两条 + 时间线 |
| `note-folder-ref` | 文件夹引用 | 悬停 `web/src/views/export` 目录 chip，列出 7 个一级条目 |
| `note-stack-hover` | 技术栈悬停卡 | 悬停「空谷文件同步」：Go / Rust / Python / Docker + 三个计数 |
| `note-copy-path` | 复制路径 | 项目行「更多操作」菜单展开「复制路径」二级菜单 |
| `note-sidebar-data` | 数据菜单 | 侧栏底部 → 数据 → 备份与恢复 / 数据文件 / 审计日志 |
| `note-sidebar-appearance` | 外观菜单 | 清透 / 暖纸 / 活力 / 暗色 + 跟随系统 |
| `note-svg-preview` | SVG 预览 | 修改记录里 `assets/logo-mark.svg`：HEAD 与工作区两张图 + 源码 diff |

页面切换、点击需求、滚动右面板、悬停 chip、展开菜单等步骤都在 `scripts/capture.cjs` 的 `main()` 末尾；选择器与每个场景的流程见 [references/shot-plan.md](references/shot-plan.md)。

## 改数据

虚构数据在 `scripts/gen-mock.cjs` 顶部：

- `newProjects`：底座已有 6 个项目 + 1 个归档项目，这里只补 4 个；项目名、路径、技术栈（栈标识必须是 `android / obsidian-plugin / electron / intellij / javafx / spring-boot / kotlin / java / go / rust / python / docker / gradle / maven / npm`）；
- `newRequirements`：需求标题、状态、认领/交付/提问；`claim`、`completion`、`question` 都带 `agentName`；需要展示引用时再补 `refs` / `reqRefs` / `fileRefs` / `skills` / `commits`（形状与服务端 `reqView` 一致，见 `references/shot-plan.md`）；
- `newCommands`：命令与运行记录（`status: 'running'` 才算在跑）；
- `newChanges` / `behindMap`：未提交文件数与远程落后提交数；`cleanChanges()` 可以把底座里自带的改动清空，用来「关掉」某个项目的橙点；
- `weights` / `doneByOffset`：统计页的提交量与需求处理量。

认领人只用当下主流的 Agent 名字（Cursor / Claude Code / Work Buddy / Copilot Agent），`scout-agent` 这类只写 id 的旧数据由生成器补成 Qoder。只改名字和文案即可，不要接入真实用户数据；生成器会把数据插进 `assets/mock-base.js` 并补齐当前版本的视图字段（`candidateCount`、`questionCount`、`stacks`、`unlock`、`commits` 等），同时按需求生成时间线，避免切到别的需求时串台。

笔记场景还依赖三处演示数据，改动时别丢：

- `#15` 的 `commits`（关联提交两条）；
- `#17` 的 `fileRefs` 里有目录项，且 mock 的 `projectDir` 返回该目录的 7 个一级条目；
- 星港的 5 个改动文件里有 `assets/logo-mark.svg`，mock 的 `gitDiff` 对 `.svg` 返回 `image.old / image.new` 两张 data URL + 源码 diff（`diff` 必须是字符串，不是字符串数组）。

## 已知坑

- **不能用 file:// 打开**：构建产物是 ES module，必须起本地 HTTP（脚本内置随机端口）。
- **Playwright 包没装**：直接用 Playwright 缓存里的 Chromium（`%LOCALAPPDATA%/ms-playwright/chromium-*/chrome-win64/chrome.exe`）经 CDP 驱动；其他机器可用 `CHROMIUM_PATH` 指定。
- **Windows 上的 Edge / Chrome 启动器会立刻退出**：真正的浏览器进程留在后台，stderr 里也没有调试地址。脚本从 profile 的 `DevToolsActivePort` 读端口，结束时用 CDP `Browser.close` 关闭（杀子进程管不到它），不要改回靠 stderr 判断。
- **提问卡片是 sticky**：切换需求后先 `rpanel-body.scrollTop = 0`，等 300ms 再 `scrollIntoView`，否则会截到被裁一半的卡片。
- **悬停卡只认真实鼠标事件**：`requirement-refs` / `note-folder-ref` / `note-stack-hover` 靠 CDP 的 `Input.dispatchMouseEvent` 发 `mouseMoved`，手拼 `MouseEvent('mouseenter')` 不会触发 React 的 enter 处理。截完先 `moveAway()` 把鼠标挪到 (1,1)，否则下一张图会带上一张的卡。
- **菜单用点击展开，别用悬停**：项目「更多操作」的「复制路径」二级菜单直接点 `.pmenu-parent`；鼠标路过项目行会触发 240ms 的项目悬停卡，把截图弄花。
- **目录悬停要补 `projectDir`**：文件卡走 `fileSnippet`，目录卡走 `projectDir`（`{ entries, total, truncated }`），底座原本没有这个通道，少了会显示读取失败。
- **右面板是覆盖式抽屉**：点击需求行才会展开；进入总览/统计会自动收起。
- **主题**：脚本往构建后的 `index.html` 注入 localStorage 与 `data-theme`，必须写在模块脚本执行前（见 `capture.cjs` 的 `prepareSite`）。
- **数据日期**：生成器按运行时刻计算相对时间，隔一段时间重截也会显示“今天/昨天”。

## 资源

- `scripts/capture.cjs`：构建、注入、起服务、Chromium/CDP、两套场景。
- `scripts/gen-mock.cjs`：把虚构数据与当前视图字段合成为 `mock.js`。
- `assets/mock-base.js`：演示桥底座（`window.api` 替身与各页面演示数据）。
- `references/shot-plan.md`：每个场景的点击步骤、选择器与排障。

---
date: 2026-11-23
description: 文件引用支持文件夹：@ 候选补全能选目录，悬停目录显示一级条目清单
---

# 文件引用支持文件夹 - 任务规划

## 1. 需求概述

需求 #63「引用文件的时候支持引用文件夹」。

现状里 `@{file:相对路径}` 已经能解析目录：`refs.js#resolveFileRefs` 会回 `directory: true` 与绝对路径，引用清单标「目录」，点击用系统文件管理器打开，agent 认领时也能拿到 `directory` 标记。
真正的缺口有两处：

1. 输入 `@` 时 `projectFiles` 只返回文件，候选面板里选不到目录，用户只能手写路径；
2. 悬停目录 chip 没有任何信息窗，只有一句原生提示「目录：路径」。

本次目标：候选面板能选目录；悬停目录时出信息窗，显示一级条目（名称 / 类型 / 大小）。
不改引用语法（沿用 `@{file:相对路径}`）、不改 agent 载荷（`fileRefs` 已有 `directory` 字段）、不做目录内容递归。

## 2. 需求澄清记录

| 问题 | 结论 |
|---|---|
| 「引用文件夹」做到哪一步 | 候选面板 + 悬停一级条目预览（两次回答不一致时以此为准） |
| 范围冲突的确认 | 先答「候选面板能选目录即可」、又答悬停「一级条目：名称/类型/大小，限 200 条」；追问后确认「候选面板 + 悬停一级条目预览」 |
| 悬停卡片显示什么 | 一级条目：名称 / 类型 / 大小，限 200 条；跳过 `node_modules` / `.git` 等依赖与版本库目录，超出截断并标注 |
| 是否给 agent 侧补目录条目清单 | 不做：`fileRefs` 已有 `directory` 标记，agent 按 `absPath` 自己读；扩载荷会拖慢 `/next` |
| 引用写法 | 沿用 `@{file:相对路径}`，不新增 `@{dir:…}`；存量正文与解析逻辑不用动 |
| 点击目录 chip 的行为 | 维持现状：`shell.openPath` 打开文件夹（资源管理器） |

补充假设：

1. 目录候选从「已收集到的文件路径」反推父目录（git 模式天然尊重 `.gitignore`）；空目录在 git 模式下可能不出现，可接受。
2. 悬停目录清单只在出卡时读一次，不缓存 —— 目录会变，缓存会说旧话（与文件内容窗同一条纪律）。

## 3. 现状与缺口

| 环节 | 现状 | 缺口 |
|---|---|---|
| 解析 | `electron/services/domain/refs.js#resolveFileRefs` 已回 `directory` / `absPath`，安全边界走 `snippet.js` | 无 |
| 引用清单 | `RequirementDetail.jsx` 已标「目录」角标，点击可打开 | 无 |
| 候选补全 | `electron/services/files.js#list` 只收集文件；`fileCandidates` / `ProjectRefInput` 只按文件渲染 | 目录选不到 |
| 悬停 | `hoverProps.file` 排除 `directory`；`FileHoverCard` 只会读文件内容 | 目录无预览 |

## Requirements

### 1. 候选清单包含目录（服务端）

| 属性 | 值 |
|---|---|
| **目标** | `files.list(root)` 返回文件 + 目录：每项带 `directory` 布尔。git 模式从 `git ls-files` 的文件路径反推全部父目录；遍历回退模式在遇到目录时一并收下（仍跳过 `SKIP_DIRS`）。去重、过滤 `DENY_RE`、与文件共用 `MAX_FILES` 上限并维护 `truncated` |
| **涉及文件** | `electron/services/files.js` |
| **验收标准** | 对仓库项目调用 `projectFiles`，返回里出现 `web` / `web/src` 这类目录项且带 `directory:true`；`node_modules` / `.git` 不出现；非仓库项目（遍历回退）同样有目录项；文件项数量与改造前一致，`truncated` 语义不变 |
| **依赖** | 无 |

### 2. 候选面板区分目录（前端）

| 属性 | 值 |
|---|---|
| **目标** | `fileCandidates` 识别 `directory`：同分时目录排在文件前；`ProjectRefInput` 的文件行给目录加「目录」角标，插入仍是 `applyFileRef(path)`（`@{file:web/src}`）；统一模式与 `file:` 前缀模式表现一致 |
| **涉及文件** | `web/src/lib/req-refs.js`、`web/src/components/ProjectRefInput.jsx`、`web/src/styles/controls.css`（如现有 `.refsug-tag` 不够用） |
| **验收标准** | 输入 `@file:web` 能看到目录 `web` 并带「目录」角标，Enter 插入 `@{file:web}`；输入普通文件名时候选顺序与结果不劣化；选中目录后引用清单出现「目录」角标 |
| **依赖** | 任务 1 |

### 3. 目录清单接口（服务端）

| 属性 | 值 |
|---|---|
| **目标** | 新增领域方法 `projectDir({id, path})`：校验项目目录 → `assertRelPath` → `DENY_RE` → `resolveInside` → `stat` 确认为目录；读取一级条目，跳过 `SKIP_DIRS` 与 `DENY_RE` 命中的条目，目录在前、名称升序，上限 200 并回 `truncated` / `total`。每条给 `{name, directory, size}`（目录 size 为 null）。不做递归、不回文件内容 |
| **涉及文件** | `electron/services/files.js`、`electron/services/domain/system.js`、`web/src/api.js` |
| **验收标准** | 对真实项目目录调用返回一级条目与 `truncated`；对文件路径 / 越界路径 / 密钥目录分别 400 / 404 / 403 类错误；`node_modules`、`.git` 不出现在条目里；超过 200 条时截断并标 `truncated:true` |
| **依赖** | 任务 1（共用 `SKIP_DIRS` / 读取工具） |

### 4. 目录悬停卡（前端）

| 属性 | 值 |
|---|---|
| **目标** | `hoverProps.file` 允许 `directory` 项出卡（仍排除不存在 / 受限）；`FileHoverCard` 增加 `directory` 分支：改调 `api.projectDir`，渲染一级条目（目录 / 文件类型标记、名称、文件大小），页脚显示「N 项 / 只显示前 200 项」与「点击 chip 打开文件夹」；空目录给一句说明；读取失败沿用错误态 |
| **涉及文件** | `web/src/components/HoverCardLayer.jsx`、`web/src/components/FileHoverCard.jsx`、`web/src/styles/sidebar.css` |
| **验收标准** | 悬停目录 chip 出卡并列出条目；`node_modules` 不在列表；超过 200 条有截断提示；悬停普通文件的行为与布局不回归；卡内可滚动、鼠标移入卡不消失 |
| **依赖** | 任务 3 |

### 5. 文档同步

| 属性 | 值 |
|---|---|
| **目标** | 在 `doc/requirements-and-agent.md` 补一节（引用扩展的后续变更）：候选含目录、目录悬停卡、agent 侧不扩载荷；README 功能行提到「文件引用也支持文件夹」；`web/src/api.js` 的 `projectFiles` / `projectDir` 注释更新；`web/claim-test.html` 演示数据补上目录引用，便于手工复核 |
| **涉及文件** | `doc/requirements-and-agent.md`、`README.md`、`web/src/api.js`、`web/claim-test.html` |
| **验收标准** | 文档描述与实际行为一致；没有新增与实现不符的承诺（递归、目录树、agent 清单） |
| **依赖** | 任务 1–4 |

## 5. 执行顺序

1 → 2 → 3 → 4 → 5。任务 1、2 是候选链路；任务 3、4 是悬停链路，可分别在两条链路上验收；任务 5 最后统一收口。

每条任务完成后按 `dev-loop` 流程做一次审查，再进入下一条。

## 6. 验证方式

- `npm run check`（`files.js`、`system.js` 均已在检查清单里）。
- `npm run build`。
- 手工界面核对：新建 / 编辑需求时 `@file:` 候选出现目录并能插入；引用清单与正文 chip 悬停目录出卡；普通文件预览、点击打开不回归。
- 服务端可另用临时目录直调 `files.list` / `projectDir` 核对条目、排序、截断与安全拦截，临时脚本跑完删净。

## 7. 已知边界与不做

- 不做两级目录树、不做递归内容预览、不做目录内搜索。
- 不新增 agent 载荷字段：`fileRefs` 仍只给 `name / path / absPath / exists / directory / restricted / reason`，不附目录条目。
- git 模式下空目录不会出现在候选里（没有文件可反推）；遍历回退模式会包含空目录。
- 目录候选与文件共用一个上限（4000 项），大仓库下靠 `truncated` 如实说明。
- Windows 路径分隔符统一按 `/` 返回，与现有 `projectFiles` 一致。

## Complements

### 1. 候选清单包含目录（服务端）

- **状态**：✅ 已完成
- **修改文件**：
  - `electron/services/files.js` — `list` 返回 `{path, directory}`；git 模式用 `ancestorsOf` 反推父目录，`walk` 模式收下目录项；去重 / `DENY_RE` / 4000 上限不变
- **审查结果**：审查通过（实测仓库 421 文件 + 34 目录，`node_modules` / `.git` 未出现）
- **完成时间**：2026-11-23 10:52

### 2. 候选面板区分目录（前端）

- **状态**：✅ 已完成
- **修改文件**：
  - `web/src/lib/req-refs.js` — `fileCandidates` 识别 `directory`，同分与空查询时目录在前
  - `web/src/components/ProjectRefInput.jsx` — 目录行加「目录」角标，分组标题与底部提示同步
- **审查结果**：审查通过；按其意见补了空查询标题「项目 / 需求 / 文件目录」
- **完成时间**：2026-11-23 10:54

### 3. 目录清单接口（服务端）

- **状态**：✅ 已完成
- **修改文件**：
  - `electron/services/files.js` — 新增 `readDir`（一级条目、目录在前、`SKIP_DIRS` + `DENY_RE` 过滤、限 200）
  - `electron/services/domain/system.js` — 新增 `projectDir`，路径校验与 `fileSnippet` / `revealFile` 同口径
  - `web/src/api.js` — 新增 `projectDir` 通道
- **审查结果**：审查通过（越界 400、密钥目录 403、不存在 404、非目录 400 均实测）
- **完成时间**：2026-11-23 10:56

### 4. 目录悬停卡（前端）

- **状态**：✅ 已完成
- **修改文件**：
  - `web/src/components/HoverCardLayer.jsx` — `hoverProps.file` 放行目录，`directory` 标记透传到卡
  - `web/src/components/FileHoverCard.jsx` — 目录分支改调 `projectDir`，渲染名称 / 类型 / 大小，页脚 N 项与截断提示
  - `web/src/styles/sidebar.css` — 新增 `.fhover-dir*` 样式
  - `web/src/RequirementDetail.jsx` — 引用文件清单注释同步（目录不再标失效）
- **审查结果**：审查通过（`npm run build` 通过，文件预览与启动台脚本悬停未回归）
- **完成时间**：2026-11-23 10:57

### 5. 文档同步

- **状态**：✅ 已完成
- **修改文件**：
  - `doc/requirements-and-agent.md` — 新增 §2.13 决策记录，交付物与已知边界同步
  - `README.md` — 需求详情功能与截图说明提到文件 / 文件夹
  - `web/claim-test.html` — 演示数据补上目录引用（`fileRefs` / `projectFiles` / `projectDir` / `fileSnippet`），供手工复核
- **审查结果**：首次审查指出 Complements 漏列演示页、缩进错位与 `fileRefs` 字段表述不全，均已修正后复核通过
- **完成时间**：2026-11-23 11:05

## 完成总结

候选面板能选目录、目录 chip 悬停可看一级条目；语法、agent 载荷与点击打开行为保持不变。
验证：`npm run check`、`npm run build` 通过；`files.list` / `readDir` 用真实仓库直调核对条目、排序与过滤；vite dev + 内置浏览器实测 claim-test 演示页：`@file:web` 候选出现「目录」角标并插入 `@{file:web}`，目录 chip 悬停列出 4 项，文件悬停仍是行号 + 高亮。
未做的：两级目录树、目录内搜索、递归预览（见 §7）。

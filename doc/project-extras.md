---
date: 2026-11-24
description: 项目设置升级为带左侧分区导航的大弹窗：基础 / 关联项目 / 环境 / 规则；条目型配置即时保存，并下发给启动命令与 Agent
---

# 项目扩展信息配置 — 任务规划

## 1. 需求概述

现状：「项目设置」是 [forms.jsx:62](file:///D:/job/peoject-manager/web/src/forms.jsx#L62) 里的 500px 小弹窗，只有项目名、本地路径、AI 巡检、启动自动拉取四项，入口为项目行 `···` → 设置（侧栏与总览共用）。

目标：把编辑态升级为带左侧分区导航的大弹窗，新增三个条目型配置分区，给 Agent 提供项目上下文：

- **关联项目**：单向关联其他项目，每个关联可写一条备注，供 Agent 理解项目间关系。
- **环境**：`KEY=VALUE` 条目（如 `JAVA_HOME`、`MAVEN_HOME`）；启动台命令默认注入，单条命令可关闭；Agent 通过 `/next` 拿到后自行 `export`。
- **规则**：标题 + 自然语言内容（如「docs 目录条目过多时调用收敛文档 Skill」）；启用的规则随 `/next` 下发给 Agent，`pm_get_project` 也可读取。

范围：数据模型、项目详情视图、`updateProject` 校验、命令启动注入、Agent 下发、前端大弹窗。
不做：规则结构化条件、关联双向、按命令勾选部分变量、环境注入到「在终端打开」、移动端界面。

## 2. 需求澄清记录

| 模糊点 | 结论 | 理由 |
|---|---|---|
| 关联关系方向 | 单向关联 + 单条备注 | 只在当前项目看到「关联到 B，备注…」；B 不自动出现 A，语义清晰、不互相污染 |
| 环境变量注入范围 | 启动台命令默认注入，可单条关闭；Agent 通过 `/next` 读取 | 兼顾「开箱即用」与个别命令需要干净环境的场景；Agent 自己跑的命令由它自己 `export` |
| 规则下发方式 | 纯文本条目；`/next` 与 `pm_get_project` 都返回；worker 手册要求开工前读 | 规则本质是自然语言判断，条件仍由 Agent 理解，不做结构化条件字段 |
| 保存方式与新建流程 | 基础区手动保存（含归档）；条目区增删改即时保存；新建项目仍用现有简单表单 | 基础字段要一起校验（路径变更还要同步命令 cwd）；条目编辑失败不应连累基础字段；新建时项目还不存在，无法加关联 |

**追加设计决定**（未逐项提问，按仓库既有约定）：

- 入口不变：项目行 `···` → 设置；不新增视图页签、不改侧栏结构。
- 扩展信息存项目记录 `p.extras = { links, env, rules }`，不建独立表，不改 `db.version`；旧库读时按空数组兜底，无需迁移。
- **不塞进 5 秒项目列表轮询**：项目列表 `projectView` 保持现状，扩展信息只随单项目详情（`project` 动作）、`/next`、`updateProject` 结果返回。理由与 `projectIcon` 一致——规则正文可能较长，不能让轮询载荷膨胀。
- 环境变量只注入启动台命令的**子进程**，不注入命令宿主进程，也不影响「在终端打开」；不打印变量值到日志。
- 规则只下发 `enabled !== false` 的条目；关联目标被归档或删除时标记 `exists / archived`，界面显示「已失效」并允许移除。
- 数量与长度上限：关联 20 条（备注 ≤300 字）、环境 50 条（key ≤64、value ≤1000）、规则 30 条（标题 ≤80、正文 ≤4000）；环境 key 按 Windows 语义忽略大小写去重。

## 3. 任务列表

### 任务 1：数据模型与项目详情视图

| 属性 | 值 |
|------|-----|
| **描述** | 项目记录新增 `extras = { links, env, rules }`，旧数据缺省为空数组。在 [views.js:199](file:///D:/job/peoject-manager/electron/services/domain/views.js#L199) 增加 `projectExtras(p)`：`links` 解析目标项目的 `name / path / archived / exists`（目标缺失 `exists:false`），`env`、`rules` 原样返回；`project` 动作改为返回 `{ project: projectView(p), extras }`。`/next` 的项目载荷也改用该 helper。 |
| **依赖关系** | 无 |
| **验收标准** | 旧 `db.json` 启动无报错；`GET project` 返回 `extras` 且字段完整；关联目标归档后 `archived:true`、`exists:true`，删除后 `exists:false`；`/next` 返回同样的扩展信息；项目列表轮询响应不新增 `extras`。 |

### 任务 2：updateProject 扩展与校验

| 属性 | 值 |
|------|-----|
| **描述** | [projects.js:74](file:///D:/job/peoject-manager/electron/services/domain/projects.js#L74) 的 `updateProject` 接受 `patch.extras`（可只传 `links` / `env` / `rules` 之一）。服务端统一规范化：trim、去空条目、分配 `id`（`store.uid('pl' / 'pe' / 'pr')`）、上限截断、环境 key 正则 `^[A-Za-z_][A-Za-z0-9_]*$` 且忽略大小写唯一、关联不能指向自身/重复目标/不存在的项目。改动写 `updatedAt` 与 `project.updated` 审计（`changes` 增加 `links` / `env` / `rules`）。返回值补充 `extras`。 |
| **依赖关系** | 任务 1 |
| **验收标准** | 非法 key、重复 key、自关联、重复关联、超上限分别返回 4xx 或按上限截断；合法改动落库并出现在 `extras`；审计 `changes` 正确；基础字段（名称/路径）行为不变。 |

### 任务 3：命令级「不注入项目环境」开关

| 属性 | 值 |
|------|-----|
| **描述** | 命令记录新增 `noProjectEnv` 布尔值（默认 `false`）：[commands.js:50](file:///D:/job/peoject-manager/electron/services/domain/commands.js#L50) `createCommand`、[commands.js:79](file:///D:/job/peoject-manager/electron/services/domain/commands.js#L79) `updateCommand` 接受该字段，[views.js:181](file:///D:/job/peoject-manager/electron/services/domain/views.js#L181) `cmdView` 返回它；[forms.jsx:443](file:///D:/job/peoject-manager/web/src/forms.jsx#L443) `CommandForm` 增加勾选框「不注入项目环境变量」及说明。启动台列表不加额外标记，避免多处入口口径不一。 |
| **依赖关系** | 任务 1 |
| **验收标准** | 勾选保存后命令视图返回 `noProjectEnv:true`，重新打开编辑保持勾选；未勾选时为 `false`；命令运行中不可编辑的既有约束不变。 |

### 任务 4：启动注入链路

| 属性 | 值 |
|------|-----|
| **描述** | [runner.js:191](file:///D:/job/peoject-manager/electron/services/runner.js#L191) `start(command)` 读取所属项目的 `extras.env`，把变量并入宿主进程的 `spawn env`（`{ ...process.env, ...projectEnv, ELECTRON_RUN_AS_NODE: '1' }`）；`command.noProjectEnv` 时跳过项目变量。run-host 仍从 `process.env` 继承并删除 `ELECTRON_RUN_AS_NODE`，无需改源码。不通过 argv 传变量，避免 Windows 命令行长度上限。启动日志只记注入的 key 数量，不记 value。 |
| **依赖关系** | 任务 1、任务 3 |
| **验收标准** | 项目配置 `JAVA_HOME=X` 后，启动台命令 `echo $JAVA_HOME`（Windows 用 `%JAVA_HOME%`）输出 X；勾选不注入时输出系统值或空；运行中修改配置只影响下一次启动；项目变量可覆盖系统同名变量。 |

### 任务 5：Agent 下发与手册

| 属性 | 值 |
|------|-----|
| **描述** | [auto-claim.js:77](file:///D:/job/peoject-manager/electron/services/domain/auto-claim.js#L77) `viewOf` 的 `project` 载荷带 `extras`（规则只含启用项）。更新 [prompts/worker.md](file:///D:/job/peoject-manager/prompts/worker.md) §1 的 `project` 字段说明，§2 增加三条：开工前读 `project.rules` 并遵守；需要执行命令前按 `project.env` 设置环境变量；`project.links` 是相关项目（只读参考，不修改对方代码）。[mcp-http.js:76](file:///D:/job/peoject-manager/electron/mcp-http.js#L76) `pm_get_project` 描述补充扩展信息。scout 手册不改（只读巡检不执行规则）。 |
| **依赖关系** | 任务 1 |
| **验收标准** | `curl /next` 返回的 `project` 含 `rules / env / links`，禁用规则不出现；MCP `pm_get_project` 返回同字段；worker 手册措辞与字段名一致，无未定义字段。 |

### 任务 6：大弹窗骨架与基础分区

| 属性 | 值 |
|------|-----|
| **描述** | 新建 [ProjectSettingsModal.jsx](file:///D:/job/peoject-manager/web/src/components/ProjectSettingsModal.jsx)：左侧分区导航（基础 / 关联项目 / 环境 / 规则），右侧内容独立滚动；复用 [ui.jsx:42](file:///D:/job/peoject-manager/web/src/ui.jsx#L42) `Modal` 并加 `pset` 类。编辑态在 [AppModals.jsx:43](file:///D:/job/peoject-manager/web/src/components/AppModals.jsx#L43) 路由到新组件，新建态仍用 `ProjectForm`。基础分区沿用现有四项字段、保存与归档逻辑（保存仍走 `App.saveProject`，路径变更同步命令 cwd 的行为不变）。底部语义：基础分区显示「取消 / 保存 / 归档」；其余分区显示「改动已自动保存」与「关闭」。基础区未保存时切走保留本地草稿，左侧「基础」显示未保存圆点。弹窗打开时调用 `api.project(id)` 拉一次 `extras`。 |
| **依赖关系** | 任务 1、任务 2 |
| **验收标准** | `···` → 设置打开四分区大弹窗；基础保存后列表刷新且弹窗关闭；新建项目仍是旧弹窗；Esc / 点遮罩 / 关闭按钮均可用；深色主题与 1100px 以下窄窗口布局不破版。 |

### 任务 7：关联项目分区

| 属性 | 值 |
|------|-----|
| **描述** | 列表显示目标项目名、路径、备注输入框与移除按钮；「添加关联」用内联搜索选择器（复用 [lib/project-palette.js](file:///D:/job/peoject-manager/web/src/lib/project-palette.js) 的 `matchProjects`），排除自身、已关联项目和已归档项目。备注失焦即保存（`api.updateProject(id, { extras: { links } })`），乐观更新、失败回滚并 Toast。目标已归档显示「已归档」，已删除显示「已失效」，均可移除。单向写入，不触碰对方项目。 |
| **依赖关系** | 任务 6 |
| **验收标准** | A 关联 B 后 A 显示关联，B 的设置里看不到 A；备注刷新后保留；重复添加与自关联被阻止；删除 B 项目后 A 显示「已失效」且可移除；搜索中文与拼音均能命中。 |

### 任务 8：环境变量分区

| 属性 | 值 |
|------|-----|
| **描述** | `KEY` / `VALUE` 两列输入（mono 字体），支持新增与删除，失焦即保存。就地校验：key 正则、忽略大小写重复、key 为空；错误只提示不落库。分区顶部说明「启动台命令默认注入；单条命令可在命令设置里关闭；Agent 认领任务时可通过 /next 读取」。 |
| **依赖关系** | 任务 6 |
| **验收标准** | 新增 `JAVA_HOME` 后启动命令生效；删除后不再注入；重复 key（含大小写不同）被拦截；刷新后条目保留；错误提示不导致其他条目丢失。 |

### 任务 9：规则分区

| 属性 | 值 |
|------|-----|
| **描述** | 每条规则含标题、正文 textarea、启用开关与删除按钮；失焦或切换开关即保存。顶部说明「启用的规则会在 Agent 认领任务时随 /next 下发，`pm_get_project` 也可读取」，并给一条示例（如「docs 条目过多时调用收敛文档 Skill」）。正文保留换行与纯文本。 |
| **依赖关系** | 任务 6 |
| **验收标准** | 新增规则后 `/next` 的 `project.rules` 含该条；关闭启用后不再下发；正文换行保留；标题/正文超长被截断或拒绝；刷新后条目与启用态保留。 |

### 任务 10：联调与回归

| 属性 | 值 |
|------|-----|
| **描述** | 运行 `npm run check` 与 `npm --prefix web run build`。手工回归：旧库启动；四分区增删改与重开持久；基础区改名/改路径仍同步命令 cwd；归档与「运行中拒绝归档」不变；命令注入正反例；`/next` 与 MCP `pm_get_project` 字段；深色主题与窄窗口；新建项目流程未变；项目列表 5 秒轮询响应体无明显增大。 |
| **依赖关系** | 任务 1–9 |
| **验收标准** | 构建与语法检查通过；上述手工用例全部通过；无控制台报错；旧数据无感升级。 |

### 任务 11：文档定稿

| 属性 | 值 |
|------|-----|
| **描述** | 将本规划整理为决策记录（`status: accepted`），在 [doc/projects.md](file:///D:/job/peoject-manager/doc/projects.md) 或本文件补充「项目扩展信息」关键决策；在 [doc/launch-and-runs.md](file:///D:/job/peoject-manager/doc/launch-and-runs.md) 记录环境注入与单命令关闭规则；如 README 功能列表需要，补一句。 |
| **依赖关系** | 任务 10 |
| **验收标准** | 决策记录与实际实现一致，包含拒绝过的方案（页签入口、双向关联、结构化规则）与理由；文档间不出现字段名不一致。 |

## 4. 执行顺序

```
1 → 2 → 6 → 7 / 8 / 9（可并行）→ 10 → 11
1 → 3 → 4
1 → 5
```

- 任务 1、2 是数据与接口地基，必须先完成。
- 任务 3、4 是独立的命令链路，可与前端骨架并行；任务 5 只依赖任务 1。
- 任务 6 完成后，三个条目分区（7/8/9）可并行开发，共用同一套「即时保存 + 乐观更新」封装。
- 任务 10 必须在前端与后端全部合并后执行；任务 11 最后收尾。

## 5. 风险与注意

| 风险 | 应对 |
|---|---|
| 环境变量值误配（如覆盖 `PATH` / `ELECTRON_RUN_AS_NODE`） | 注入时在项目变量之后强制写入 `ELECTRON_RUN_AS_NODE: '1'`；界面对 `PATH` / `ELECTRON_RUN_AS_NODE` 给出提示但不禁用（用户自担） |
| 规则正文进入轮询或 `/next` 载荷膨胀 | 扩展信息只走单项目详情与 `/next`；设数量与长度上限；`/next` 只发启用规则 |
| 即时保存与基础保存互相覆盖 | 两类保存走不同字段；`updateProject` 只更新传入的分区；基础保存成功即关闭弹窗 |
| 关联目标被归档/删除后成孤儿 | 视图解析时标记 `exists / archived`，条目保留可移除，不做级联删除 |
| 旧库无 `extras` | 读时 `Array.isArray` 兜底为空数组，不写回、不迁移 |

## Complements

### 1. 数据模型与项目详情视图
- **状态**：✅ 已完成
- **修改文件**：
  - `electron/services/domain/views.js` — 新增 `projectExtras(p)`：关联解析目标 `name/path/archived/exists`，env/rules 原样返回；导出该函数
  - `electron/services/domain/projects.js` — `project` 动作返回 `{ project, extras }`
  - `electron/services/domain/auto-claim.js` — `/next` 的 `project` 平铺 `links/env/rules`
- **审查结果**：审查通过（旧库兜底、project/next 载荷、轮询不膨胀均符合；updater/mcp-http 的改动为会话前已有工作区变更，与本任务无关）
- **完成时间**：2026-11-24

### 2. updateProject 扩展与校验
- **状态**：✅ 已完成
- **修改文件**：
  - `electron/services/domain/projects.js` — 新增 `normalizeLinks / normalizeEnv / normalizeRules`；`updateProject` 接受 `patch.extras`，先整体校验再落库；截断上限、环境变量忽略大小写去重、禁止自关联/重复关联/不存在的目标；审计 `changes` 增加 `links/env/rules`；返回值补 `extras`
- **审查结果**：待审查
- **完成时间**：2026-11-24



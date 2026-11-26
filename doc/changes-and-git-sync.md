---
date: 2026-11-11
description: 修改记录页（提交树 / 右面板内容 / 本地提交）、远程位置与拉取推送、嵌套仓库口径、路径失效与 git 凭据失效呈现、启动自动拉取与改路径联动
status: accepted
---

# 修改记录与 git 同步 — 决策记录

> 状态：✅ 已验收（2026-11-01）；提交详情布局调整于 2026-11-11，待验证

## 1. 目标与范围

修改记录页是当前选中项目的项目内视图：中区是提交树（当前改动 + 提交历史 + 加载更多），右面板承接提交详情（markdown 说明 + 本次改动的文件清单）与当前改动的单文件 diff，信息条给出工作区状态、远程位置与本地提交入口。三栏壳层与布局记忆见 `doc/app-shell-and-navigation.md`，本文只记修改记录页自身与 git 同步。

- 读：当前改动、提交历史、单文件 diff、远程位置与远程列表。
- 写：仅三种——`git pull --ff-only`、无参数 `git push`（当前分支 → 已配置上游）、项目目录范围的本地提交；提交只落本地，不推送。
- 不做：部分暂存 / 回滚 / 切分支 / `push --force` / `push --all`、提交间两两对比、多仓库聚合、gitk 式 lane 图、冲突解决界面、定时拉取。
- 应用内不提供交互式 git 登录，凭据失效降级为界面提示（见 2.5）。

## 2. 关键决策

### 2.1 数据读取与提交树

| 决策点 | 结论 | 理由 |
|---|---|---|
| 导航定位与树形态 | 与需求中心 / 启动台并列的项目内视图，入口在中区标题处的紧凑页签；平铺列表 + 缩进连线，无日期分组、无 lane 图 | 与既有页面同构，同时降低渲染与状态复杂度 |
| 当前改动 | 文件清单 + 点开看 diff（路径、状态、增删行数，含未跟踪） | 概览与细节兼顾 |
| 未跟踪文件 | 已跟踪走 `git diff HEAD`；未跟踪（`??`）无 diff，直接返回文件正文（截断） | 让新文件也有内容可看 |
| 提交历史 | 默认最近 30 条，「加载更多」每次追加 30 条 | 首屏快、可续拉 |
| 增删口径 | 全走 `--numstat`；二进制与合并提交不计、不渲染数字；未跟踪文件自己数行（≤20 个、单文件 ≤1MB） | 不补未跟踪会把「全是新文件」算成 `+0` |
| 合计位置 | 未提交合计压在「当前改动」标题行，仅 `counts.total > 0` 出现；单次提交改动量压在自己那一行 | 数字要挂在被描述对象上，给历史求和没有对照物 |
| 中区 / 右面板 | 中区只列提交信息，不内联展开；点提交在右面板看说明（markdown）与文件清单，点文件行在该行下展开 diff，同一时刻只展开一个 | 中区保持一眼可扫，长文本与文件清单都进右面板，避免两处各有一份文件清单 |
| 选中态 | `{kind:'working'|'commit-info', sha, path}` 单一来源存 App，两侧共同消费；提交内展开的文件是右面板局部状态 | 高亮与来源一致 |
| 请求竞态 | 当前改动以 `working|path` 作请求 key，丢弃过期响应；提交内 diff 按文件缓存，切换提交即重置 | 连续点文件时旧响应会覆盖 |
| 执行方式 | `execFile` + 参数数组 + `cwd`，不经 shell；sha 白名单；diff / 正文超 512KB 截断标 `truncated` | 无注入风险、输出可控 |
| 信息条 | 显示未提交文件数（有改动=琥珀、干净=绿、异常=灰），不复用需求页计数 | 信息条回答当前页关心的问题 |
| 侧栏状态灯 | 项目行有未提交改动时亮橙点，点击直达修改记录；按汇总首屏 + 30s + 手动刷新，不跟 5s 轮询 | 常驻提示不能按 5s 频次起 git 进程 |

### 2.2 远程位置与拉取推送

| 决策点 | 结论 | 理由 |
|---|---|---|
| 远程位置 | 上游分支 + `↑ahead` / `↓behind`；提交树前置远程独有提交（置灰）并标「远程在此」 | 只从 HEAD 回溯看不到远程领先的提交 |
| 首屏与缓存 | 先用本地已知跟踪引用渲染，静默 `fetch --prune --no-tags --quiet`（15s 超时）回来后异步校准；后台巡检刚抓过且未过期时直接采信（`remoteFresh`），手动刷新走 `force` 再联网；失败降级旧引用并标「可能不是最新」 | 联网不能拖住首屏，同一数字不重复付网络代价 |
| 拉取 | 仅 `pull --ff-only`；工作区脏、无上游、分叉均 409；不 stash、不 rebase | 不产生合并提交 |
| 推送 | 仅当前分支 → 已配置上游，无参数 `git push`；不 force、不 `--all`；两步确认（确认态按钮变蓝） | 覆盖远程历史风险高 |
| 方向语义 | 落后给拉取、领先给推送、分叉两者都灰、一致时无动作；不可点原因写 title | 不给注定失败的按钮 |
| 按钮形态 | 拉取 / 推送常驻、纯图标 + 差量徽标（仅在对应方向 >0 挂数字） | 能不能点就是状态，用户否决过胶囊与文字按钮 |
| 访问远程 | 信息条行尾图标按钮；单远程直接打开，多远程展开菜单；地址在主进程由 `git remote -v` 转网页地址 | 渲染端拿不到任意协议与本地文件能力 |
| 超时与进程 | 静默 fetch 15s，拉取 / 推送 60s；超时杀进程树（win32 `taskkill /T /F`） | 防残留 `git-remote-*` 进程 |
| 子目录项目 | 远程差量是仓库口径，列表按项目目录过滤时可能「远程领先但不在本项目范围内」，界面需提示 | 两种口径同时存在 |

### 2.3 本地提交

| 决策点 | 结论 | 理由 |
|---|---|---|
| 入口 | 信息条「提交」→ 弹窗确认 → 自动暂存项目目录内全部改动并提交到本地仓库 | 只提交不推送，与远程动作解耦 |
| 需求预填 | 仅 `review` 需求，打开弹窗时实时查 `pendingRequirements`，原样预填 agent 单独提供的 `completion.commitMessage`（带标准类型前缀时预选对应类型、提交时补回）；升级前的老交付没有该字段时回落 `#序号 标题` | 修改记录页不轮询需求，App 内快照可能过期；会话回复 `note` 绝不进提交正文 |
| 自动审核 | 默认勾选；提交成功后把需求置为已完成并清空备注，审核失败只提示不回滚 | 代码已落盘时打回会造成状态与仓库不一致；备注口径与需求中心一致（见 `doc/requirements-and-agent.md`） |
| 验收时提交推送 | 验收通过（`review → done`）且有未提交改动时，弹窗 / 详情验收区多一个默认勾选的「提交并推送当前 N 个文件的改动」，后面跟「查看改动」文字链接（关弹窗、跳到该项目的修改记录）；提交信息沿用 `completion.commitMessage`（与提交弹窗同一真源），先提交再推送，推送失败只提示、不阻断验收 | 待审核交付的代码大概率就是工作区里那批改动；与「提交后自动审核」互为反向，省掉两次操作 |
| 手机端验收 | 手机端没有勾选框可点，`answerRemote` 处理通过（`review → done`）时按同一口径在落库前自动提交并推送（提交信息同上）；没有仓库 / 路径失效 / 无改动则跳过提交，提交失败不落库、手机端可重试，推送失败只记日志不阻断验收 | 同一套验收语义不能因为入口不同而让代码留在工作区（见 `doc/pushgo-link.md`） |
| 提交范围 | `add -A -- .` + `commit -- .`，锁定项目目录 | 与 diff / 历史口径一致，不带走父仓库其他目录 |
| 信息结构 | 标题与补充说明分开；类型前缀只作用于标题，正文换行不受影响 | 符合 Conventional Commits |
| 类型选择 | 11 种标准类型 + 「无前缀」，标题行内嵌下拉、向上弹出、按列对齐并逐类型配色 | 选择时直接看到含义，降低误选 |
| 校验 | 空改动 / 空信息前后端双重校验；git 身份缺失单独提示 `git config user.name / user.email` | 环境性失败给可操作指令 |

### 2.4 嵌套仓库口径

| 决策点 | 结论 | 理由 |
|---|---|---|
| 范围基准 | 所有读取以项目目录为范围、项目相对路径为基准；项目是仓库根时行为不变 | 原实现会把仓库根相对路径当项目相对路径，表现为列出项目外文件 + diff 为空 |
| 当前改动 | `status --porcelain=v1 -z -- .`，用 `rev-parse --show-prefix` 剥仓库前缀；numstat 加 `--relative HEAD -- .` | `git status` 输出恒为仓库根相对且不支持 `--relative` |
| diff / 提交内容 | `git diff` / `git show` 加 `--relative`，pathspec 用项目相对路径 | pathspec 本就相对 `cwd` 解释，不必切到仓库根 |
| 提交历史 | `git log` 末尾加 `-- .`，只保留影响项目目录的提交，`hasMore` 按过滤后结果算 | 用户确认「按项目过滤」 |
| 提交文件 | `--relative` + `-- .`，只列项目内文件 | 避免出现点开即空的空提交 |
| 角标统计 | `statusCount` 限定项目子树并剥前缀，`gitSummary` 随之变化 | 项目外改动不应把项目算成脏 |
| 大小写 | 前缀匹配以 git 输出为准，win32 下大小写不敏感；匹配失败丢弃该条目 | Windows 路径大小写会让前缀匹配失败 |

### 2.5 路径失效与登录失效

| 决策点 | 结论 | 理由 |
|---|---|---|
| 先判目录 | 探测仓库前先 `dirUsable`：目录不可用时 `probe` 直接返回 `missing`，不 spawn | 目录被移动 / 删除后 spawn 报 ENOENT，会被误判成「未安装 git」 |
| 统一失效码 | 领域层 `probeRepo` 统一抛 409 `path_missing`（消息带完整路径）；其余 git 接口不再各自含糊成「非 git 仓库」 | 一个根因只对应一个可修复的提示 |
| 读汇总 | `statusCount` / `gitSummary` 返回 `pathMissing`；总览「改动与同步」列显示「路径失效」，点击直接开改路径弹窗，且不沉入空闲组 | 路径失效要修，不能跟着「干净」项目沉底 |
| 修改记录页 | 信息条显示「路径不存在」，空态给「修改路径」按钮直达项目设置；提交 / 拉取 / 推送的不可点原因同步改写 | 三种失效对应的修复动作不同，不能混为一条 |
| 三态分开 | 「路径失效」（改路径）、「不是 git 仓库」（换目录或忽略）、「没装 git」（装环境）必须分别呈现 | 合成一句「读取失败」会把用户引向错误动作 |
| 关闭交互凭据 | 所有 git 子进程带 `GIT_TERMINAL_PROMPT=0` + `GCM_INTERACTIVE=never` + `-c credential.interactive=false` | Windows 上 GCM 不认 `GIT_TERMINAL_PROMPT`，会反复弹登录框，这正是弹窗来源 |
| 失效标记 | `fetchRemote` 返回 `auth`；`pullFastForward` 抛 `auth_failed`、`pushCurrent` 抛 `push_auth`（均 409）；巡检缓存新增 `auth`，`gitSummary` 透出 `remoteAuth` | 后台巡检、进页 fetch、启动自动拉取与拉 / 推失败都写同一份缓存，提示只亮一处 |
| 顶部提示条 | `components/GitAuthBanner.jsx`：项目名 + 报错，三个选择——打开终端登录（在项目目录开终端，用户自行完成）/ 重新检查（强制一轮远程检查并刷新汇总）/ 关闭（按「项目 + 报错」签名忽略，换问题再提示） | 应用内不再支持交互式登录，一律「界面提示 + 用户自行处置」，绝不由后台弹窗 |

### 2.6 启动自动拉取与改路径联动

| 决策点 | 结论 | 理由 |
|---|---|---|
| 配置层级 | 全局 `settings.git.autoPullOnLaunch`（默认关）+ 项目 `autoPull`（true / false / null 跟随全局） | 拉取是逐仓库行为，全局一刀切会误伤本地开发中的项目；与 `aiScout` 同一模式 |
| 触发时机 | 主进程 `createWindow()` 之后延时 2.5s 后台执行 | 不挡 splash 与首帧，避开启动时的 git 预热 |
| 并发 | 3 个仓库同时跑 | 串行拖到几十秒，全并发打满网络 |
| 跳过条件 | 归档、有命令在运行、路径不存在、非 git 仓库、工作区脏、无上游、已分叉 | 都是「本就不该自动拉」的正常情况，不算失败 |
| 结果判定 | 拉取前后比 HEAD sha，用 `rev-list --count` 算真实拉下的提交数；已是最新记为「跳过」 | `remoteStatus` 的 behind 基于本地已知引用，拉取前不可信；否则每次启动都写一条审计 |
| 进度反馈 | 运行期间领域层维护逐项目进度（等待 / 正在同步 / 已完成 + 结果），代码同步弹窗每 700ms 轮询 `autoPullStatus` 渲染列表与「已完成 x/y」，结束后用最终结果覆盖并清空 | 多仓库一键拉取等待时间长，需要看到正在同步哪个、哪些已完成 |
| 一键拉取范围 | 只同步远程巡检判定「有更新」的项目（`autoPullNow` 收 `projectIds`）；待拉取列表为空或尚未巡检时按钮禁用并提示先「检查更新」；拉完用本地巡检缓存刷新落后数（`notePulled`），不再额外等一轮全量联网检查 | 用户预期是「只拉有更新的那两个仓库」，且列表全绿后「完成」必须立刻可点，不能被收尾巡检继续禁用 |
| 失败处理 | 不弹窗、不重试；只记审计 `git.pulled` / `git.pull_failed` 并把结果推给界面；凭据失效写 `noteAuthError` | 后台动作不该打断用户，细节留在代码同步设置与审计日志（见 `doc/event-log-and-notifications.md`） |
| 命令工作目录 | 改路径时迁移旧路径本身及其子目录的命令登记 `cwd`；路径规整后比较，边界必须是分隔符，盘符根保留根形态 | 命令可能登记在子目录，且要防误伤兄弟目录 |
| 运行中命令 | 不阻断改路径，只改登记值，下次启动生效 | 与项目设置「正在运行的命令不受影响」一致（见 `doc/launch-and-runs.md`） |
| 返回契约 | `updateProject` 返回 `{ project, syncedCommands }`；同步条数 >0 时提示「已同步 N 条命令的工作目录」 | 否则用户无法判断联动是否发生 |
| git 重载 | 路径确实变化才刷新侧栏角标；仅当前页是修改记录页时重拉，保留展开 / 选中态 | 改路径不改提交内容，避免在总览页白起进程 |

### 2.7 缓存与刷新策略

| 决策点 | 结论 | 理由 |
|---|---|---|
| 刷新方式 | 进页 / 切项目加载 + 信息条「刷新」按钮；不轮询 | git 命令较重，刷新属本页动作 |
| 后台模式 | 已有数据时旧内容保持可见，仅按钮转圈且不可点，返回后直接替换；拉取 / 推送 / 提交成功后的重载同走 | 不闪空态，不打断浏览 |
| 快照缓存 | 按项目缓存最近一次快照（提交 / 改动 / 远程位置），切回看过的项目先渲染自己的旧数据再后台刷新 | 不缓存就整页 loading，且必须避免跨项目串数据 |
| 预取 | 应用打开后串行静默预取所有项目（只拉本地信息、不联网）；之后选中本次运行未预取过的项目再补一次 | 进页直接命中缓存；串行避免抢占 |
| 回到窗口 | `window focus` 做一次校准：距上次 <5s 跳过；加载 / 刷新 / 拉取 / 推送进行中不打断 | 在 IDE 提交完切回来能看到新状态，又不每次聚焦都跑 git |
| 远程缓存与降级 | 远程位置由后台巡检（10 分钟、可在代码同步设置关闭）与进页 fetch 共同维护；`gitSummary` 只读缓存、不联网；fetch 失败仍用陈旧引用算 behind 并在 tooltip 标注可能过期 | 侧栏 30s 轮询不能被网络拖住，灭灯会假装一切正常 |
| 写后失效 | 拉取成功清提交文件缓存与右面板选中；推送后后台重查该项目；提交后刷新工作区与汇总 | 旧 diff 与选中在新 HEAD 下失效 |

## 3. 交付物

| 文件（相对路径） | 职责 |
|---|---|
| `electron/services/git.js` | `runGit`（受控环境 / 超时杀进程树）、`dirUsable` / `probe` / `repoPrefix` / `stripPrefix`、`commits` / `changes` / `fileDiff` / `commitFiles` / `commitFileDiff` / `statusCount`、`sumNumstat` / `countFileLines`、`remoteStatus` / `remotes` / `fetchRemote` / `pullFastForward` / `pushCurrent` / `commitAll` / `behindCount` / `headSha` / `countCommits` |
| `electron/services/domain/changes.js` | `probeRepo`（路径失效 / 无 git 统一出口）、`gitCommits` / `gitChanges` / `gitRemote` / `gitDiff` / `gitCommitFiles` / `gitCommitDiff` / `gitPull` / `gitPush` / `gitCommit` |
| `electron/services/domain/stats.js` | `gitSummary`（`pathMissing` / `behind` / `remoteAuth` 只读巡检缓存） |
| `electron/services/domain/remote-check.js` | 远程巡检、`readRemoteCache` / `isRemoteFresh` / `noteRemote` / `noteAuthError` / `notePulled` / `recheck` |
| `electron/services/domain/autopull.js` | `autoPullNow`（限并发、逐项目判定与跳过）、`autoPullStatus`（`last` + 运行期 `progress`） |
| `electron/services/domain/{settings,projects,paths}.js` | `gitSettings` / `saveGitSettings`；项目 `autoPull` 三态写入；`rebaseCwd` 与 `updateProject` 的 `syncedCommands` |
| `electron/main.js` / `electron/preload.js` | `scheduleStartupAutoPull` + `pm:auto-pull` 推送；`onAutoPull` 订阅（启动结果可能早于 React 挂载，留最近一份补发） |
| `web/src/hooks/useGit.js` | 加载 / 后台刷新 / 按项目缓存 / 预取 / 聚焦校准 / 拉取推送提交 / 验收时提交推送（`commitAndPushPending`）/ 请求序号与 pid 守卫 |
| `web/src/ChangesPage.jsx` | 项目信息条与四态空态、`RemoteSync`、`VisitButton`、提交按钮、路径失效入口 |
| `web/src/GitPanel.jsx` | 提交树：两组行 + 提交行 + 当前改动文件行、`TotalStat`、缩进连线、加载更多、远程独有提交区块 |
| `web/src/ChangeDiff.jsx` | 右面板：提交详情（markdown 说明 + 文件清单 + 单文件手风琴 diff）、当前改动文件 diff、窄栏 hint 空态 |
| `web/src/components/{CommitModal,GitAuthBanner,GitSettingsModal,MarkdownText}.jsx` | 本地提交弹窗、凭据失效提示条、代码同步设置（总开关 / 巡检 / 一键拉取与逐项目进度 / 最近结果）、markdown 唯一入口（`.md-body`，链接只放行 http(s)） |
| `web/src/App.jsx` / `web/src/OverviewPage.jsx` | 选中态与右面板分发、改路径联动与重载、凭据提示装配；总览「路径失效」列与分组 |
| `web/src/{api.js,forms.jsx,icons.jsx,constants.js}` 与 `web/src/styles/{changes,context,modal}.css` | IPC 通道；项目三态选择与提示文案；`IC.git` / `IC.pull` / `IC.push` / `IC.lock`；`CHG` 状态徽标映射；树 / diff / 远程块 / 提示条 / 提交弹窗样式 |

## 4. 关键修正与教训

- **目录不存在时的 ENOENT 会被 `runGit` 判成「没装 git」** → 探测前必须先单独判目录；两种失效对应的修复动作完全不同。
- **Windows 弹登录框的元凶是 GCM** → `GIT_TERMINAL_PROMPT=0` 对它无效，必须同时带 `GCM_INTERACTIVE=never` 与 `-c credential.interactive=false`，否则后台每轮 fetch 都弹窗。
- **`git diff-tree` 不支持 `--first-parent`** → 合并提交会列出两个父的并集；改用 `git show --no-color --format= -M --first-parent`。
- **`git status` 不支持 `--relative`** → 子目录场景只能按 `--show-prefix` 自己剥前缀；嵌套仓库的「列出项目外文件 + 点开 diff 为空」是同一根因，范围与路径基准必须同时修。
- **未跟踪文件不在 `git diff --numstat` 里** → 必须自己数行并设上限，否则新项目会显示 `+0` 且拖慢列表。
- **数字要挂在被描述对象上** → 「提交历史累计合计」被用户否掉；合计属于分组标题，单次改动量属于提交行。
- **提交说明塞进提交树会被否** → 树只留提交信息，说明进右面板并按 markdown 渲染。
- **提交行内联展开文件清单也被否** → 文件清单跟着提交详情进右面板；右面板内同一时刻只展开一个文件的 diff，避免树与详情各有一份清单。
- **滚动条可见性取决于容器** → diff 正文用 `width:max-content` 撑宽、外层 `.diff-scroll` 滚动，两层分工，否则长行底色断在半截。
- **点文件要以 `kind|sha|path` 作请求 key** → 否则后到的旧响应覆盖新选择。
- **拉取前的 behind 不可信** → 真实拉取数必须用前后 HEAD 区间计数；「已是最新」记为跳过而非拉取，否则审计被噪声淹没。
- **改路径必须联动所有派生引用** → 只改 `p.path` 会留下旧 `cwd` 静默跑旧目录；git 重载条件绑定「当前页是修改记录页」，且不清展开 / 选中态。
- **进页同步 fetch 会拖住首屏** → 先渲染本地引用再异步校准；`%D` 多引用会挤掉上游名，用 sha 匹配远程引用。
- **按钮契约要带 `isRepo`** → 否则非仓库出现置灰提交按钮；用户手改类型前缀后选择态必须同步退出。

## 5. 已知边界

- 拉取只有 `pull --ff-only`：脏工作区、无上游、分叉直接失败（`dirty_worktree` / `no_upstream` / `not_fast_forward` / `pull_failed` 均 409，超时 504），不 stash / rebase / merge。
- 推送不 force、不 `--all`：无上游 `no_upstream`、远程已前进 `push_rejected`、需凭据 `push_auth`、其余 `push_failed` 均 409，超时 504；分叉时不给按钮。
- 应用内不支持交互式登录，提示条关闭只对「同一项目 + 同一报错」生效且仅限本次运行；远程位置来自缓存（最长滞后一个巡检间隔），静默 fetch 与手动拉取可能撞 git 锁，以 `pull_failed` 透出。
- 远程地址只识别 http / https / ssh / git / scp；本地路径、`file://`、UNC 不可浏览，全部不可浏览时按钮不渲染；地址解析在主进程完成。
- 子目录项目的 behind 是整仓口径，按项目过滤后可能出现「远程领先但本项目无对应提交」。
- 行数统计缺口：合并提交与二进制不出数字；未跟踪超过 20 个或单文件超过 1MB 不计行数；不做跨提交累计。
- 提交弹窗只处理编号最大的那条 `review`，其余仍需在需求中心逐条验收；只识别标准类型前缀；不支持部分文件提交与自动推送。
- 改路径不校验新目录存在，后果留给启动与 git 探测暴露；运行中的进程不迁移；POSIX 根路径 `/` 不做迁移。
- 「立即执行一次」自动拉取仍受全局与项目开关约束，不会绕过配置；并发数固定 3。
- 错误码：非法 / 缺失 sha → 400 `bad_sha`；未知 sha → 404 `commit_not_found`；缺失 / 越界 path → 400 `bad_path`；路径失效 → 409 `path_missing`；无 git → 501 `git_unavailable`。
- 中区只持久化分组展开态；提交选中态与右面板内展开的文件不持久化；侧栏角标最长 30s 过期。

## 6. 后续候选

- 真实提交图（lane 分支连线）与提交间两两对比。
- 「提交并推送」开关、按文件勾选提交；自动拉取并发数可配；按项目查看上次拉取结果与远程检查历史。

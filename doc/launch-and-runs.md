---
date: 2026-10-28
description: 启动台与命令运行：命令经中转宿主进程托管、右面板承载运行日志与 ANSI 着色、Ctrl+P 跨项目命令面板、退出时分离 / 停止与已分离状态
status: accepted
---

# 启动台与命令运行 — 决策记录

> 状态：✅ 已验收（2026-10-19 ~ 2026-11-03）

## 1. 目标与范围

启动台（launch 页）承担项目命令的配置、启停与运行日志查看。命令执行改由独立的中转宿主托管，使应用退出时可以选择「分离」而命令继续运行；`Ctrl + P` 命令面板把跨项目启停收敛到一个输入框。本篇只记录这一层的既定契约。

- **做**：命令启停与运行状态（含「已分离」）、日志写入与右面板查看（含 ANSI 颜色）、跨项目命令面板、退出时的进程处置。
- **不做**：命令的新增 / 编辑 / 删除（仍在启动台）、PTY 与完整终端模拟、运行记录接口与轮询周期变更、日志全文后端搜索与虚拟列表、重启后重新接管分离进程、记住退出选择。
- 相关文档：右面板与壳层见 `doc/app-shell-and-navigation.md`；快捷键与改键见 `doc/search-and-shortcuts.md`；提交流程见 `doc/changes-and-git-sync.md`；IPC / MCP 通道见 `doc/architecture-and-channels.md`。

## 2. 关键决策

### 2.1 命令与宿主进程

| 决策点 | 结论 | 理由 |
|---|---|---|
| 托管方式 | 启动独立宿主 `electron/services/run-host.js`（`process.execPath` + `ELECTRON_RUN_AS_NODE=1`、`detached`、`unref`），由宿主持有真实命令的 stdout/stderr 管道 | 父进程退出后管道读端关闭，写 stdout 的 Node / Vite 类服务会因 EPIPE 自行退出，单纯「不杀」不可靠 |
| 宿主契约 | 入参 base64 JSON `{text,cwd,logFile,stateFile}`；stdout 只回一行 `PID <n>`；结束时以 tmp + rename 写 `runs/<logId>.state.json`（`hostPid` / `pid` / `status` / `exitCode` / `endedAt`）并以子进程退出码退出；env 删除 `ELECTRON_RUN_AS_NODE`，win32 前缀 `chcp 65001` | 宿主存活期等于命令存活期，探活 `hostPid` 即可判断服务是否仍在跑 |
| runner 对外语义 | `start` 拉起宿主并解析 `PID`；`stop` 结束宿主进程树（win32 `taskkill /T /F`，POSIX 进程组 `SIGTERM`）；`detachAll` 只置 `detached` 并解绑；`recover` 按宿主存活分流为 `detached` / `interrupted` | 对上层保持 `start` / `stop` / `isRunning` / `runningPid` / `recover` / `readLog` 语义不变 |
| 日志写入分工 | 宿主逐行 `appendFileSync` 写 `runs/<logId>.log`，行格式不变；应用只补手动停止的「收到停止信号」与宿主被强杀时的退出行，finalize 先读 state 再决定是否补 | 同步写保证强杀不丢缓冲；先读 state 避免手动停止恰逢自然退出时重复退出行；渲染端轮询零改动 |
| 活跃判据 | `isActive` = 本应用托管，或已分离且宿主存活；退出提示、退出停止、命令编辑 / 删除、项目归档 / 删除、恢复备份全部使用它 | 分离进程一样占端口、一样会把内存旧库写回，只看 `isRunning` 会漏掉 |
| 单实例约束 | 命令处于活跃状态时行内只给「停止」，不并排给「启动」；domain 层不拦（IPC 直接调用仍可再启一个） | 避免同位置同时提供启动与停止导致第二个实例抢端口；约束只在界面层 |

### 2.2 日志查看

| 决策点 | 结论 | 理由 |
|---|---|---|
| 承载位置 | 右面板内嵌日志容器，取代浮层抽屉；状态名 `drawerId` → `logCmdId`；未选中给引导空态；点「关闭」回到右面板默认空态 | 与三栏壳层一致，浮层遮罩与右面板职责重叠 |
| 功能保留 | 运行记录切换、贴底轮询、底部启停与「关闭全部」原样保留，只换容器 | 不改变交互能力 |
| 自动选日志 | 面板展开且未选时选「第一个运行中的命令」，没有则选「最近一次运行」，都没有则不选；仅进入页面 / 切换项目时选一次，用户关闭后保持空态 | 进入即看到最关心的输出；轮询每 2s 换新数组，不能反复抢回选择 |
| 点启动即开日志 | 在 `await startCommand` 之前先设 `logCmdId` 并自动展开面板；启动失败保留选中并用 toast 报错 | 面板立刻切到该命令，不等接口返回；失败后仍需看这次输出 |
| 底部启动 | 先把 `runId` 置空回到「最新一次运行」再启动，经 `logNonce` + `resetToken` 实现，不用 `key` 重挂载 | 停在上一次历史输出时新输出不会自愈；重挂载会清掉底部按钮 `busy`，双击又打出 409 |
| 不换行 | 日志行 `white-space: pre` 且 `flex: none`，行容器 `width: max-content; min-width: 100%`，横向滚动交给外层滚动容器 | 按行读的日志折行会破坏缩进与堆栈对齐 |
| 搜索 | `Ctrl / ⌘ + F` 打开输入条、`Esc` 关闭、`Enter` / `Shift + Enter` 上下跳，标题旁另给「搜索」按钮；命中按行归集包 `<mark>`，当前命中加 `.on` 并 `scrollIntoView({block:'nearest',inline:'nearest'})` | 快捷键是习惯路径，按钮解决可发现性；长行横向滚动后要定位到命中处 |
| 贴底守卫 | 贴底轮询加 `!(find.open && q)` 守卫；底部按钮用组件内 `busy` + `disabled` | 否则新增行会把视图拽回底部而当前命中不会滚回来；双击会打出误导性的「已在运行中」409 |
| 已分离轮询 | `detached` 且宿主存活时继续 1.5s 轮询，宿主结束后下一次拉取带回 `alive=false` 自动停 | 宿主仍在写日志，停太早会看不到尾部输出 |

### 2.3 ANSI 着色

| 决策点 | 结论 | 理由 |
|---|---|---|
| 颜色来源 | 前端解析 SGR，宿主侧注入 `FORCE_COLOR` / `CLICOLOR_FORCE` / `COLORTERM` / `TERM`（用户已设置的同名变量优先） | 不引入 PTY，同时兼容 chalk、vite 等工具 |
| 覆盖范围 | 16 色 / 256 色 / 真彩色，前景与背景，粗体 / 暗色 / 斜体 / 下划线 / 反色 / 删除线 | 覆盖常用工具输出 |
| 搜索口径 | 在可见文本上匹配，命中区间映射回样式分段后再包 `<mark>` | 不搜索转义码，也不改变命中计数行为 |
| 存储口径 | 日志文件保留原始 ANSI；界面展示时解析；全局搜索与需要纯文本的场景用 `stripAnsi` 剥离 | 界面要颜色；AI 侧已没有读日志的工具（2026-11-06 收窄） |
| 渲染安全 | 不使用 `dangerouslySetInnerHTML`，全部走 React 节点 | 日志内容来自外部进程，不能当 HTML |
| 解析容错 | 非 SGR 的 CSI / OSC / DCS / APC 连同载荷一起剥离；相邻同样式片段合并；残缺序列丢弃不抛错 | 512KB 尾部截断可能切在转义序列中间 |

### 2.4 命令面板

| 决策点 | 结论 | 理由 |
|---|---|---|
| 数据来源 | 直接读 `projects[].commands`（`projectView` 已带 `status` 与 `lastRun`），不新增后端接口或计数字段 | 侧栏本就每 5s 拉全量项目，复用即零额外请求，也不会出现面板比侧栏旧 |
| 排序 | `lastRun.startedAt` 倒序，从未启动过的时间记 0 沉底；先按「运行中 / 已停止」分组，组内再按时间倒序 | 「使用时间」就是上次真正启动的时刻，库里已有该字段；运行中置顶让想关掉的服务永远在第一屏 |
| 已启动口径 | 复用 `format.js` 的 `isCommandActive()`：`status === 'running'`，或已分离但宿主仍存活 | 与启动台、侧栏项目灯同一口径，否则已分离的服务会显示「已停止」并引导用户重复启动 |
| 执行后 | 面板保持打开，光标回到输入框 | 一次排查常要连续启停多条，关掉再按 `Ctrl + P` 是多余动作 |
| 选中保持 | 选中项记命令 id（`activeId`），不记下标 | 状态一变列表立刻重排，记下标会让第二次回车作用到别的命令 |
| 结果刷新 | 执行后立刻 `loadProjects()`，不等 5s 轮询 | 面板重排完全依赖这份数据，等轮询会让「刚启动」滞后数秒 |
| 与搜索面板 | 互斥：打开任一个都先关掉另一个；快捷键由 `useShortcuts` 统一分发，弹窗打开 / 输入法组合态 / 普通输入框聚焦时让路，面板输入框内可再按收起 | 两层浮层同时存在会抢焦点与 Esc；快捷键只有一个入口 |
| 视觉 | 复用搜索面板的浮层 / 卡片 / 行样式，只补右侧状态列（`.plight` 6px 呼吸灯）；项目名用方角色标 + 600 字重，色值与侧栏头像同源 | 两个面板是同一类东西，视觉必须一致；跨项目列表最先要认的是「哪个项目」，圆点已被活状态占用 |
| 时间展示 | 一周内用 `fmtAgo`（刚刚 / N 分钟前 / N 小时前 / N 天前），更早回落 `MM-DD HH:mm` | 列表按时间排序，读的时候要的是「多久以前」；超过一周「8 天前」没有信息量 |
| 运行时长 / 退出结果（2026-11-11） | 并入右侧状态列：运行中（含分离存活）显「运行中 · N」，用 `fmtDuration(lastRun.startedAt)`；已停止用 `runExitLabel(lastRun)` 替代「已停止」（exit 0 / exit N / 已手动停止 / 服务重启中断 / 已分离 · 已退出），从未启动仍显「已停止」；第二行不加项 | 首版把新项塞进第二行被打回（项目+文本+时间+新项 4 项平铺没有重点）；巡检视线本就在状态列，并入后信息零损失、第二行密度不变；时长随 5s 轮询重算，不加独立计时器 |

### 2.5 退出与分离

| 决策点 | 结论 | 理由 |
|---|---|---|
| 退出询问 | 有活跃命令时先把窗口带到前台，渲染端 `QuitPrompt` 自绘「分离并退出 / 停止并退出 / 取消」，默认分离、`Esc` 取消；渲染端不可用或 8 秒无回话回落系统弹窗，并补发 `dismiss` 收起自绘框 | 系统 `question` 框在 Windows 上是蓝底信息图标，视觉与语义都不对；退出不能因界面无响应卡住 |
| 分离结果 | 分离后进程与日志继续运行，下次启动显示「已分离」；`alive` 按 `hostPid` 现算，文案「已分离 · 仍在运行 / 已退出」，启动台用琥珀配色；计数、排序、日志轮询统一走 `isCommandActive` | 不出现「已停止 + pid 存活」的自相矛盾状态 |
| 停止分离进程 | 应用侧无 live 句柄，按库里的 `hostPid` 结束进程树；停止后乐观收敛为 `stopped` 并补写 `state.json` | 宿主被强杀不会触发 close，没有别的路径能改这条记录 |
| 不做 | 重启后不重新接管分离进程、不记住退出选择（`db.settings`）、不做分离进程端口占用提示与开机自启 | 管道已在分离进程里，重新纳管没有可靠路径 |

另：修改记录页「提交并自动审核」与需求中心统一为清空需求备注（空串必须在 api → IPC → dispatch → domain 全程保留），属提交流程的决策，记录在 `doc/changes-and-git-sync.md`。

## 3. 交付物

| 文件（相对路径） | 职责 |
|---|---|
| `electron/services/run-host.js` | 中转宿主：代持命令管道、注入颜色环境变量与 `chcp 65001`、逐行写日志、回传 pid、结束写 state、以子进程退出码退出 |
| `electron/services/runner.js` | 经宿主启动 / 停止；`detachAll`、`runningList`、`isAlivePid`、`detachedRun`、`stopDetached`、`writeState`、`isActive`；recover 三态分流与 state 清理 |
| `electron/main.js` | `before-quit` 询问、`beginShutdown(mode)` / `shutdown(mode)`、渲染端回话通道与 8 秒兜底 |
| `electron/ipc.js` / `preload.js` / `web/src/api.js` | `pm:quit-ask` / `pm:quit-answer` 通道与包装（退出不是领域方法，不走 dispatch） |
| `web/src/components/QuitPrompt.jsx` | 命令清单 + 两个动作卡片（带后果说明）+ 取消，默认分离 |
| `web/src/LogDrawer.jsx` | 轮询、贴底、历史运行切换、启停、关闭、`find` 搜索（`focusTick` / `activeHit`）、ANSI 渲染与命中切分 |
| `web/src/lib/ansi.js` | `parseAnsi(text)`：返回可见文本与样式分段，支持常用 SGR 与扩展色 |
| `electron/services/ansi.js` | `stripAnsi(text)`：剥离 CSI / OSC / DCS / APC 与控制字符（全局搜索与纯文本场景用） |
| `web/src/App.jsx` / `LaunchPage.jsx` | `logCmdId` 与右面板条件渲染、`defaultLogCmd` / `autoPick` / `logNonce`、`startCommand` 前置切面板、`runPaletteOpen` 与 `runFromPalette` |
| `web/src/components/RunPalette.jsx` / `web/src/lib/run-palette.js` | `collectRuns` 跨项目扁平化与分组排序、`matchRuns` 匹配（文字 / 拼音，口径见 `lib/pinyin.js`）、键盘导航与回车启停 |
| `web/src/format.js` | `fmtAgo` 相对时间与 `isCommandActive` 的统一「仍在跑」口径 |
| `electron/services/domain/views.js` / `{commands,projects,backups}.js` | `runView` 增 `hostPid` / `detachedAt` / `alive`，`runningCount` 含分离存活；运行校验与恢复守卫改走 `isActive` |
| `web/src/styles/{launch,modal,palette,tokens}.css` | 日志不换行与横向滚动、`.findbar`、命中底色、ANSI 调色板、`.run.detached` 琥珀配色、退出询问与面板样式 |

## 4. 关键修正与教训

- **「退出时不杀」不足以分离** → 子进程写 stdout、父进程退出会 EPIPE；必须由常驻宿主持管道，并对自身 stdout 的 EPIPE 一律静默。
- **宿主被强杀不会触发 close** → 停止分离进程后必须主动补写 `state.json` 与运行状态，否则库永远停在 `detached`。
- **手动停止与自然退出会写两条退出行** → finalize 补行前先读 state，只有 state 缺失或仍为 running 时才补。
- **分离进程仍占端口、仍在写库** → 所有「是否在跑」的判断必须走 `isActive`；退出提示、退出停止与恢复备份漏算分离进程，正是此后修正的重点。
- **浮层抽屉带遮罩与右面板职责重叠** → 日志改右面板内嵌，弹窗挂载与 slide / fade 动画一并移除（表单弹窗仍用的遮罩保留）。
- **`LogDrawer` 的 `runId` 是组件内 state，换命令不重置会串台** → 旧 `runId` 在新命令下查不到，表现为永远「这次运行还没有输出」；右面板渲染必须加 `key={logCommand.id}`。
- **先点历史运行再点底部「启动」，面板不回到最新运行** → `runId` 非空时不轮询也不自愈；用 `logNonce` + `resetToken` 置空。不能用 `key` 重挂载：重挂载会清掉底部按钮的 `busy`，双击照样打出 409。
- **命令启动后瞬间失败退出，`status` 直接是 stopped** → `shouldPoll` 永不成立；对最新 run id（`latestId`）变化也重拉一次，作为轮询之外的兜底。
- **消费型 effect 依赖 `cmds`，而它每 2s 换新数组** → 用 `page|pid` 作「已处理」key，一个进入周期只执行一次；`logCmdId` 的「命令不存在就清空」需加 `cmdsPid === pid` 守卫，退出项目时把所有数据归属标记一并置空。
- **`autoPick` 单槽复用依赖两个 effect 的声明顺序**（重置必须先于消费）→ 在代码里注释固化该约束，避免后续调整顺序时静默失效。
- **搜索条已打开时再按 `Ctrl + F` 或点「搜索」无反应** → `setFind({...open:true})` 不改变依赖值，聚焦 effect 不再跑，而原生查找已被 `preventDefault` 拦掉；加 `focusTick` 计数并纳入依赖。
- **点过「↑ / ↓」后输入框失焦，`Shift + Enter` 变成按钮语义** → 三个操作按钮加 `onMouseDown={e => e.preventDefault()}` 保住焦点；`.log.hit` / `.log.hit-on` 必须有真实底色，否则当前命中定位的兜底分支等于摆设。
- **搜索命中会被 ANSI 前景色覆盖，残缺扩展色（`38;5` / `38;2` 缺参数）按 0 上色会整行变黑** → 命中段显式覆盖前景与底色，参数不全一律视为无色；解析结果按行缓存，避免 1.5s 轮询重复解析整份日志。
- **命令面板别新增「使用次数 / 最近使用」字段，执行后也不能记下标** → `lastRun.startedAt` 已是上次使用时间；早期「执行后把选中项钉回原索引」定位发生在刷新数据之前，等于没钉住，记 id 天然免疫。
- **状态列不做成胶囊** → 一行里已有「回车启动 / 停止」，右侧再放带底色带边框的胶囊会被读成第二个按钮。

## 5. 已知边界

- 没有 PTY：不识别 `FORCE_COLOR` 的工具仍可能无色；`\r`、清行与光标移动被丢弃，进度条类输出与终端观感不同；真彩色在浅色背景可能对比度不足，16 色的「白色」映射为深灰系保证可读。
- 搜索是纯前端、只在已加载日志里找（后端本就只回最后 512KB）；大小写不敏感，不支持正则 / 全词匹配；超大日志配单字符或高频关键词会渲染上万 `<mark>` 可能卡顿，无虚拟列表与防抖。
- 日志运行中新增行会让命中总数变化，当前定位按序号取模，不追踪「原来那一行」；点启动后首帧可能短暂显示上一次运行，最迟约 2s 内切换。
- 面板收起时进入启动台本次不自动选，之后手动展开也不补选；自动选不参考「全部 / 运行中 / 已停止」筛选，日志面板与列表不要求一一对应。
- 分离进程无法重新纳管，只能看日志、看状态、停止；探活只校验 pid 是否存在，极端情况下会被复用的 pid 骗到，停止也走同一个 pid，不做进程名校验；POSIX 停止力度与 `SIGTERM` 相当。
- 日志由宿主与应用共同行级同步追加，存在极短的重叠窗口，不做文件锁；退出询问的系统框兜底与自绘框存在极小概率先后出现（超时后用户才作答）。
- 命令面板只覆盖未归档项目；排序依据最近一次启动时间，本轮手动停止不会把它顶上来；不显示最近日志；不做命令的增删改；状态依赖 5s 轮询，别处启停后最多滞后一个周期（面板自身执行后立即刷新）。
- 界面不允许在活跃命令上再启动一个实例，但 domain 层不拦（IPC 直接调用可以再起一个）。
- 运行期验证（真实分离、重启、停止、日志滚动、搜索、面板快捷键）依赖用户在实际应用内自测；构建产物更新后需重载应用。

## 6. 后续候选

- 日志虚拟列表（应对超大输出）；搜索支持正则 / 全词匹配。
- 可选 PTY 模式（仅在明确需要进度条 / 光标控制时评估）。
- 一个快捷键停掉所有运行中的命令；记住上次筛选词或支持 `项目:` 前缀。
- 分离进程的端口占用提示或自动接管登记；退出弹窗「记住我的选择，不再提示」。

---
date: 2026-11-06
description: 自动派发（GET /next 取即认领、三条项目级阻断、POST /release 释放）与 worker 执行手册
status: implemented
---

# 自动派发与自动执行 - 任务规划

> 状态：🧩 已实现（2026-11-06），待用户验证

## 需求概述

现在 agent 认领需求需要人指定 `taskId`（复制详情里的指令或手动调 `/claim`），一次只能推进一条。目标是让一个定时运行的执行 agent（比如每分钟跑一次）自己取活：调一个接口拿到「下一个该做的需求」并直接认领，自己开发，做完调 `/complete` 交付并等用户验收——收到「继续回复」就接着改并再次交付，通过或超时后本轮结束；用户只需要在需求中心提需求。

多 agent 并发同一个工作台时，靠「取即认领 + 项目级串行」避免两个 agent 同时改同一个项目；用户确认靠现有的「待审核」环节兜底——项目里有待审核任务时不再派发新活，等于每条交付都被用户看过之后才继续。

## 需求澄清记录

| 问题 | 结论 |
|---|---|
| 三条限制只约束新入口还是也约束 `/claim` | 只约束自动派发；手动按 `taskId` 认领的行为完全不变，可随时回退 |
| 新接口是「取即认领」还是只返回候选 | 取即认领：一次调用完成选取 + 认领，末尾同步再校验一次，两个 agent 并发不会抢到同一条 |
| agent 改完代码本身就是未提交改动，交付前是否必须提交 | 不要求提交：允许带未提交改动交付，用户验收后自己提交；未提交期间该项目不再被派发 |
| 派发范围（AI 巡检也会写需求） | 2026-11-11 改：AI 提的需求与用户勾了「候选」的需求进候选池（`status=candidate`），**不参与派发**，采纳成 `todo` 后才会被派到；手写与 AI 在「未开始」之后一视同仁，仍靠交付后的人工验收兜底 |

## 方案要点

### 三条阻断（只作用于 `/next`）

| 阻断 | 判据 | 数据来源 |
|---|---|---|
| `doing` | 项目下存在 `status === 'doing'` 的需求 | `store` 内存库，同步可得 |
| `review` | 项目下存在 `status === 'review'` 的需求 | 同上 |
| `dirty` | 项目目录范围内有未提交改动（含未跟踪） | `git.statusCount(path)`，与侧栏橙灯同一口径 |

补充口径：

- **归档项目不参与派发**；`path` 不存在、或路径不是目录的项目记 `path_missing` 阻断，不试图修。
- **候选池不参与派发，也不进 `blocked`**：候选需求 `status === 'candidate'`，而候选项目只由 `status === 'todo'` 的需求产生，所以它对 `/next` 完全不存在——不会出现在 `requirement` 里，也不会让项目以任何 `reasons` 出现在 `blocked` 里。`/claim`（按 `taskId`）对候选需求返回 409 `not_claimable`，认领入口与派发入口两处都挡。
- **非 git 仓库项目视为「无未提交改动」放行**（没有提交概念，`dirty` 无从谈起）；`git` 不可用则整个 `/next` 返回 501 `git_unavailable`（与 `gitSummary` 同口径，不静默放行）。
- **单项目 git 检查超时（5s）记 `git_timeout` 阻断**：无法证明干净就不让 agent 动文件。检查只对「可能被选中」的项目跑（已 `doing` / `review` / 无 `todo` 的项目不跑），比 `gitSummary` 的全量扫描便宜。
- **刚被自己释放过的需求冷却 30 分钟（`cooldown`）**：释放意味着「做不下去」，下一次轮询立刻再取到就会每分钟原地打转。冷却只对释放者生效，别的 agent 可以接。
- 派发按**需求创建时间升序**（FIFO，跨项目取最早的一条），同时间按 `seq`，再按项目顺序。项目内的多条 `todo` 只取最早一条。

### 取即认领与并发

一次 `/next` 分三段，只有最后一段写库：

1. 同步读库，算出「候选项目」与「已阻断项目」（`claim-gate.js`，同步、不写库，只做一次 `statSync`）。
2. 并发（4）跑候选项目的 `git status`，得到 `dirty` 结果。
3. **同步临界区**：重新读库、用第 2 段的结果判定一次，然后认领。因为这一段从判定到写库没有 `await`，Node 单线程下两个请求不可能同时通过校验并写库；被抢走的候选在重新读库时已经不在候选里，不会拿旧快照写库。

认领写入抽成 `claimLocked(r, who, via)` 由 `/claim` 与 `/next` 共用，保证事件、时间戳、状态流转只有一份实现；`via='next'` 只写进事件数据，便于事件流区分「自动」与「手动」。

### 自身在做的任务优先返回

若调用方这个 `agent` 名下已有 `doing` 任务，`/next` 直接返回它（`resumed: true`），不再去抢新任务。理由：定时任务每分钟重新起一个会话、不共享记忆，只有把在做的任务还给它，中断后才能续做；同时天然避免同一个 agent 每分钟重复认领。

代价：agent 在同一任务上反复失败会一直拿到同一条。所以本轮补一个 `POST /release`（当前认领者才能释放，任务回 `todo` 并清认领，原因留在需求的 `release` 字段上），手册要求「做不下去就释放」，把坏任务让给别的 agent / 让用户处理；释放者本人在 30 分钟内不会再被派到它。

#### 这个保证成立的前提（2026-11-06 补）

「下一轮还给它」不是队列绑定，而是**认领即所有权**：任务在 `doing` 且 `claim.agent` 等于调用方的名字，两个条件同时成立才返回。所以它依赖三件事：

1. **名字不变**：`agent` 是自报字符串，也是唯一身份。改成别的名字（哪怕只改后缀），已认领的任务就不再回到它手上 —— 此时 `/next` 会是 `requirement: null` 且 `blocked` 为空（因为项目都被别人的认领挡住了），看起来就像「没活干」。
2. **认领不被清掉**：只有三条路径会清认领 —— 用户撤销（→ `todo`）、agent `/release`、以及删除需求。回答提问、编辑正文、打回都不会清。
3. **它的定时任务还在跑**：应用不推送、不唤醒、不做超时回收；agent 自己来问才有下一步。

| 现象 | 原因 | 怎么恢复 |
|---|---|---|
| `resumed` 一直是同一条 | 正常：这条还没交付 | 交付 `/complete` 或释放 `/release` |
| 换了名字后 `no_task` + `blocked` 为空 | 身份对不上 | 在需求中心点「撤销」，任务回 `todo`，任何 agent 可接 |
| 项目归档后任务不再返回 | 归档项目不参与派发（项目级冻结，不是丢数据） | 恢复项目后 `resumed` 会继续返回；或撤销 |
| 两个同名会话拿到同一条 | 名字无法区分实例 | 多开加后缀；服务端不做租约 |

提问与回答的归属也走同一把锁：`/ask` 只允许当前认领者，`answerRequirement` 只认这条需求上未被回答的 `question`，回答直接写进该需求的 `thread`。所以「答案跟着需求走」比「同一个 agent 一定会回来」更强 —— 即使原 agent 再也不来，回答也不会丢，接手的人（或用户）都能在往返记录里读到。

### 未提交不改造成硬卡点

按澄清结论不校验 `/complete` 的工作区状态，但要在两处交代清楚：

- `/next` 的响应里 `blocked[].files` 给出未提交文件数，agent 日志里能看到「为什么没活」。
- worker 手册要求交付说明里列出本次改动的文件，提示用户「验收后提交才会继续派发」。

## Requirements

### 1. 派发闸门（同步判定，不碰 git、不写库）

| 属性 | 值 |
|------|-----|
| **目标** | 把三条阻断、冷却、候选排序、「返回自己在做的任务」收敛成 `planDispatch` / `resolveDispatch` 两个同步函数，供派发入口在两段之间插 git 检查 |
| **涉及文件** | `electron/services/domain/claim-gate.js`（新增）、`electron/services/domain/constants.js`（`RELEASE_COOLDOWN`） |
| **验收标准** | `planDispatch` 传入假 `db` 与 agent 时：`doing` / `review` / 路径失效的项目进 `blocked` 且 `reasons` 正确；无 `todo` 的受阻项目不进 `blocked`（不制造噪声）；多项目按 `createdAt` 取最早一条；同一 agent 名下有 `doing` 时返回该条；刚被该 agent 释放过的需求被跳过并记 `cooldown`，换一个 agent 名即可选中。`resolveDispatch` 传入检查结果时：`dirty` / `timedOut` / `pathMissing` 各自进 `blocked`，且「排在前面先被选中」不会让后面的脏项目缺席 `blocked`；非 git 项目按干净放行 |
| **依赖** | 无 |

### 2. 领域派发方法 `claimNextRequirement`

| 属性 | 值 |
|------|-----|
| **目标** | 组装 git 检查与原子认领，返回 `{ requirement, project, claim, resumed, blocked, scanned }`；同时把认领写入抽成 `claimLocked` 供 `/claim` 复用 |
| **涉及文件** | `electron/services/domain/auto-claim.js`（新增）、`electron/services/domain/requirements.js`、`electron/services/domain/index.js` |
| **验收标准** | 临时数据目录 + 临时 git 仓库下调用：干净项目返回任务并把需求置 `doing`、写入 `claim`；脏项目返回 `requirement: null` 且 `blocked[].reasons` 含 `dirty`；紧接着再调一次返回同一任务且 `resumed: true`；`/claim` 原有行为、事件类型与时间戳不变 |
| **依赖** | 1 |

### 3. 动作端点 `GET /next` 与 `POST /release`

| 属性 | 值 |
|------|-----|
| **目标** | 暴露两个 agent 端点并复用统一的 405 / 错误 JSON / `ok:true` 包裹口径；释放接口让做不下去的 agent 把任务放回 `todo` 并清认领，避免一条坏任务永久卡住项目 |
| **涉及文件** | `electron/mcp-http.js`（路由表）、`electron/services/domain/requirements.js`（`releaseRequirement`）、`electron/services/event-log.js`（`requirement.released` 类型） |
| **验收标准** | `GET /next?agent=` 有活时 200 且含 `requirement.id`，无活时 200 且 `requirement: null` + `blocked`（`reasons` 覆盖 `doing` / `review` / `dirty` / `path_missing` / `git_timeout` / `cooldown`），缺 `agent` 400 `missing_agent`，`git` 不可用 501 `git_unavailable`；`POST /release` 对当前认领者把需求回 `todo`、`claim` 消失、`release` 字段留下原因、事件流新增 `requirement.released`，原因超 200 字符 400 `bad_note`，他人 409 `claim_conflict`，未认领 409 `not_claimed`，待审核态 409 `not_releasable`；`/next` 非 GET 405、`/release` 非 POST 405；`/claim`、`/complete` 行为不变 |
| **依赖** | 2 |

### 4. 事件流文案

| 属性 | 值 |
|------|-----|
| **目标** | 事件列表能正确显示「释放需求」，并把自动派发认领与手动认领区分开（`data.via === 'next'`） |
| **涉及文件** | `web/src/lib/events-view.js` |
| **验收标准** | 事件列表与需求时间线里出现 `释放需求` 而不是裸类型名；`via=next` 的认领显示为「自动认领」，历史事件文案不变 |
| **依赖** | 3 |

### 5. worker 执行手册

| 属性 | 值 |
|------|-----|
| **目标** | `prompts/worker.md` + 注册表登记，让定时 agent 只靠一条 URL 就能跑完整闭环：取任务 → 判断续做 → 开发 → 交付 → 等验收（通过结束 / 继续回复则再开发再交付）→ 无活即退出；并规定失败时释放、一轮只做一个任务 |
| **涉及文件** | `prompts/worker.md`（新增）、`electron/prompts.js` |
| **验收标准** | `GET /prompt/worker.txt` 与 `resources/list` 都能取到；手册里每条 `curl` 示例可直接照抄跑通（含 `--data-urlencode` 与 UTF-8 说明）；执行 agent 使用注册表分配的固定 AgentID，手册明确「`requirement: null` 不要 sleep / 重试」「`resumed: true` 先看现场再续做」「交付说明列出改动文件并提示未提交」「做不下去调 `/release`」 |
| **依赖** | 3、4 |

### 7. 文档与契约同步

| 属性 | 值 |
|------|-----|
| **目标** | README 的 AI 协作段落补「自动流转」与 `worker` 手册；`requirements-and-agent.md` 补派发限制与边界；架构文档的端点清单加 `/next`、`/release` |
| **涉及文件** | `README.md`、`doc/requirements-and-agent.md`、`doc/architecture-and-channels.md` |
| **验收标准** | 每条限制都能在代码里找到落点；文档列出的端点与实际路由一致；「不要求提交 → 验收后需自己提交才继续派发」写进已知边界 |
| **依赖** | 1–5 |

### 7.1 `/next` 长轮询（2026-11-07 追加）

| 属性 | 值 |
|------|-----|
| **目标** | 把「没有活就结束」改成「没有活就在服务端等」：调度间隔可以设得很短，也不会反复空转启动 agent |
| **实现** | `GET /next` 在无任务时最多挂 `wait` 秒（默认 300，`0` 只查一次，上限 1800）；新增 `next-waiter.js` 广播信号，需求新建 / 状态流转 / 释放 / 删除、项目增改删、git 提交 / 拉取都触发 `bump`；另保留 30 秒低频兜底重查覆盖外部 git 提交与释放冷却到期 |
| **并发** | 多个等待者会被同一信号唤醒，各自重走派发闸门；真正的认领仍在 `takeNext` 的同步临界区里，只有一个能成功，其余继续等下一件 |
| **已知代价** | 7.2 之后：同一个 AgentID 并发跑多个进程不再重复开工（第二条拿到的是 `locked`），但它们可能各自去干**不同项目**，即同一 agent 名下并行跑两条任务；需要严格串行时仍然靠调度器 + 执行侧单实例锁。等待器进程内、应用重启即丢，客户端靠超时重连 |

### 7.2 项目锁与人工解锁（2026-11-08 追加）

| 属性 | 值 |
|---|---|
| **要解决的问题** | 定时任务会重叠触发，而同名 Agent 的两次运行在库里长得完全一样（`doing` + `claim.agent = 我`）：服务端没有「上一轮是否还活着」的证据，于是第二个进程被当成「回来续做」，两个进程同时改同一个项目 |
| **做法** | 项目里有 `doing` 就等于**锁住**：`/next` 谁都不派（含认领人自己）。用户点「解锁项目」给这条需求签一张**一次性通行证** `r.unlock`，下一轮 `/next` 按 resume 还给本人并当场销掉 |
| **为什么不加 `resumable` 字段** | 字段的正确性取决于「上一轮是否还活着」，而死掉的进程没有机会写它；由服务端在 close 事件里写，也只能覆盖 `/ask`、`/complete` 两个窗口，开发阶段（最长、最常断）零请求、无事件可依据。默认拒绝 + 不完整检测 = 任务卡死 |
| **为什么粒度是项目** | 锁的来源是那条 `doing`，一条坏任务只停摆一个项目，agent 还能去别的项目 —— 之前 resume 短路会让整台 agent 被一条任务饿死 |
| **涉及文件** | `claim-gate.js`（resume 需 `unlock`；新原因码 `locked`；锁着不短路、继续算别的项目）、`auto-claim.js`（`consumeUnlock`，两个 resume 出口都不许隔 await）、`requirements.js`（`unlockRequirement` / `relockRequirement`；打回时自动签发；离开 `doing`、释放、新认领都作废）、`views.js`（`reqView.unlock`、`projectView.locked/lockedCount`） |
| **边界** | ① `/claim` 手动认领不看锁，是刻意保留的逃生口；② 交付后停在 `review` 是「等你验收」，不是锁，点解锁无效；③ 一次性通行证意味着中途断两次要点两次；④ 一次授权只放行一轮，靠「判断与消费之间没有 await」保证（与 `claimLocked` 同一个临界区假设） |

## 已知边界

- **不做内置调度器**：定时触发在 agent 侧（客户端 automation）配置，应用只提供接口与手册；与既有「不做内置调度器 / 认领超时 / 心跳」的取舍一致。
- 不做 `dryRun` 预览、不做按项目过滤派发、不做单项目并行多任务、不做派发面板 UI。
- agent 身份不再是自报名字：在「AI 接入 → 自动认领」创建 Agent 后由工作台分配固定 AgentID，复制接入说明时注入；注册表目前不支持改名 / 删除，历史自报名字的需求不自动迁移。
- agent 被杀 / 失联后任务停在 `doing`，需用户在需求行点「撤销」或由该 agent 下次 `/release`；应用不会超时回收。
- 释放只冷却 30 分钟且只对释放者生效：冷却到期后同一个 agent 会再次拿到这条（如果还没人处理），这是「不引入尝试次数统计」的取舍；要彻底挡住得手动改状态或删需求。
- 释放原因上限 200 字符（事件流 `data.note` 只保留 200，放宽会静默截断）；完整原因存在需求的 `release` 字段上，但界面暂不展示，只在 `/next`、`/claim` 的返回里给 agent 看。
- 用户验收通过但没提交代码的项目会一直停在「未提交」阻断上，直到手动提交——这是「不要求提交」的既定代价，靠 agent 交付说明与侧栏橙灯提示。
- 每条需求的处理延迟不再受定时间隔限制：`/next` 长轮询会在需求新建 / 状态放行时立刻返回；但外部 git 提交、释放冷却到期靠 30 秒兜底重查，最坏延迟约 30 秒。

## Complements

### 1. 派发闸门（同步判定，不碰 git、不写库）
- **状态**：✅ 已完成
- **变更文件**：`electron/services/domain/claim-gate.js`（新增：`planDispatch` / `resolveDispatch`、FIFO 排序、resume、冷却、`statSync` 目录判定）、`electron/services/domain/constants.js`（`RELEASE_COOLDOWN = 30min`）
- **审查结果**：通过（证据：假 `db` 直调两个纯同步函数，覆盖归档 / `doing` / `review` / `dirty` / `path_missing` / `git_timeout` / `cooldown` / 非 git / 无检查结果；`blocked` 在命中候选后仍完整，路径为文件时进 `path_missing`）
- **完成时间**：2026-11-06 09:50

### 2. 领域派发方法 `claimNextRequirement`
- **状态**：✅ 已完成
- **变更文件**：`electron/services/domain/auto-claim.js`（新增：候选并发查 `git.statusCount`、5s 超时、同步临界区认领）、`electron/services/domain/requirements.js`（抽出 `claimLocked(r, who, via)`，先取项目再落库）、`electron/services/domain/index.js`（注册）、`electron/services/domain/views.js`（`reqView.release`）
- **审查结果**：通过（证据：临时数据目录 + 临时 git 仓库冒烟 11 项——首个选取 / `resumed` 续做 / 其它 agent 无活 / 释放 / 他人释放 409 / 释放原因超长 400 / 冷却期内不派给自己 / 换 agent 接手 / 交付后 no_task / 事件 `via=next` / 两个 agent 并发拿到不同任务）
- **完成时间**：2026-11-06 09:52

### 3. 动作端点 `GET /next` 与 `POST /release`
- **状态**：✅ 已完成
- **变更文件**：`electron/mcp-http.js`（`AGENT_ROUTES` 路由表，新增两条并收敛原 if 分支）、`electron/services/domain/requirements.js`（`releaseRequirement`：仅认领者、仅 `doing`、原因 ≤200、写 `release` 字段）、`electron/services/event-log.js`（`requirement.released` 类型）
- **审查结果**：通过（证据：把 `mcp-http.js` 复制换端口起服务实测——`/next` 缺 agent 400、正常 200、`/release` 200、`/claim` 与 `/complete` 参数不变、`POST /next` 405、`/prompt/worker.txt` 200）
- **补充（2026-11-06）**：`/complete`、`/ask`、`/release` 改为 POST + JSON body（正文不再 percent-encode，`/ask` 还能带候选），`/next`、`/claim` 仍是 GET；`agentAction` 拆成 `agentGet` / `agentPost`，共用 `respond` 收口响应形状。
- **完成时间**：2026-11-06 09:55

### 4. 事件流文案
- **状态**：✅ 已完成
- **变更文件**：`web/src/lib/events-view.js`（`requirement.released → 释放需求`、摘要「被 X 释放回未开始」、`via=next` 显示「自动认领」）
- **审查结果**：通过（证据：`npm run build` 通过；两处消费方 `AuditModal` / `RequirementDetail` 共用同一组文案函数，历史事件无 `via` 时文案不变）
- **完成时间**：2026-11-06 09:56

### 5. worker 执行手册
- **状态**：✅ 已完成
- **变更文件**：`prompts/worker.md`（新增）、`electron/prompts.js`（`REGISTRY` 增加 `worker`）
- **审查结果**：通过（证据：探针 `GET /prompt/worker.txt` 200；手册里的接口名、参数、错误码（含 `missing_task_id` / `bad_note` / `not_completable`）与原因码（含 `cooldown`）逐条对照实现）
- **完成时间**：2026-11-06 09:58

### 7. 文档与契约同步
- **状态**：✅ 已完成
- **变更文件**：`README.md`（自动流转一段、`worker` 手册）、`doc/requirements-and-agent.md`（2.4 两条决策、交付物、已知边界、后续候选）、`doc/architecture-and-channels.md`（四个动作端点）、`doc/auto-dispatch.md`（本文档）
- **审查结果**：通过（证据：文档列出的端点 / 错误码 / 原因码与代码逐一对照；`npm run check` 全绿，并把两个新文件加进 `package.json` 的 check 链）
- **完成时间**：2026-11-06 10:00

**完成总结**：自动派发闭环已实现——`GET /next` 取即认领（项目级串行：`doing` / `review` / 未提交 / 路径失效 / git 超时 / 释放冷却都拦住），`POST /release` 供失败退出，`prompts/worker.md` 是定时 agent 的执行手册。遗留：界面暂不展示 `release` 原因与本轮派发状态；同名 agent 并发无法区分为已知设计；释放冷却到期后同一 agent 会重试同一条（未做尝试次数统计）。


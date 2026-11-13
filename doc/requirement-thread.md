---
date: 2026-11-06
description: 需求往返对话（agent 提问 / 用户回答、多轮打回与再交付的完整记录）与 agent 名称口径
status: implemented
---

# 需求往返对话 - 任务规划

> 状态：🧩 已实现（2026-11-06），待用户验证

## 需求概述

自动派发打通后，agent 会长时间无人值守地干活，于是暴露出两个信息断层：

1. **agent 有疑问时没有出口**。它只能硬猜、或者把任务丢回未开始；用户完全不知道它在等什么。
2. **多轮验收的往返会丢**。`completion` 只保留最近一次交付、`feedback` 只保留最近一次回传原因（打回 / 撤销），用户打回三轮后，前两轮说过什么就查不到了，agent 也无法从历史里看出「哪些方案已经被否掉」。

本变更给每条需求加一条**消息流**：交付、打回、通过、拒绝、提问、回答、释放都按时间追加，详情面板按对话展示；agent 可以 `POST /ask` 提问（可附候选），用户在弹出的回复框里回答，回答写回同一条消息流，agent 下一轮轮询 `GET /next`（`resumed`）时读到。

同时把手册里的 agent 名称示例从 `worker-1` 这类占位符改成真实客户端名（claudecode / codex / workbuddy / qoder / trae…），名字是「谁在干活」的唯一标识，用无意义字符串会让事件流和冲突提示失去意义。

## 方案要点

| 决策点 | 结论 | 理由 |
|---|---|---|
| 提问是否改状态 | **不改状态**，只加 `question` 字段；需求仍是 `doing`，认领保留 | 项目仍被「有进行中任务」挡住，不会同时开新活；用户回答后原 agent 续做，语义与 `resumed` 一致 |
| 回答后由谁继续 | 原 agent（认领不变）；它失联时用户点「撤销」放回未开始 | 上下文在原 agent 手里；撤销是既有逃生口 |
| 往返记录存哪 | `requirement.thread` 消息流，最多 50 条（超出丢最早） | 一句一条、按时间可读；50 条足够一个需求的生命周期，`/next` 每次回传也不会膨胀 |
| `completion` / `feedback` | **保留**，作为「最新一条」快照；`feedback.kind` 区分打回与撤销；thread 才是完整历史 | agent 契约（`/claim`、`/complete` 文档）不变，旧需求没有 thread 也能照常工作；同一个字段就能回答「最近一次为什么回传」 |
| 提问与回答的通道 | 提问走 `POST /ask`（JSON body：`taskId` / `agent` / `text` / `options` / `default`）；回答只走应用内 IPC | 正文与候选走 body，不必 percent-encode；回答方只有用户，不对外暴露 |
| 提问是长请求 | `/ask` 在服务端挂住最多 5 分钟等回答：用户回答、超时取默认、超时作废三种收尾，agent 拿到结果就地继续 | 无人值守时「问完就结束、下一轮再看」会让一条需求白等一分钟；长请求承认这次调用慢，但把等待放在服务端而不是让 agent 空转 |
| 超时默认 | agent 在 `default` 里给自己的退路；超时把它当回答写进 `thread`（`kind=fallback`），返回 `answer.source=default` | 只有 agent 知道什么退路是安全的；没有 `default` 就作废（`kind=timeout`），不替它编答案 |
| 提问前置条件 | 必须是当前认领者、状态为 `doing`、文本非空且 ≤1000 字符；同一需求已有待回答提问时 409 `question_pending` | 待审核已经交到用户手上；两个并发等待会抢同一个回答 |
| 回答前置条件 | 存在 `question`；文本非空且 ≤2000 字符 | 没有待回答的提问时回答无处安放 |
| 待回答的寿命 | **跟着认领走**：撤销（→ `todo`）、释放、进入待审核 / 终态时清掉；超时（5 分钟）也清；另有 10 分钟 TTL 兜底 | 提问属于提问的那个 agent；任务换人或结束还挂着「等你回答」，会让下一位 agent 以为自己在等一个不会来的答复（原文仍留在 `thread` 里） |
| 迟到的回答 | 超时即关闭提问，之后回答 409 `no_question`，不保留「补答」入口 | 否则会出现「回答了但 agent 已经按默认走远」，界面还要多一个「已超时」态；想改就等交付后打回 |
| 提醒层次 | 需求行「待回答」徽标 + 详情回复框 + 侧栏需求灯文案 + 总览分布 | 不加系统通知：提问天然停在「进行中」，不会丢；进应用就能看到 |
| 侧栏需求灯 | `questionCount > 0` 时灯改称「N 条待回答」，沿用待审核那套静态中空环 | 色板已满，形态语义是「停在原地等你」，与待审核同类 |

## Requirements

### 1. 消息流与提问字段（领域层）

| 属性 | 值 |
|------|-----|
| **目标** | 需求上增加 `question`（待回答）与 `thread`（消息流）；交付 / 打回 / 通过 / 拒绝 / 释放 / 提问 / 回答都追加一条记录，`reqView` 一并返回 |
| **涉及文件** | `electron/services/domain/requirements.js`、`electron/services/domain/views.js` |
| **验收标准** | `reqView` 带 `question`（`at` / `agent` / `text`）与 `thread`（`id` / `at` / `role` / `kind` / `agent` / `text`）；`completeRequirement` 追加 `delivery`、打回追加 `rejection`、撤销已完成追加 `reopen`、通过追加 `approval`、拒绝追加 `rejected`、`releaseRequirement` 追加 `release`；thread 超过 50 条丢最早；既有 `completion` / `feedback` 字段行为不变 |
| **依赖** | 无 |

### 2. 提问与回答

| 属性 | 值 |
|------|-----|
| **目标** | `askRequirement`（agent 提问）与 `answerRequirement`（用户回答）两个领域方法，各留一条事件 |
| **涉及文件** | `electron/services/domain/requirements.js`、`electron/services/event-log.js`、`electron/mcp-http.js` |
| **验收标准** | 提问：非认领者 409 `claim_conflict`、未认领 409 `not_claimed`、非 `doing` 409 `not_askable`、已有待回答 409 `question_pending`、空文本 400 `bad_question`、超长 400 `bad_question`，成功后 `question` 有 `expiresAt` 与 `default`；等待：用户回答返回 `answer.source=user`，超时有 `default` 返回 `answer.source=default` 且 thread 末尾 `fallback`，超时无 `default` 返回 `answer:null` 且 thread 末尾 `timeout`，超时后再回答 409 `no_question`；`/next` 遇到超过 10 分钟的提问先清掉（`expiredQuestion: true`）；`POST /ask` 带 JSON body，非 POST 405、非 JSON 415、坏 JSON 400 `bad_json`，候选超 5 条或单条超 120 字 400 `bad_question`；错误 JSON 与其它动作端点同形 |
| **依赖** | 1 |

### 3. 详情面板：往返记录与回复框

| 属性 | 值 |
|------|-----|
| **目标** | 「打回原因」「本次交付」两个独立区块合并成一条按轮次分组的往返记录：一次交付开启一轮，轮次与轮内都按时间正序；agent 左侧青色气泡、我右侧蓝色气泡，交付 / 打回 / 通过 / 提问 / 回答等各带图标与配色；有待回答或待审核时，该区块吸顶，下面的记录独立滚动；有待回答时在备注下方给出提问原文与回复框，提交后刷新详情 |
| **涉及文件** | `web/src/RequirementDetail.jsx`、`web/src/components/RightPanel.jsx`、`web/src/App.jsx`、`web/src/api.js`、`web/src/styles/requirements.css` |
| **验收标准** | 有 thread 时按轮次分组展示，每次交付开启新一轮（交付前的问答归该轮），轮次与轮内都按时间正序；agent 与我的消息左右分列、青 / 蓝气泡区分，消息类型带图标与彩色标签；待回答 / 待审核区块吸顶，滚动记录时始终可回复或验收；旧需求（无 thread）仍显示上一次交付与打回原因；有待回答时回复框可见、空文本不可提交、提交成功后待回答区块消失且新记录出现在最下方；失败提示走 `rd-err`，不吞错误 |
| **依赖** | 1、2 |

### 4. 待回答的可见性

| 属性 | 值 |
|------|-----|
| **目标** | 需求行出「待回答」徽标；项目视图带 `questionCount` 与 `questions` 摘要；侧栏需求灯、总览分布与右下角悬浮球都能看出来 |
| **涉及文件** | `web/src/RequirementsPage.jsx`、`web/src/Sidebar.jsx`、`web/src/OverviewPage.jsx`、`electron/services/domain/views.js`、`web/src/components/QuestionBall.jsx`、`web/src/App.jsx`、`web/src/styles/requirements.css`、`web/src/styles/question-ball.css` |
| **验收标准** | 需求行徽标悬停显示提问原文；`projectView.questionCount` 与需求里的 `question` 数量一致；`projectView.questions` 按最先到点排序，带 `requirementId` / `seq` / `title` / `agent` / `text` / `expiresAt`；侧栏灯在 `questionCount > 0` 时标签为「N 条待回答」且用静态中空环（优先级 待审核 > 待回答 > 进行中 > 未开始）；总览分布行出现「待回答 N」；任何页面（含未选中项目的总览 / 统计）右下角出现带计数的悬浮球，一条提问时点球直达该需求并展开回复框，多条时展开小列表逐条直达，回答后随 5s 轮询消失 |
| **依赖** | 1 |

### 4.7 提问可多条并存、等待时长调整为 1 小时 / 2 小时（2026-11-12 追加）
- **状态**：✅ 已完成
- **变更文件**：`electron/services/domain/{questions,requirements,views,ask-waiter,review-waiter,auto-claim}.js`、`electron/mcp-http.js`、`prompts/worker.md`、`web/src/{RequirementDetail,RequirementsPage,api}.jsx`、`web/src/components/{AskCard,QuestionBall,RightPanel}.jsx`、`web/src/hooks/useRequirements.js`、`web/src/lib/events-view.js`、`web/src/styles/panel.css`、`doc/{architecture-and-channels,requirements-and-agent}.md`、`package.json`
- **改版内容**：`ASK_TIMEOUT` 5 分钟 → 1 小时，`REVIEW_TIMEOUT` 30 分钟 → 2 小时（`ASK_TTL` 跟着抬到 70 分钟，服务端 `requestTimeout` 按最长等待自动算）；一条需求从「只允许一个提问」改为 `questions` 数组（上限 5 条），每条有独立 `questionId` / `expiresAt` / 默认回答，等待表按 questionId 建，回答按 `qid` 指定；交付 / 释放 / 改状态 / 删除会 `settleAll` 立刻结束挂起的 `/ask`，不必干等到超时。`/ask` 顺带补上漏传的 `default`（与 `fallback` 同义）与可选 `wait` 秒数。界面侧新增 `AskCard`（每条提问独立草稿与提交态），多条时整体吸顶并限高滚动；列表页角标、提醒球、项目计数都按提问条数显示。
- **设计取舍**：用数组而不是「一个提问多个子问题」——每条要有独立的等待与超时，共用一条等待会让第二条把还活着的第一次顶掉。`reqView.question` 保留为「最早那条」的兼容字段，老界面与 `web/claim-test.html` 的演示数据不用改。多条并存时回答不带 `qid` 直接 409 `need_question_id`：猜一条答错比让调用方补个 id 贵得多。
- **审查结果**：`npm run check` 与 `npm run build` 通过；临时数据目录直调领域层 22 项断言全过（两条并行提问各自答对、超时 default / 无 default、上限 5 条、释放 / 交付 / TTL 让 `/ask` 立刻返回 `cancelled`、`questionCount` 按条数统计、thread 带 `qid`）。用 Electron 加载 vite dev 上的临时页截图核对两条提问卡的深色样式与堆叠无重叠，临时文件已删除。

### 5. worker 手册：真实 agent 名 + 提问用法

| 属性 | 值 |
|------|-----|
| **目标** | 手册里的名称示例换成真实客户端名；补 `/ask` 用法、「一轮最多提一个问、提完结束本轮」、「续做时先读 thread 尾部」 |
| **涉及文件** | `prompts/worker.md` |
| **验收标准** | 手册每个示例都用 `claudecode` / `codex` / `workbuddy` / `qoder` / `trae` 这类真实客户端名，并说明同一客户端多开要加后缀；`/ask` 的参数、错误码（`not_askable` / `bad_question`）与实现一致；明确「提问后结束本轮，不要边等边干」与「读 `thread` 里的打回原因，别重复被否掉的方案」 |
| **依赖** | 2 |

### 6. 文档与事件文案

| 属性 | 值 |
|------|-----|
| **目标** | 事件流能显示「提问 / 回答」；README 与需求中心决策记录补上往返对话口径 |
| **涉及文件** | `web/src/lib/events-view.js`、`README.md`、`doc/requirements-and-agent.md` |
| **验收标准** | 事件列表与需求时间线显示「agent 提问」「已回答」而不是裸类型名；README 的自动流转段说明提问怎么用；决策记录里补 2.7 往返对话一节与已知边界 |
| **依赖** | 2 |

## 已知边界

- **提问不改状态**：项目仍被「有进行中任务」挡住，所以一个项目在等你回答时不会开新活；这是刻意的串行取舍。
- **只有一个待回答位**：agent 再提一次会覆盖 `question`，但两条提问都留在 thread 里；用户只回答最新那条。
- **待回答随认领作废**：撤销或释放后 `question` 清空，所以「提了问又把任务撤销」不会留下一个永远等不到回答的标记；提问原文仍在 thread。
- **`/ask` 是最慢的一次调用**：最多挂 5 分钟，期间占用一个 HTTP 连接；agent 客户端不能给它设短超时。连接被掐断时提问仍在库里，等下一次 `/next` 的 TTL 清理或用户的回答。
- **回答不触发唤醒别的轮次**：等着的这次 `/ask` 会被 `settle` 直接唤醒；但如果那次连接已经断了，答案只落在 `thread` 里，靠下一轮 `/next` 读到。
- **候选只是省打字**：点选会把候选原文填进回答框，最终存的是一条纯文本回答；没有「选项 id」，所以 agent 分不清「用户点了第 2 项」还是「用户自己写了同样的话」。需要区分时让候选写成各自带编号的完整说法。
- **thread 上限 50 条**：超出丢最早的，长生命周期需求的早期对话会消失；事件流（`data.note` 截 200 字）仍留审计痕迹。单条文本受各自入口限制（提问 1000、交付/回答/打回 2000、释放 200），最坏情况一条需求约 100KB，会随 5s 轮询一起回传。
- **只有「待审核 → 已完成」记 `approval`**：从「进行中」直接点「标记已完成」不走审核，也不写消息（那一步不是验收）。
- **旧需求不迁移**：`thread` 为空或缺少对应消息时，用 `completion` / `feedback` 补一条同形消息，所以升级后第一次再交付也不会让旧打回原因消失。
- **同名 agent 仍无法区分**：名称是自报的，两个同名会话会读同一条 thread。
- **提交信息不进往返记录**：`/complete` 的 `commitMessage` 只放在 `completion` 里供一键提交预填，delivery 消息只写会话回复 `note`；打回 / 撤销 / 释放清掉 `completion` 后，交谈历史里查不到提交信息。

## Complements

### 1. 消息流与提问字段（领域层）
- **状态**：✅ 已完成
- **变更文件**：`electron/services/domain/requirements.js`（`pushMessage` + 交付 / 打回 / 通过 / 拒绝 / 释放五处追加 + `askRequirement` / `answerRequirement`；**交付进待审核、撤销、释放都会清 `question`**）、`electron/services/domain/views.js`（`question` / `thread` / `questionCount`）
- **审查结果**：通过（证据：临时数据目录直调 13 项——七种消息各自落一条、多轮打回保留全部历史、`claim_conflict` / `bad_question` / `no_question` / `not_askable` 逐一触发、50 条上限丢最早、释放与撤销都清掉 `question`；复审发现「交付未清 `question`」已修并复测 `questionCount` 归零）
- **完成时间**：2026-11-06 10:25

### 2. 提问与回答
- **状态**：✅ 已完成
- **变更文件**：`electron/mcp-http.js`（`/ask` 路由）、`electron/services/event-log.js`（`requirement.asked` / `requirement.answered`）
- **审查结果**：通过（证据：换端口起服务探针——`/ask` 200、缺 agent 400、POST 405；领域层错误码逐一触发）；**2026-11-06 追加**：`/ask` 改为 `POST` + JSON body（支持 `options` 候选），GET/query 形式下线，`/complete`、`/release` 同时改 POST
- **2026-11-06 再追加**：`/ask` 改为服务端长轮询（5 分钟）：等待中的回答直接带回、超时按 `default` 收尾或作废；新增 `ask-waiter.js`（等待表 + 超时）、`requirement.timeout` 事件、`kind=fallback` / `kind=timeout` 两种消息、`question.expiresAt` / `default` 字段；`/next` 续做时清 10 分钟的僵尸提问
- **完成时间**：2026-11-06 10:26

### 3. 详情面板：往返记录与回复框
- **状态**：✅ 已完成
- **变更文件**：`web/src/RequirementDetail.jsx`、`web/src/components/RightPanel.jsx`、`web/src/App.jsx`、`web/src/api.js`、`web/src/styles/panel.css`、`web/src/styles/requirements.css`、`web/src/icons.jsx`
- **审查结果**：通过（证据：`npm run build` 通过；复审后补三处——回复框加 `status === 'doing'` 守卫、禁用态原因挂到可悬停的外层、旧数据按 `kind@at` 去重合并，升级后再交付也不丢旧打回原因；`复制给 Agent` 的指令同步补上 `/ask`、`/release`）
- **完成时间**：2026-11-06 10:28

### 4. 待回答的可见性
- **状态**：✅ 已完成
- **变更文件**：`web/src/RequirementsPage.jsx`、`web/src/Sidebar.jsx`、`web/src/OverviewPage.jsx`、`electron/services/domain/views.js`、`web/src/styles/requirements.css`
- **审查结果**：通过（证据：`questionCount` 与需求统计一致；侧栏灯优先级单测式核对见冒烟输出）
- **完成时间**：2026-11-06 10:29

### 4.1 跨项目提问悬浮球（2026-11-07 追加，同日按反馈改版）
- **状态**：✅ 已完成
- **变更文件**：`electron/services/domain/views.js`（`projectView.questions` 摘要）、`web/src/components/QuestionBall.jsx`（新增）、`web/src/App.jsx`、`web/src/styles/question-ball.css`
- **改版原因**：第一版用顶部整条提醒，用户反馈占版面太多；改成右下角 44px 悬浮球 + 计数角标，球贴在右面板左侧（面板收展时跟着挪），不压回复框
- **设计取舍**：球不做关闭按钮 —— 能关掉就又回到「不进项目就看不到」；单条提问点球直接跳，多条时向上展开小列表逐条跳；摘要挂在已有的 5s 项目轮询上，不额外发请求；点击复用 `gotoProject(p, 'req', { reqId })` 深链，由 `useDeepLinks` 选中并展开右面板
- **审查结果**：通过（证据：临时数据目录直调领域层，`questionCount=2`、`questions` 按 `expiresAt` 升序；真实前端 + 演示数据桥验证——两条提问时角标为 2、点球展开「2 条提问等你回答」列表、点条目落到 #12 并展开回复框；单条时点球不经列表直接落到 #12；右下角截图确认球体与角标观感）
- **完成时间**：2026-11-07 15:16

### 4.2 交付验收长请求与统一强提醒（2026-11-07 追加）
- **状态**：✅ 已完成
- **变更文件**：`electron/services/domain/review-waiter.js`（新增）、`electron/services/domain/requirements.js`、`electron/services/domain/views.js`、`electron/mcp-http.js`、`web/src/components/QuestionBall.jsx`、`web/src/RequirementDetail.jsx`、`web/src/hooks/useRequirements.js`、`web/src/App.jsx`、`web/src/components/RightPanel.jsx`、`web/src/styles/panel.css`、`web/src/styles/question-ball.css`
- **目标**：把「交付 → 等用户答复 → 继续开发」接成与 `/ask` 同形的长请求循环：`/complete` 置待审核后最多等 30 分钟，通过返回 `approved`，用户回复返回 `feedback` 并回进行中，agent 接着改完再交付，直到通过或超时。
- **设计取舍**：等待器只在进程内，状态仍是 `review`，没有等待者时用户照样能验收；「继续回复」复用打回路径（写 `feedback`、回 `doing`、保留认领），不新增状态或接口；强提醒球原来的提问列表扩成统一列表，待审核摘要随项目 5s 轮询带回，点条目进详情即可通过或回复。
- **审查结果**：通过（证据：临时数据目录直调领域层——待审核时 `reviews` 摘要出现 1 条；用户「继续回复」后挂起的 `/complete` 返回 `feedback` 且状态回到 `doing`；再次交付后点「通过」返回 `approved` 且状态为 `done`、摘要归零；`npm run check` 与 `npm run build` 全绿）。

### 4.3 强提醒列表改版（2026-11-07 追加）
- **状态**：✅ 已完成
- **变更文件**：`web/src/components/QuestionBall.jsx`、`web/src/styles/question-ball.css`、`web/src/App.jsx`、`electron/services/domain/views.js`（待审核摘要补 `expiresAt`）
- **改版内容**：不管几条，鼠标悬浮即展开列表；每条单行（类型图标 + 项目/编号/标题/来源 + 倒计时 + 箭头），超出用省略号；列表宽度随内容变化，最长占中间面板 2/3；提问用聊天图标、交付用对勾图标，其他类型回落铃铛图标；点击条目直达需求。
- **倒计时**：提问取 `/ask` 的 `expiresAt`，交付取 `completion.at + 30 分钟`；到点显示「已超时」，交付仍保留可验收。
- **审查结果**：待验证（`npm run build` 与运行期悬浮交互）。

### 4.4 往返记录排序与轮次分组（2026-11-07 追加）
- **状态**：✅ 已完成
- **变更文件**：`web/src/RequirementDetail.jsx`、`web/src/styles/panel.css`、`web/claim-test.html`、`README.md`、`doc/{requirement-thread,event-log-and-notifications,product-spec}.md`
- **改版内容**：往返记录按轮次分组：每次交付开启新一轮，交付前的问答归该轮；轮次与轮内都按时间正序，从上往下按时间读。agent 消息左对齐青色气泡、我的消息右对齐蓝色气泡，交付 / 打回 / 通过 / 拒绝 / 提问 / 回答 / 释放各带图标与彩色类型标签。待回答 / 待审核区块吸顶，滚动记录时始终能回复或验收。已有往返记录时不再重复展示时间线，只留「事件记录 · 查看全部」入口；无往返记录的老需求仍按原样展示最近 6 条。
- **设计取舍**：气泡底色只区分谁说的，类型差异放在图标与标签配色上，避免同一气泡叠两套颜色；轮次与轮内顺序保持一致，避免交叉阅读。吸顶底色叠在不透明的面板底色上，半透明橙底才不会让滚动内容透出来。时间线与往返记录说的是同一批事件，详情只保留对话，完整明细走审计日志。
- **审查结果**：`npm run check` 与 `npm run build` 通过；`web/claim-test.html` 补多轮演示数据与 `?ask=1` 后，在真实前端确认两轮分组、轮内正序、青 / 蓝气泡、类型图标与浅深两套配色正常、无横向溢出；滚动面板时提问 / 验收区块停在顶端；「查看全部」可打开审计并预置该需求过滤，`?thread=none` 时时间线兜底正常。

### 4.5 撤销已完成需求的原因（2026-11-09 追加）
- **状态**：✅ 已完成
- **变更文件**：`electron/services/domain/{requirements,views}.js`、`web/src/{forms.jsx,RequirementsPage.jsx,RequirementDetail.jsx,api.js}`、`web/src/hooks/useRequirements.js`、`web/src/lib/events-view.js`、`doc/{requirements-and-agent,requirement-thread,product-spec}.md`
- **改版内容**：已完成需求点「撤销」不再直接回未开始，而是弹窗必填原因；原因存 `feedback = { at, note, kind: 'reopen' }`，并追加一条 `reopen` 往返消息。agent 重新认领时 `reqView.feedback` 与 thread 都能读到，知道上一轮的「通过」已作废。列表徽标、复制内容与审计摘要按 `kind` 显示「撤销原因 / 打回原因」。
- **设计取舍**：复用 `feedback` 并加 `kind` 而不是新开字段，agent 契约仍是「读 `feedback` / `thread`」；进行中的普通撤销（无交付历史）仍直接落库，不弹窗、不写原因，避免每撤一次都要填字。
- **审查结果**：`npm run check` 与 `npm run build` 通过；临时数据目录直调领域层：`done → todo` 带原因后 `feedback.kind = reopen`、thread 末尾追加 `reopen`、事件 data 带 `feedbackKind = reopen`；下一位 agent 认领能读到该原因；非打回 / 撤销流转带 feedback 仍 400 `bad_feedback`；进行中无原因撤销不追加噪音消息。Electron 界面未做真机点击验证。

### 4.6 往返消息按 markdown 渲染（2026-11-11 追加）
- **状态**：✅ 已完成
- **变更文件**：`electron/services/domain/views.js`、`web/src/RequirementDetail.jsx`、`web/src/components/{MarkdownText,SkillChip}.jsx`、`web/src/lib/skill-refs.js`、`web/src/styles/panel.css`
- **改版内容**：往返记录的气泡从纯文本改为 `MarkdownText`，交付说明 / 打回意见 / 回答里的 markdown 语法与 `{UseSkill:x}` 技能 chip 都能正常显示；待回答的提问原文与待审核的交付说明同样按 markdown 渲染。`reqView.thread[]` 每条消息带自己的 `skills` 解析结果，历史轮次里点名的技能也能显示，「使用技能」清单仍只认正文与当前打回意见。
- **设计取舍**：逐条消息解析而不是把整条 thread 并进 `requirement.skills` —— 后者会让早已作废的技能一直挂在「使用技能」里。气泡内的 markdown 没有换行保留需求，`.rd-msg-text.md-body` 把 `pre-wrap` 收回 `normal`，避免段落内软换行被当成硬换行。
- **审查结果**：`npm run check` 与 `npm run build` 通过；直调 `reqView` 核对 thread 每条消息的 `skills` 与正文清单互不影响。Electron 界面未做真机点击验证。

### 5. worker 手册
- **状态**：✅ 已完成
- **变更文件**：`prompts/worker.md`
- **审查结果**：通过（证据：`GET /prompt/worker.txt` 可取；示例名与错误码逐条对照实现）
- **完成时间**：2026-11-06 10:30

### 6. 文档与事件文案
- **状态**：✅ 已完成
- **变更文件**：`web/src/lib/events-view.js`、`README.md`、`doc/requirements-and-agent.md`
- **审查结果**：通过（证据：`npm run check` 与 `npm run build` 全绿）
- **完成时间**：2026-11-06 10:31

**完成总结**：需求内多了一条可读的往返消息流，agent 有 `/ask` 出口、用户有回复框，多轮打回不再覆盖历史。

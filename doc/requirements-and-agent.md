---
date: 2026-11-09
description: 需求中心（筛选 / 详情 / 复制 / 内联编辑 / 跨项目引用）与 Agent 协作链路（认领、交付、审核、AI 巡检）
status: accepted
---

# 需求中心与 Agent 协作 — 决策记录

> 状态：✅ 已验收（2026-10-19 ~ 2026-10-26）

## 1. 目标与范围

需求中心承载「这个项目该做什么」：中区列表负责筛选、未完成计数、状态流转与删除，右面板展示单条需求详情；Agent 协作链路让外部 agent 认领需求、交付成果、由用户审核，AI 巡检负责持续提出新需求。

- **做**：三页签列表与计数口径、右面板详情（markdown / 复制 / 内联编辑 / 删除 / 正文链接外开 / 跨项目引用）、复制按钮拆分、`GET /claim` 与 `POST /complete` 两个本机接口、待审核状态与通过 / 打回、`prompts/scout.md` 巡检真源与按项目停用开关。
- **不做**：中区列表渲染 markdown、`rehype-raw`（正文由外部 AI 写入，关闭 raw HTML 防注入）、`mailto:` / `tel:` 外开、新 MCP 工具、独立审核页签 / 审批流 / 评论、认领超时与心跳、鉴权与用户体系、内置调度器、提示词版本校验与可视化编辑。（GFM 表格原在本清单内，2026-11-15 起已支持，见第 5 节。）
- 相关文档：壳层与右面板见 `doc/app-shell-and-navigation.md`；状态色与语义色见 `doc/theme-and-identity-colors.md`；交付 / 打回事件、待审核通知与托盘角标见 `doc/event-log-and-notifications.md`；MCP 与 HTTP 通道见 `doc/architecture-and-channels.md`；项目设置与统计口径见 `doc/projects.md`、`doc/overview-and-statistics.md`。

## 2. 关键决策

状态全集 `candidate / todo / doing / review / done / rejected`（`candidate` 是候选池，2026-11-11 加入，不属流程状态）；`UNFINISHED`（旧名 `OCCUPY`）= `todo + doing + review`，待审核在验收前仍算没做完，所有计数与排序沿用该口径。

### 2.1 需求模型与状态机

| 决策点 | 结论 | 理由 |
|---|---|---|
| 状态全集 | 六态（含候选池）；`review` 只能由完成接口进入，`setRequirementStatus` 对 `review` 返回 409 `use_complete_api` | 交付入口唯一，避免人工与 agent 两条路径打架 |
| 未完成口径 | `UNFINISHED` 含 `review`；侧栏、总览、统计的未完成计数统一用它 | 验收前仍算没做完，计数口径单一 |
| 元数据位置 | `claim = {agent, at}`、`completion = {agent, at, note, commitMessage}`、`feedback = {at, note, kind}` 为独立字段，不写 `note`；`kind` 区分打回 `rejection` 与撤销重开 `reopen` | 不污染需求语义，视图投影后可撤销、可追溯；同一个字段承载「最近一次回传 agent 的原因」 |
| 交付两段文本（2026-11-10） | `completion.note` 是给用户的会话回复，进 `thread` 的 delivery 消息与详情「本次交付」；`completion.commitMessage` 是独立的 git 提交信息，只供提交弹窗预填 / 验收时提交推送使用，不进 `thread`、不进事件流 | 一键批准提交曾把会话流水账写进 commit；反过来提交信息又赖在交谈记录里。两条通道分开后互不污染，打回（清 `completion`）时提交信息自然从会话里消失 |
| 认领生命周期 | 首次认领 `todo → doing`；撤销回 `todo` 释放认领（有认领时 `DangerButton` 二次确认，2026-10-29）；`done` / `rejected` 保留记录 | 撤销是唯一人工释放路径；误点会中断 agent 协作 |
| 交付生命周期 | 打回 `review → doing` 保留认领、只清 `completion`；通过进 `done`；打回弹窗必填原因存 `feedback`（2026-10-31） | 同一个 agent 可继续改并再次交付，意见能回到 agent 侧 |
| 撤销已完成（2026-11-09） | `done → todo` 先弹窗填必填原因，存 `feedback.kind = reopen` 并追加一条 `reopen` 往返消息；不再直接落库 | 否则任务回未开始后，agent 重新认领只看到上一轮「通过」，会误以为已经完成，也不知道为什么重开 |
| 删除范围 | `deleteRequirement` 允许删任意状态（含进行中），不存在回 404 `not_found`；确认复用 `DangerButton` 两步 | 删除后自然从列表与计数消失；破坏性操作交互统一 |

### 2.2 需求中心界面

| 决策点 | 结论 | 理由 |
|---|---|---|
| 页签结构 | 「未开始」「进行中」合并为「未完成」，最终 未完成 / 已完成 / 已拒绝，默认「未完成」 | 两页签语义重复；「全部」与「未完成」高度重合 |
| 行内徽标 | 「未完成」内仍按真实状态显示未开始 / 进行中 / 待审核（待审核橙色） | 合并的是筛选视图，不是状态语义 |
| 看板未完成列排序（2026-11-13） | 只改看板这一列的列内顺序：进行中 → 待审核 按 `BOARD_COLUMNS.top` 的先后置顶，未开始排在后面，同档内保持接口给的编号从新到旧（稳定排序，不改同档相对序）；列表页签、侧栏灯 / 总览 / 悬停卡的「待审核 > 进行中 > 未开始」口径都不跟着动 | 三态挤在一列里，在跑的和已交付等验收的是这列的看点，未开始只是排队；那三处是「最该由我处理」口径，两者问的不是同一件事，混成一个序会互相顶掉 |
| Agent 名称展示（2026-11-07） | 认领徽标、提问 / 交付作者、往返记录气泡、右下角提醒、验收弹窗与事件时间线都显示 Agent 名称；需求视图与事件查询另带 `agentName`，注册表查不到（已删除 / 历史自报名字）才回落 AgentID | 用户登记名称就是为了识别；AgentID 只用于接口身份与归属判断，不该出现在界面 |
| 侧栏需求灯 | 未开始=静态蓝点、进行中=呼吸蓝点、待审核=静态中空大环（10px 外径 / 2px 线宽）；tooltip「N 条待审核 / 进行中 / 未开始」，点击直达需求中心 | 多条并存时按 待审核 > 进行中 > 未开始 只亮一盏；颜色已被五类语义占满 |
| 详情位置与选中 | 右面板；App 只存 `selReqId`，按 id 从列表实时解析，不缓存对象 | 5s 轮询会换对象引用，缓存必然过期 |
| 行内交互与状态入口 | 整行可点，行内操作统一在 `.acts` 上 `stopPropagation`；状态修改只在列表行，详情不提供 | 新增行内按钮不必逐个处理；状态流转规则独立 |
| 草稿隔离 | `App` 传 `key={selReq.id}` 强制重挂载，组件内不用 effect 回填 | 轮询刷新对象引用会冲掉正在输入的内容 |
| 校验与表单 | 前端 trim 判空并内联报错，不发请求；`RequirementForm` 只保留新建，删除 edit 分支 | 省往返、错误就地展示；编辑分支已不可达 |
| 进入自动选中 | 进入页面若面板展开且 `selReqId` 为空，自动选「编号最大的未完成需求」；删除当前后补选下一条 | 进入即看到最该处理的条目，不停在已消失的详情 |
| 自动选中判定 | 仅 `page === 'req'`、数据就绪、面板展开、页签为「未完成」；以 `page\|pid` 为 key 每周期一次（`autoPick` ref），真正选中后才标记；已完成 / 已拒绝不选，切回「未完成」补选 | 5s / 2s 轮询会反复触发；右面板必须与列表可见行对齐 |
| 正文链接外开 | 前端 `target="_blank"` 为主路径，主进程 `will-navigate` 兜底；`isAppUrl` 按 `DEV_URL` / 打包 URL 算基准，比较前去 hash / query / 末尾斜杠，前缀匹配必须带 `/` | 正文由外部 AI 写入，新入口可能绕过前端约定；带 `/` 防伪域名 |
| 归档入口与恢复（2026-11-19） | 工具栏在列表 / 看板切换前放「已归档」按钮，弹窗列出数据目录 `archive/` 下的全部归档（跨项目，带项目名），逐条「恢复」回原项目的已完成；原项目已彻底删除时仍列出但禁用恢复 | 归档是应用内唯一让记录从列表与计数里消失的动作，必须和找回入口同时交付；恢复先写库再删归档文件，失败可重试且不会两边都丢 |
| 协议放开范围 | `openExternalSafely` 只放行 http/https，其余 `preventDefault`；非 http 链接保持 inert（不加 `target`） | 避免 `file:` 等本地协议被外部内容触发 |

### 2.3 复制与文案口径

| 决策点 | 结论 | 理由 |
|---|---|---|
| 复制内容 | 标题 + 空行 + 正文 + 空行 + `备注：note`，纯文本 markdown，不含状态 / 编号 / 时间 | 粘贴到普通输入框自然，markdown 仍合法 |
| 复制给 Agent | 只给项目、任务、`/claim` 指引（含完成段与编码要求），不含正文 | agent 认领后从接口取完整内容，避免正文过期 |
| 按钮显隐 | 仅 `todo` / `doing` 显示 Agent 按钮；已认领时禁用并提示「已被 xxx 认领」 | 避免复制出去才发现被占用；审核中再给认领指令只会重复劳动 |
| 按钮布局 | 复制 / 编辑并排于详情头部；进入编辑态整体换成「取消 / 保存」并隐藏删除 | 编辑态只突出保存，避免误删 |
| 任务标识 | 接口只接受内部 id `r_xxx`；文案同时标出可读的 `#seq` | 跨项目序号会冲突 |

### 2.4 认领与交付接口

| 决策点 | 结论 | 理由 |
|---|---|---|
| 接口形态 | 挂现有本地 HTTP（127.0.0.1:7318）的 `GET /claim` / `POST /complete`，不新增 MCP 工具；共用 `respond` 的 JSON 响应、405 与错误透出 | 与既有接入姿态一致，保持单一写入者 |
| 认领语义 | 先到先得：同一 agent 幂等；不同 agent 409 `claim_conflict` 并附当前认领者；终态 409 | 简单协作锁，不引入超时 |
| 完成权限与重复提交 | 仅当前认领者；未认领 409 `not_claimed`，他人 409 `claim_conflict`；重复提交幂等，不改 `completion` 与 `updatedAt` | 交付必须可归因；重试不该冲掉审核中的信息 |
| 交付是长请求 | `/complete` 置待审核后在服务端最多等 30 分钟：通过返回 `approved`，用户继续回复返回 `feedback` 并回进行中，超时返回 `timedOut` 且交付留在待审核 | agent 不必靠轮询判断验收结果；用户回复能直接续做，形成「交付 → 等答复 → 继续开发」的闭环 |
| 参数校验 | `taskId` 必填；`agent` trim 后非空、≤64 字符、拒绝控制字符；区分「缺失」与「非法」错误码 | 接口仍按字符串校验，AgentID 也走同一套 |
| Agent 身份 | 执行 agent 不再自报名字：在「AI 接入 → Agent 管理」添加 Agent（可从本机已装客户端一键登记，也可自定义），工作台用 `store.uid('a')` 分配 AgentID（与项目 / 需求同形），复制接入说明时自动写入；所有动作接口的 `agent` 参数都用它；界面展示名称而非 ID | 名字自报不稳定，改名或重名会让已认领任务找不回来；固定 ID 才能让任务归属可预测，名称只用于识别 |
| 完成说明与编码 | `note`（会话回复）与 `commitMessage`（git 提交信息）都可选、各 ≤2000 字符，超长分别 400 `bad_note` / `bad_commit_message`；两字段与 `agent` 含 U+FFFD 一律 400 `bad_encoding`，文案给出编码示例与 `curl -G --data-urlencode` | GBK 编码按 UTF-8 解码后原字节已丢；只写「做 URL 编码」不够，须写明字符集 |
| 安全姿态 | 仅绑定 `127.0.0.1`、无鉴权；`GET` 带副作用与 MCP 同姿态，接口不可达先确认应用在运行 | 本机单用户工具，暂不引鉴权 |
| 自动派发入口 | `GET /next`（取即认领）：项目有 `doing` / `review` / 未提交改动时不出活；没有活时在服务端长等（默认 5 分钟，`wait` 可调），有变更立即返回。该限制只作用于本入口，`/claim` 语义不变 | 定时 agent 不必知道 `taskId`；调度间隔可以很短而不会反复空转，项目级串行换取「验收后才开下一件」 |
| 释放入口 | 新增 `POST /release`（JSON body）：当前认领者把 `doing` 退回 `todo` 并清认领，记 `requirement.released` | 坏任务不该永久卡住整个项目；待审核不可释放，交付已交到用户手上 |

派发与释放的完整口径见 `doc/auto-dispatch.md`。

### 2.5 审核与打回

| 决策点 | 结论 | 理由 |
|---|---|---|
| 界面呈现 | 列表行保留「通过 / 打回」；详情面板在待审核时增加「通过 / 继续回复」区块 | 从强提醒点进来就能直接验收或回复，不必退回列表 |
| 详情面板 | 「本次交付」区块展示 agent、时间、说明与回复框；通过即完成，回复则回进行中并携带有意见 | 验收动作贴着证据放，回复就是下一轮开发的输入 |
| 验收时提交推送 | 通过待审核需求时，若工作区有未提交改动，列表验收弹窗与详情验收区都多一个默认勾选的「提交并推送当前 N 个文件的改动」，后面跟「查看改动」文字链接，点了关掉弹窗/切到该项目的修改记录页；先提交再推送，推送失败只提示、不阻断验收 | 待审核交付的代码大概率就是工作区那批改动，省掉「先去修改记录提交、再回来点通过」两步（git 细节见 `doc/changes-and-git-sync.md`） |
| 手机端通过 | 手机端没有勾选框，`answerRemote` 在落库前按同一口径自动提交并推送；提交失败不落库（手机端可重试），推送失败只记日志不阻断 | 验收语义不因入口不同而变，代码不会因为手机点通过就留在工作区 |
| 打回去向 | 回 `doing` 并保留认领，可再次交付；意见写 `feedback` 并随 `/complete` 的返回值带回 | 归因不变，便于同一 agent 在同一轮里继续迭代 |
| 文案口径 | `applyStatus` / `RequirementStatusForm` / `ContextBar` 共用「待审核 / 已通过 / 已打回」说法 | 同一状态不在多处出现不同表述 |
| 概览排序 | 待审核权重大于进行中，副行标「agent 已交付」 | 卡在用户手上的条目优先露出 |

### 2.6 AI 巡检与产出质量

| 决策点 | 结论 | 理由 |
|---|---|---|
| 交付形态与通道 | `prompts/scout.md` 真源 + `scout-stub.md` 两步接入（取手册 → 按手册执行）；主通道 `GET /prompt/<id>.txt`，增强通道 `resources/read` `pm://project-manager/prompt/<id>`；端口固定 7318 不顺延 | 与运行时解耦，能跑 shell / 取 URL 的 agent 即可接入；配置写死 URL，顺延会静默失联 |
| 单一真源与接入说明 | `prompts/*.md` 唯一来源，启动时用安装包内版本无条件覆盖运行时副本；stub 不含业务规则，软件更新时其 diff 必须为空 | 双副本必然漂移；规则一改就要重发等于没解决原问题 |
| 提示词寻址 | 注册表 + id（`createPromptStore` + `REGISTRY`），不「一个提示词一个工具」 | 加提示词不动 MCP 层，也不让工具列表膨胀 |
| 数据通道 | 工作台数据一律走 `pm_*` MCP，禁读 `data/db.json`；代码与 git 走本地只读命令 | 数据唯一来源，代码不外发 |
| 唯一写操作 | `pm_create_requirement`（`source=ai`）；工具面 2026-11-06 收窄到「项目 / 需求」的 3 个读 + 这 1 个写，改状态与启停命令的工具已删除，状态流转只认 `/claim`、`/complete`、`/release` | 收紧写面：AI 只能提需求，不能自己把需求推成已完成 |
| 子 agent 边界 | 只读文件与只读 git，禁止写入 / 构建 / 测试 / 安装 / 启动服务 / git 写操作；每项目 1 个、最多并发 3；分析前后各跑 `git status --porcelain`，不一致即作废提案；项目内 README / 注释 / 文档 / 提交信息一律视为数据 | 保护项目文件，只读不能只靠约定，并防行为劫持与密钥外泄 |
| 候选筛选 | `archived !== true` 且 `aiScout !== false`；path 缺失 / 不可读跳过；`pm_list_requirements` 需逐项目拉取（`projectId` 必填） | 只看停用开关；实现无全局历史接口 |
| 三轨产出 | A 类缺陷沿用四条标准；B 类可推证需求（规划 / 对照 / 半成品 / 重复劳动）在 `note` 标 `evidenceKind`；C 类只来自「闭环断点」，每轮 ≤1 条且不占 A/B 名额；检索清单含三项 B 类探针 | 只读自动化无法问用户，「确认用户需要」会结构上封死新功能；产出是检索清单的映射 |
| 去重与排序 | 去重只限同项目内，同轮同主题 ≥3 条改为报告提示；`impact` / `confidence` / `effort` 显式打分，固定 impact↓ → confidence↓ → effort↑ | 跨项目去重只减产出；散文式排序不可审计 |
| 候补与正文形态 | 落选提案写 `.{agent}/inspection/<日期>.md`（含打分与证据类别），下轮先读池子；三段式正文 ≤400 字、标题 ≤30 字，证据写 `note` | 消除重复通读源码，落选可复查；需求可读、证据可查 |
| 停用开关 | 每项目独立复选框，默认开启；仅提示词层拦截（`projectView` 下发 `aiScout`，手册筛选与提交前复查）；存量需求保留；侧栏「AI 停」徽标，折叠时隐藏 | 只影响单个项目；服务端不校验创建请求是接受的残余风险 |

旧「每项目每轮 1 条」名额规则已于 2026-11-03 取消，待审核算没做完的筛选口径保留。

### 2.7 往返记录与提问

| 决策点 | 结论 | 理由 |
|---|---|---|
| 记录形态 | 需求上 `thread` 消息流（交付 / 打回 / 撤销 / 通过 / 拒绝 / 提问 / 回答 / 释放），最多 50 条；`completion` / `feedback` 保留为「最新一条」快照 | 多轮验收时前几轮的说明与意见必须查得到；agent 契约不变 |
| 提问是否改状态 | 不改：`question = { at, agent, text }`，需求仍是 `doing`，认领保留 | 项目继续被「有进行中任务」挡住，不会同时开新活；回答后原 agent 续做 |
| 提问通道 | `POST /ask`（JSON body：`taskId` / `agent` / `text` / `options` / `default`），仅当前认领者、仅 `doing`、正文 ≤1000 字符、候选 2–5 条 | agent 端只需要一条 URL；待审核已交到用户手上，不再接受提问 |
| 提问是长请求 | 服务端最多等 5 分钟：用户回答就带回，超时按 `default` 收尾（`answer.source=default`）或作废（`answer=null`）；已有待回答时 409 `question_pending` | 无人值守时「问完就走」会让需求白等一轮；5 分钟是「够你看到并回一句」与「agent 不至于挂死」的折中 |
| 回答通道 | 只走应用内 IPC `answerRequirement`，无人提问时 409 `no_question` | 回答方只有用户，不需要对外开放 |
| 提醒 | 任何页面右下角悬浮球：同时收集「待回答」提问与「待审核」交付；鼠标悬浮即展开单行列表（提问 / 交付用不同图标，右侧倒计时，点条目直达），最长占中间面板 2/3 + 需求行「待回答」徽标 + 详情回复框或验收区 + 侧栏需求灯（优先级 待审核 > 待回答 > 进行中 > 未开始）+ 总览分布 | 提问与验收都停在用户这儿；单行列表比多行卡片更省版面，悬浮即看不占点击次数 |
| 旧数据 | 不迁移：`thread` 为空时详情用 `completion` / `feedback` 兼容展示 | 迁移只能猜顺序，收益不及成本 |

完整口径见 `doc/requirement-thread.md`。

### 2.8 跨项目引用（2026-11-09）

| 决策点 | 结论 | 理由 |
|---|---|---|
| 语法 | 正文写 `@{项目名}`（名称不含花括号、不跨行、≤60 字符）；只解析正文，标题与备注不解析 | 花括号给「名字里有空格」划出边界；标题是一句话摘要，不需要跳转能力 |
| 解析归属 | 只在 `electron/services/domain/refs.js` 解析，结果随 `reqView.refs` 下发（列表 / 详情 / `/next` / `/claim` 同一份） | 重名取哪个、大小写、归档算不算，两处判定就会出现「界面说找到了、agent 说没找到」 |
| 重名与归档 | 名字比对忽略大小写；同名取未归档的、再取库里靠前的，`ambiguous` 标出重名；归档项目照常解析并标 `archived` | 引用指向历史项目是正常现象；解析失败比指向「差不多」的项目更糟 |
| 找不到时 | `projectId` / `path` 为 `null`；界面显示红色失效 chip，正文原文不吞掉 | 名字打错要能一眼看见，静默消失等于丢信息 |
| 显示 | `MarkdownText` 把 `@{x}` 换成 `pm-ref:` 链接再接管成 chip（可点跳转）；正文下方一行「引用项目」列全，正文里的代码块不替换；chip 与清单行悬停出与侧栏项目行同一张信息卡（`HoverCardLayer`，见 `doc/projects.md` §2.4），并让位撤掉原来的 `title`，不必跳过去也不知道那个项目现在什么样 | chip 就地可点、清单一眼看全；`pm-ref:` 必须在 `urlTransform` 里放行，否则被 react-markdown 清成空 href；悬停卡复用同一份 `projectView` 计数，两处口径不会分叉；卡与原生提示不同时出现，否则一次悬停弹两套 |
| 录入 | 正文输入框统一用 `ProjectRefInput`：打 `@` 弹项目候选（↑↓ 选择、Enter / Tab 插入、Esc 关闭），插入 `@{项目名}` | 记准项目名太麻烦；Enter 只在候选打开时接管，其余键（含换行）原样透传 |
| agent 侧 | `reqView.refs` 每条给 `name` / `projectId` / `path` / `archived` / `ambiguous` / `requirementCount` / `pendingCount` / `pending`（最多 5 条未完成需求）；`prompts/worker.md` 要求按 `path` 读被引用项目、**只读不改**，更细的需求清单走 MCP `pm_list_requirements` | 只给一个目录，agent 还得通读才敢下判断；带上「还在忙什么」才能决定读哪里。改别人的项目会破坏「只改 project.path」的边界 |
| 不做 | 不把项目 id 缓存进正文（改名即失效，属预期）、不支持引用命令、中区列表与看板仍显示原文、不预读被引用项目的 README / 目录结构 | 每加一种引用形态都要在解析 / 显示 / agent 三条链路同步；预读文件会让 `/next` 变慢且长度不可控，理解代码是 agent 按 `path` 自己做的事。（引用单条需求 / 文件已在 2.10 支持） |

### 2.9 候选需求池（2026-11-11）

起因是两条：AI 提的需求没人确认就直接进待办；用户自己灵光一现但还不成熟的想法，也不该马上被 agent 开工。于是加一个「候选池」，作为流程之前的缓冲区。

| 决策点 | 结论 | 理由 |
|---|---|---|
| 承载方式 | 新增状态 `candidate`（`STATUSES` 首位），不是独立集合 / 布尔字段 | 状态字段已经是「这条需求现在在哪」的唯一真源；另开一个 `candidate: true` 布尔值会让派发、计数、页签、状态机四处各判一次，必然漂移 |
| 入池条件 | `source === 'ai'` 或新建时勾选「候选」；用户正常新建仍是 `todo` | AI 提的必然没经人确认；人自己想清楚了的就按待办处理，不额外加一步 |
| 采纳 / 丢弃 | 候选 → `todo` 即采纳；候选 → `rejected` 即丢弃（保留记录可回看）。两个按钮只放在右侧详情里（候选提示块下方），列表行与看板卡片上不再有 | 只留两个出口；候选没有认领，不存在释放 / 打回这类中间态。放在卡上等于要求「看完正文 → 退回列表 → 再找那张卡」，一次操作被拆成三段 |
| 状态机约束 | 进候选只允许从 `todo`；从候选只能出到 `todo` / `rejected`。违例 409 `bad_status_transition` | 否则一条已认领的 `doing` 能被改成候选：认领悬空、项目锁失效，而候选又不参与派发 |
| 对 agent 的可见性 | 三重挡：派发只取 `todo`（/next 的 `requirement` 与 `blocked` 都不出现候选）、`/claim` 对候选 409 `not_claimable`、`pm_list_requirements` 不传状态时默认不含候选 | 「看不见」不能只靠一处过滤；任一入口漏了，候选需求就会被当成已确认的活开工 |
| 计数口径 | 候选不计入 `pendingCount` / `UNFINISHED`，单列 `candidateCount`；侧栏需求灯不亮候选 | 候选是「还没决定做不做」，算成未完成会让项目显示成有活，实际却派不出去 |
| 界面 | 列表新增「候选池」页签（最前）、看板新增一列、详情提示块内「采纳 / 丢弃」（2026-11-16 从行内挪进详情，卡上不再有按钮；候选卡片因此也没有按钮行）、新建表单加「先放进候选池」勾选（默认不勾） | 候选与未完成是两种东西，混在一个页签里用户会以为它已经在排队；候选的决策发生在「看完内容之后」，按钮跟着内容走 |
| 视觉 | 候选徽标不新增色相：中性灰 + `inset` 细描边 | 五类语义色已被五种状态占满（见 `doc/theme-and-identity-colors.md`），第六种颜色只会让「哪个是待办」更难认 |
| 巡检侧 | `scout.md` 说明提案会进候选池；新增去重维度：候选池里已有的同主题提案跳过（`duplicate_candidate`） | 提案不再自动进待办，若不去重，每晚都会把同一个想法重新塞进池子 |
| 不做 | 不做候选的优先级 / 打分排序、不做定时自动采纳、不做候选单独的项目视图、不做候选批量操作 | 池子的用法就是「攒着，想清楚再采纳」；排序与批量要等池子真的堆积起来再评估 |

### 2.10 引用扩展到需求与文件（2026-11-11）

2.8 只支持引用项目。本次把 `@{…}` 扩成三类，复用同一套「服务端解析一处 → 随视图下发 → 前端换 chip → agent 读坐标」的纪律，不另起炉灶。

| 决策点 | 结论 | 理由 |
|---|---|---|
| 语法 | 统一 `@{…}` 触发，按花括号内前缀分类：无前缀 `@{项目名}`＝项目（不变）、`@{#序号}`＝本项目需求、`@{file:相对路径}`＝本项目文件 | 沿用旧语法保证存量正文不失效；`#` 与 `file:` 前缀让三类一眼可辨，项目名边界（≤60）不变，文件路径放宽到 ≤235 |
| 需求按序号而非标题 | seq 在项目内唯一且稳定，标题会改、会超长、会重名 | 与项目引用「按名匹配、改名即失效」不同，需求有更好的稳定锚点就用它；归档 / 删除后 seq 解析失败标失效 |
| 只引用本项目 | 需求与文件都只认当前项目：需求按 `projectId + seq` 定位，文件按 `project.path` 解析相对路径 | 跨项目 seq 不唯一、跨项目文件路径无意义；跨项目上下文仍走 `@{项目名}` |
| 解析归属 | `refs.js` 增 `resolveReqRefs` / `resolveFileRefs`，随 `reqView.reqRefs` / `fileRefs` 下发（与 refs 同一份口径） | 三链路同步：界面说找到了、agent 也说找到了 |
| agent 侧 | 需求给 `seq / requirementId / title / status / body`（正文本就在库里，直接给省一次 MCP 往返）；文件只给 `path / absPath / exists`，**不预读内容** | 需求正文是现成数据；文件预读会拖慢 `/next` 且长度不可控，理解文件是 agent 按路径自己做的事 |
| 文件安全 | 复用 `snippet.js` 的 `assertRelPath` / `resolveInside` / `DENY_RE`：相对路径、不含 `..`、解析软链后仍在根内；密钥 / 凭据 / 依赖目录标 `restricted`、不给 absPath | 文件引用是渲染进程拿项目源码的又一个口子，宁可多拦，与证据预览同口径 |
| 文件候选 | 新增 `projectFiles` 接口：优先 `git ls-files --cached --others --exclude-standard`（尊重 .gitignore），非仓库回退到有上限的目录遍历；上限 4000、过滤密钥 | 遍历全仓库既慢又会把 node_modules 塞进候选；git 清单天然干净 |
| 显示与录入 | `MarkdownText` 增 `pm-req:` / `pm-file:` 两类 chip（需求跳详情、文件用 `shell.openPath` 打开）；`ProjectRefInput` 的 `@` 弹层按「项目 / 需求 / 文件」分组，`#` 只列需求、`file:` 只列文件 | 与项目引用同一套交互；分组让一个 `@` 覆盖三类，不用记多个触发符 |
| 不做 | 不引用命令、不跨项目引用需求 / 文件、不预读文件内容、需求 / 文件候选清单进程内按项目缓存（新建需求后需重开面板才进候选） | 命令没有稳定锚点；缓存与技能清单同策略，刷新成本不及收益 |

### 2.11 引用 chip 的正确渲染与悬停窗（2026-11-13）

| 决策点 | 结论 | 理由 |
|---|---|---|
| 症状 | 正文里的 `@{#序号}` / `@{file:路径}` 显示成红色「没有找到项目」，下方「引用需求 / 引用文件」清单却是对的 | 两份数据源不同：清单直接读服务端解析结果，正文要先过一层 markdown 链接替换 |
| 根因 | 前端 `linkifyRefs` 的 `REF_RE` 是通用词法且最先执行，却没有像服务端 `refs.js#refNames` 那样跳过 `#数字` / `file:` 前缀，把特殊 token 先换成了 `pm-ref:`（项目 id 空），后两轮 `linkifyReqRefs` / `linkifyFileRefs` 就再也匹配不到 | 一处判据漏同步，两类引用同时失效；不是解析结果错，也不是 chip 组件写错 |
| 修复 | `web/src/lib/req-refs.js` 加 `isSpecialRef()`，`refNames` 与 `linkifyRefs` 沿用服务端同一判据，特殊 token 原样留给后两轮 | 前后端解析口径必须一处为准；只传 `refs`（如历史消息）时特殊 token 保持原文，也不再变成假项目 chip |
| 需求引用悬停窗 | 参考项目弹窗（#34），走 `HoverCardLayer` 唯一实例：`.rqhover` 摊开编号 / 标题 / 状态 / 正文摘要（`reqRefs[].body` 已有，不打接口），正文清单与 chip 共用一张卡 | 判断「是不是我要引用的那条」看这四项就够；点 chip 才跳完整需求，卡片不做成第二个入口 |
| 文件引用悬停窗 | `.fhover` 悬停时才用 `fileSnippet(full)` 读项目内文件，逐行显示行号 + `hlighter.js` 语法高亮，复用 `.ev-code` 的行样式与 hljs 配色；按锚点剩余空间算 `maxHeight`，卡内可滚，滚动不触发收起；每次出卡重读不缓存 | 与备注证据浮层同一套读法与配色，不引入第二套代码视图；「不预读文件内容」只约束 `/next` 载荷，按需预览是界面行为；文件会改，缓存内容会说旧话 |
| 四类卡共存 | `HoverCardLayer` 从「项目 / 技能」扩到「项目 / 需求 / 文件 / 技能」，同一套开关、定位与 portal；文件卡要接鼠标，关闭改 160ms 延时 + 卡片 enter/leave 接管；出了卡就撤掉 chip 原生 `title`，失效态（不存在 / 密钥 / 目录 / 归档删除）仍用原生提示说明原因 | 一张卡、一套节奏，避免多处各写一套 hover；两套提示同时弹很碍眼 |
| 悬浮卡接鼠标（验收反馈） | 四类卡（项目 / 技能 / 需求 / 文件）一律去掉 `pointer-events:none`，全部接 `cardEnter` / `cardLeave`；chip 离开与卡片离开共用 160ms 延时收起，卡片 enter 撤掉收起、leave 再安排；鼠标停在卡上不收，锚点因列表重绘消失时也不收；侧栏项目行那张卡同步改成延时收 + 卡片接管 | 反馈「悬浮一会儿就消失了，而且鼠标没办法移动到这些悬浮窗上」：卡不能接鼠标时，鼠标一划过去就触发 chip / 行的 `mouseleave`，卡立刻被收掉，看起来就像自己消失；两套悬停层（侧栏与 HoverCardLayer）必须同口径 |
| 点击卡片不关右面板（验收反馈） | `App.jsx` 的「点抽屉外收起」判据由 `.rpanel` 扩为 `PANEL_INSIDE`（`.rpanel` + 四类悬停卡 + `.ev-pop`）：`pointerdown` 记按下位置与 `click` 判目标两处都用它 | 卡片 portal 到 body、不在抽屉子树里，能接鼠标后点一下就被当成点外面，把右面板连同正在看的卡一起收掉；两处判据必须同口径，只改一处仍会在另一处漏掉。证据浮层 `.ev-pop` 是同一种 portal 浮层，一并纳入 |
| 验证 | `npm run check` / `npm run build`；引用链 6 组逻辑断言；vite dev + 无头 Edge CDP 组件冒烟（三类 chip、四类卡出卡 / 静止 2.2s 不自动消失 / 鼠标移进卡不消失 / 划回 chip 不闪 / 移开收起、文件卡 5 行 + 高亮、侧栏项目卡单独冒烟）；完整 App 冒烟核对「点击悬停卡不收右面板 / 点抽屉外仍会收」，临时页跑完删净 | 视觉与交互都要过一遍，逻辑测试看不出定位、配色、鼠标停留与抽屉焦点 |

### 2.12 文件引用悬停窗渲染 markdown（2026-11-16）

| 决策点 | 结论 | 理由 |
|---|---|---|
| 症状 | `@{file:doc/xxx.md}` 悬停出来的是带行号的 markdown 源码，标题 / 列表 / 表格 / 代码块都按原文显示 | 悬停是为了不打开文件就知道写了什么；文档类文件给源码视图帮不上忙 |
| 方案 | `FileHoverCard` 按路径后缀判断（`.md` / `.markdown`），markdown 交 `MarkdownBody` 渲染（复用 `.md-body` 排版与 GFM），其余文件保持行号 + hljs；markdown 不再走 `hlighter` | 复用现有 markdown 渲染与样式，不引入第二套；行号对渲染后的视图没有意义 |
| 拆出 `MarkdownBody` | 纯渲染（`.md-body` + GFM + 表格滚动 + 链接分流）从 `MarkdownText` 下沉成独立组件，`MarkdownText` = `MarkdownBody` + 引用 chip；文件卡只用 `MarkdownBody` | 若文件卡直接引 `MarkdownText`，会形成 `HoverCardLayer → FileHoverCard → MarkdownText → HoverCardLayer` 的环：dev 热更新时 hover 状态出现两份模块实例，表现为「引用清单行悬停失效、正文 chip 正常」，只有整页刷新才恢复 |
| 边界 | 仍受 `fileSnippet(full)` 的 600 行上限，截断时页脚照旧标注「只显示前 N 行」；截断若落在代码围栏中间，尾部按未闭合围栏渲染 | 上限是逐行 DOM 渲染的性能保险，markdown 预览同样不该一次塞几千行 |
| 验证 | `npm run check` / `npm run build`；用演示数据桥在**打包产物**与**vite dev**两种模式下各跑一遍真实界面：引用项目 / 需求 / 文件 / 技能四行与正文 chip 都能出卡且无原生 title 兜底，`.md` 卡渲染出标题 / 加粗 / 行内代码 / 列表 / 表格，非 markdown 文件仍是行号 + 高亮；临时脚本跑完删净 | 只测「没报错」不够，要看渲染出来的东西是不是 markdown；dev 与产物两种模块语义都要覆盖，HMR 环的问题只在长期运行窗口里出现 |

### 2.13 文件引用支持文件夹（2026-11-23）

| 决策点 | 结论 | 理由 |
|---|---|---|
| 语法 | 沿用 `@{file:相对路径}`，不新增 `@{dir:…}` | `resolveFileRefs` 早已回 `directory` 与绝对路径，存量正文与 agent 契约都不用动 |
| 候选补全 | `files.list` 返回文件 + 目录（每项带 `directory`）：git 模式从文件路径反推父目录，遍历回退模式直接收目录；目录在同分时排在文件前，候选行标「目录」 | 「选不到目录」是本次的主缺口；空目录在 git 模式下不出现，换来的是天然尊重 `.gitignore` |
| 悬停 | 目录 chip 也出卡：`projectDir` 列一级条目（名称 / 类型 / 大小，限 200），跳过 `SKIP_DIRS` 与 `DENY_RE` 命中的条目；不递归、不读文件内容 | 看目录里有什么只需一级；递归或预读会把悬停变成一次扫盘 |
| 点击 | 仍走 `shell.openPath`，目录即打开资源管理器 | 与文件同一套，不为目录另造入口 |
| agent 侧 | 不扩载荷：`fileRefs` 仍是 `name` / `path` / `absPath` / `exists` / `directory` / `restricted` / `reason`，不附目录条目 | 读目录是 agent 按 `absPath` 自己的事，塞条目清单会拖慢 `/next` |
| 上限 | 候选与文件共用 4000；目录悬停单卡 200，超出标 `truncated` | 大目录逐条渲染会卡 |
| 不做 | 两级目录树、目录内搜索、递归预览、目录内文件内容预读 | 本次只解决「候选里选不到、悬停看不到」 |

## 3. 交付物

| 文件（相对路径） | 职责 |
|---|---|
| `electron/services/domain/requirements.js` + `validators.js` + `ask-waiter.js` + `review-waiter.js` | `claimRequirement` / `completeRequirement` / `askRequirement` / `answerRequirement` / `releaseRequirement` / `deleteRequirement` / `setRequirementStatus`；六态（含 `candidate`）、`UNFINISHED`、认领与交付生命周期、`thread` 消息流；`/ask` 等 1 小时、`/complete` 等 2 小时（提问可多条并存，各按 `questionId` 独立等待），交付 / 释放 / 改状态 / 删除都唤醒挂起请求；`claimLocked` 是认领的唯一写入点；`assertTaskId` / `assertAgent` / `assertEncoded`；`archivedRequirements` / `restoreRequirement`（配合 `services/archive.js` 的 `findEntry` / `removeEntry`） |
| `electron/services/{archive,event-log}.js` | 归档文件读写（`archive/<项目id>/<编号>-<id>.json`，`list` / `maxSeq` / `findEntry` / `removeEntry`，v1 扁平结构迁移）；`requirement.archived` / `requirement.restored` 事件 |
| `electron/services/domain/agents.js` | Agent 注册表：`agents` / `createAgent` / `deleteAgent`（名称唯一、`store.uid('a')` 分配 AgentID），`db.agents` 随库持久化 |
| `electron/services/domain/claim-gate.js` + `auto-claim.js` + `next-waiter.js` | 派发闸门（`doing` / `review` / `dirty` / `path_missing` / `git_timeout`、FIFO 排序、返回自己名下在做的任务）、`claimNextRequirement`（一次）与 `nextRequirement`（长等待）；`next-waiter.js` 的广播信号让新建 / 释放 / 撤销 / 验收 / 提交立即唤醒等待者 |
| `electron/services/domain/refs.js` + `web/src/lib/req-refs.js` + `web/src/components/{ProjectRefInput,MarkdownText,MarkdownBody}.jsx` | 三类引用：服务端 `refNames` / `resolveRefs`（项目）、`reqRefSeqs` / `resolveReqRefs`（需求）、`fileRefPaths` / `resolveFileRefs`（文件）→ `reqView.refs` / `reqRefs` / `fileRefs`；前端换 chip（`linkifyRefs` / `linkifyReqRefs` / `linkifyFileRefs`）与分组输入候选（`activeRefQuery` / `classifyRefQuery` / `applyRef` / `applyReqRef` / `applyFileRef` / `refCandidates` / `reqCandidates` / `fileCandidates`） |
| `electron/services/files.js` + `git.js`（`lsFiles`）+ `domain/system.js`（`projectFiles` / `projectDir` / `revealFile`） | 文件与目录候选清单（git ls-files + 反推父目录、遍历回退，过滤密钥、限量）、目录一级条目（`readDir`，限 200）与「用默认程序打开文件 / 目录」；路径安全复用 `snippet.js` 导出的 `assertRelPath` / `resolveInside` / `DENY_RE` |
| `web/src/components/{HoverCardLayer,RequirementHoverCard,FileHoverCard,MarkdownBody}.jsx` + `styles/{sidebar,evidence}.css` | 四类引用 chip 共用的悬停层；需求信息卡（编号 / 标题 / 状态 / 正文摘要）、文件内容窗（`fileSnippet` 按需读 + 行号 + hljs 高亮 + 限高可滚；`.md` / `.markdown` 改由 `MarkdownBody` 渲染）、目录条目卡（`projectDir` + 名称 / 类型 / 大小，见 §2.13）；`MarkdownBody` 是 `MarkdownText` 与文件卡共用的纯 markdown 渲染层；见 §2.11、§2.12 |
| `electron/services/domain/views.js` + `projects.js` | `reqView.claim` / `completion` / `feedback`（含 `kind`）、`projectView.aiScout` / `reviewCount` / `candidateCount` / `questions` / `reviews`；`createProject` / `updateProject` 读写 `aiScout` |
| `electron/mcp-http.js` + `dispatch.js` | `GET /claim`、`GET /next`、`POST /complete`、`POST /ask`、`POST /release`（一张路由表，按方法分 query / json）、`GET /prompt/<id>.txt`、端口固定、`initialize.instructions`；409 透出当前认领者 |
| `electron/prompts.js` + `prompts/{scout,scout-stub,worker}.md` | `createPromptStore` + `REGISTRY`：启动覆盖、清理 `.bak` / `.baseline.json`、读取不缓存；巡检手册与执行手册真源 |
| `electron/main.js` | `appBaseUrl` / `isAppUrl` / `openExternalSafely`、`setWindowOpenHandler` 与 `will-navigate`、组装 `promptStore`（`PM_PROMPT_DIR`） |
| `web/src/RequirementDetail.jsx` | 扁平 `.rd-*` 详情、`buildContentText` / `buildAgentText`、`editing` / `draft` 内联保存、候选提示块内的「采纳 / 丢弃」、本次交付、待审核「通过 / 继续回复」区块、`MD_COMPONENTS` |
| `web/src/RequirementsPage.jsx` | `counts`（含候选池）与 `unfinished` 筛选、候选池页签与看板列（`BOARD_COLUMNS.top`：未完成列「进行中 / 待审核」置顶）、`actionsFor` 的状态 / 审核分支（候选返回 `null`，不再出按钮；看板 `quiet` 让候选与终态同走「时间回底行、不占按钮行」）、整行选中态、认领徽标、工具栏「已归档」入口 |
| `web/src/components/ArchiveModal.jsx` | 已归档需求弹窗：`archivedRequirements` 列全部归档（项目名 / 编号 / 标题 / 归档时间），逐条 `restoreRequirement` 恢复；原项目已移除时禁用并说明；恢复后回调刷新当前需求列表与项目计数 |
| `web/src/components/AiAccessModal.jsx` | 四个页签；Agent 管理页负责添加 / 列表 / 技能目录（卡片显示 AgentID 与每个目录的技能数，「添加 Agent」弹窗可一键选择本机已装客户端），自动认领页单独选择 Agent 并注入 AgentID，未选中禁止复制 |
| `web/src/App.jsx` | `selReqId` / `openRequirement` / `deleteRequirement` / `saveRequirementDetail`、详情 `key`、进入自动选中、`applyStatus` 文案、验收时可选提交推送（`approveRequirementWithGit` / `confirmStatusWithGit`）、`AiAccessModal`、`pendingItems`（提问 + 待审核） |
| `web/src/lib/commit-message.js` + `web/src/components/CommitModal.jsx` | 提交信息唯一真源：`buildCommitMessage` 只认 `completion.commitMessage`、`splitCommitMessage` 识别并保留标准类型前缀；弹窗不再展示会话说明 |
| `web/src/components/QuestionBall.jsx` | 右下角强提醒球：合并 `questions` 与 `reviews` 摘要，单条直达、多条展开列表，点条目跳到需求详情 |
| `web/src/hooks/useRequirements.js` | `approveRequirement` / `replyRequirement`（详情面板验收动作）；`changeStatus` 区分打回 / 撤销重开并弹窗收集原因；新建的是候选就切到候选池页签，采纳文案单列 |
| `web/src/hooks/usePendingChanges.js` | 验收前查项目待提交文件数，为 0 时不出现「提交并推送」选项 |
| `web/src/constants.js` | `STATUS`（含 `candidate` / `review`）、`UNFINISHED`、`STATUS_ORDER`（候选池在最前）、`TAB_LABEL` |
| `web/src/ui.jsx` + `forms.jsx` | `DangerButton`、`ContextBar` 待审核 tooltip；`RequirementForm`（仅新建，含「先放进候选池」勾选）、`RequirementStatusForm`、`ProjectForm` 巡检复选框 |
| `web/src/Sidebar.jsx` | 项目行需求灯与 `lightsOf`、tooltip 与点击直达、「AI 停」徽标、「AI 接入」入口 |
| `web/src/OverviewPage.jsx` | 待审核排序权重、「agent 已交付」副行与统计副行 |
| `web/src/api.js` | 需求 / 项目 / 提示词通道方法 |
| `web/src/lib/events-view.js` | `requirement.released` / `requirement.asked` / `requirement.answered` / `requirement.archived` / `requirement.restored` 文案、`via=next` 的认领显示为「自动认领」 |
| `web/src/RequirementDetail.jsx`（往返记录） | `thread` 消息流渲染（含 `reopen`）、待回答区块与回复框、旧需求按 `completion` / `feedback` 兼容 |
| `web/src/styles/{requirements,panel,controls,tokens,modal}.css` | `.rd-*` / `.md-body` / `.row.req.sel`、`.src.claim`、`.st-review`、`.plight` 三态、青色语义色、`.mcp-cfg` |
| `web/claim-test.html` | 手工验证页，支持 `?status=review` 与 `completion`；演示数据带一个被引用项目与一条技能解析结果（含 `agents` / `skills` 通道），用于核对引用项目与技能的悬停信息窗 |
| `package.json` + `README.md` | `build.files` 含 `prompts/**/*`；六态（含候选池）、`/claim` + `/complete` + `/next` + `/release` 契约与错误码、编码要求、两个复制按钮分工 |

## 4. 关键修正与教训

- **5s 轮询既覆盖输入，也让缓存对象过期** → 选中只存 id 实时解析；草稿用 `key={selReq.id}` 重挂载隔离，禁止组件内 effect 回填。
- **自动选中的 effect 会被 5s / 2s 轮询反复触发** → 以 `page|pid` 作「已处理」key，一周期只执行一次；数据归属（`reqsPid`）校验必须在打标之前。
- **`UNFINISHED` 语义扩张后旧判据失效** → 旧名 `OCCUPY` 曾被 `buildAgentText` 当作「正在做」；改名后凡「按未完成判断」的地方都要复查。
- **完成说明入库成乱码** → 只说「做 URL 编码」不够，要写明字符集；GBK 编码后按 UTF-8 解码为 U+FFFD 且不可逆，故含替换字符一律 400。
- **提示词是 skill 的凝练，凝练会丢类别** → `SKILL.md` 写三类目标，`prompts.js` 只剩「改进点」，产线被悄悄砍掉两条；须逐条核对「用途 / 任务书 / 门槛」。
- **证据标准是最强的一票否决** → 「没确认用户需要它」在只读场景等于永久排除整类产出；无法在流程内被满足的判据都要检查是否干掉整类产出。
- **通用探针 + 跨项目去重会吃掉产出** → 单一 `grep` 探针在任何项目都 0 命中，提案同质化后再被去重砍到 1；两个现象实为耦合。
- **上限是噪声阈值，不是质量门槛；散文式排序不可审计** → 抬高上限须同时写「禁止凑数」，改显式打分后报告必须附名次。
- **seed 只判断「文件是否存在」** → 真源改了运行时副本不动，升级后提示词停在首版；改为每次启动无条件覆盖，并放弃版本校验（hash / 必填 / 展示属过度设计）。
- **首轮把 resources 排为主线是错判** → 资源列表被客户端合并后交给模型，重名无法区分来源且读错不报错；工具才是主线。
- **`isAppUrl` 前缀匹配必须带尾部 `/`** → 否则 `http://localhost:5173.evil.com` 会被当作自身导航放行；`PM_DEV_URL` 带尾斜杠会误拦自身子路径。
- **侧栏波形消失与 toast 双报** → 不要给功能性呼吸动画加 `prefers-reduced-motion` 降级（本机该偏好为 true，等于全站呼吸一起停）；删除失败只保留 App 层 toast，组件内 `try/catch` 只防御并复位 busy。
- **「AI 提的需求直接进待办」是个默认值，不是设计**（2026-11-11）→ 派发口径曾写死「全部需求都派发，手写与 AI 一视同仁」，等于让人在没有任何确认动作的情况下替 AI 的猜测开工。加候选池时凡是「按状态判断」的地方都要复查：`planDispatch` 只认 `todo`、`UNFINISHED` 不含候选、`pm_list_requirements` 默认排除——三处少一处，候选就会被派出去。
- **候选池若只靠派发过滤，`/claim` 就成了后门** → 手动按 `taskId` 认领不受派发闸门约束（这是刻意的），所以认领函数必须自己挡候选，否则「AI 看不见」只对自动派发生效。
- **悬停层的循环依赖会让 dev 下的 hover 时好时坏**（2026-11-16）→ 文件卡一开始直接引 `MarkdownText`，形成 `HoverCardLayer → FileHoverCard → MarkdownText → HoverCardLayer` 的环；长期跑着 HMR 的窗口里会留下两份 `hoverProps` 模块实例，表现为「引用清单行悬停失效、正文 chip 正常」，整页刷新才恢复。纯渲染下沉成 `MarkdownBody` 后环消失；凡是 `HoverCardLayer` 的下游组件，都不要再反向 import 依赖 `hoverProps` 的模块。

## 5. 已知边界

- 正文 HTML 标签按纯文本显示（`rehype-raw` 未启用）；GFM 语法由 `remark-gfm` 支持，其中表格在 `MarkdownBody.jsx` 外套滚动容器、样式见 `panel.css`（右面板窄列只滚表格、不撑宽正文）；`mailto:` / `tel:` 点击无反应，扩协议需显式白名单并重评风险。
- `@{项目名}` 按当前库里的项目名精确匹配（忽略大小写）：项目改名后旧引用立刻变成失效态，需手动改正文；引用不产生反向依赖，被引用的项目照常可删除 / 归档。`@{#序号}` / `@{file:路径}` 同理：需求归档删除、文件改名删除后标失效，不反向阻止删除。
- 项目 `refs` 只带库里现成的数据（项目记录 + 需求标题），不读磁盘、不解析项目类型；`reqRefs` 的正文也来自库内。`fileRefs` 只为判存在 / 解析绝对路径做 `stat` / `realpath`，**不读文件内容**：agent 想知道技术栈要看目录本身，工作台不替它扫仓库（会拖慢 `/next`）。引用目录时 agent 只拿 `directory: true` 与 `absPath`，不附条目清单（§2.13）。
- 切换需求时未保存改动直接丢弃，不做离开确认或本地暂存（用户明确取舍）。
- 待审核长期不处理会一直留在未完成列表：agent 的 `/complete` 最多等 30 分钟，超时后请求结束但交付仍在，用户之后可以随时在详情面板通过或回复。
- `GET` 带副作用、仅本机可达且无鉴权；`agent` 名称自报，不能作安全凭证；MCP 侧没有任何改状态的工具（2026-11-06 起连 `pm_set_requirement_status` 一并删除），要改状态只能在界面上点；旧渲染包读到 `review` 取不到 `STATUS[status]`，升级需前后端一起换；历史 GBK 乱码（`#3`）不清理。
- 只读约束依赖 agent 自律；跳过 `GET /prompt/scout.txt` 凭记忆执行无法拦截；候补文件路径跨机器不保证可复用。
- 停用只约束巡检提需求，其他 MCP 只读能力不受影响，存量 AI 需求不因关开关而删除或改状态；打包漏 `prompts/` 会让 `/prompt/<id>.txt` 返回空，应作发版检查项。
- 自动派发只在 `/next` 生效：项目已有 `doing` 时，手动按 `taskId` 调 `/claim` 仍可再认领一条，项目级串行不是硬规则；agent 被杀后任务停在 `doing`，需用户撤销或该 agent 下次 `/release`，应用不做超时回收。
- 「有未提交改动不派发」意味着 agent 交付后项目会停在阻断态：用户验收并提交代码后才会继续派活；agent 不提交代码（有意限制），改动文件要列在 `commitMessage` 里。
- `completion.commitMessage` 不进 `thread`：交付消息只写会话回复 `note`，打回 / 撤销 / 释放清掉 `completion` 后，交谈记录里查不到提交信息。升级前的老交付没有该字段，提交弹窗只预填 `#序号 标题`，需要正文由用户自己补——绝不回落到 `note`，避免会话内容污染提交。
- 往返记录只保留最近 50 条，超出丢最早的；同一时刻只有一个待回答位（再提问 409 `question_pending`，不会覆盖）；`/ask` 最多挂 5 分钟，超时即关闭提问、迟到的回答 409 `no_question`；连接断开后提问靠 10 分钟 TTL 在下次 `/next` 时清理。
- `/complete` 最长挂 30 分钟：agent 客户端若自带更短的请求超时，会在拿到反馈前断开；反馈仍写进 `thread` 并把需求退回进行中，下一轮 `/next` 能续做，但这一轮不会当场继续。一次交付等待占用一个 HTTP 连接，应用重启或连接断开后等待器丢失，交付留在待审核。
- `/next` 最长挂 5 分钟（`wait=秒` 可调，上限 30 分钟）：同一个 agent 名字并发跑多个进程会互相看到对方认领的任务并重复开工，调度器必须串行启动；外部 git 提交、释放冷却到期没有 bump 信号，靠 30 秒兜底重查，最坏延迟约 30 秒。
- Agent 注册表支持创建 / 删除，不支持改名：名称不可重复、AgentID 创建后不变。删除只影响后续可选项，已认领 / 交付过的任务仍保留原 AgentID，不会自动迁移到新 ID；名称查不到时界面回落显示这个 ID。
- 右面板可窄至 240px，编辑区 textarea 仅纵向缩放；终态「填写备注」是独立弹窗，不属于详情内联编辑。
- 候选池是唯一一个「能倒退回去」的入口：`todo → candidate` 允许（想法又觉得不成熟），但 `doing / review / done` 不行——已经有人开工或已有交付的活退回池子，会连认领与交付记录一起悬空。候选需求不参与归档判断：归档只认 `done`，丢弃请用「丢弃」到 `rejected`。
- 已归档需求只在「已归档」弹窗里查看与恢复，跨项目一起列并标出原项目；恢复按原项目 id 落库，项目被彻底删除后归档只读保留、不可恢复到别的项目。恢复保留原编号与 `updatedAt`：新建需求时编号已把归档文件算进去，正常情况下不会撞号。

## 6. 后续候选

- 表格已支持（2026-11-15，需求 #44）；后续支持 `mailto:` / `tel:` 外开并补齐白名单。
- 未保存草稿的离开确认或本地暂存（当前明确不做）。
- 认领超时与认领心跳、执行进度回报（显式释放已由 `/release` 提供）；待审核专属页签（审核堆积时再评估）。
- 观察 1–2 轮 B 类占比与接受率、C 类是否连续两轮为 0；候选池堆积时改「按项目权重轮转」；在 `pm_create_requirement` 增加 `aiScout` 服务端校验；按项目批量清理存量 AI 需求；需要追溯规则版本时引入轻量内容指纹，不回到必填校验。

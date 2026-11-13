---
date: 2026-11-10
description: 技能支持：技能是 Agent 的属性（agent.skillDirs），只扫已添加 Agent 的目录；需求正文用 {UseSkill:id} 关联技能，/skill 端点把目录下发给认领的 agent
status: accepted
---

# 技能关联 — 决策记录

> 状态：✅ 已实现（2026-11-10）；未做「按技能派发」，理由见第 5 节

## 1. 目标与范围

让需求能指名要求某个技能，并保证**认领的那条 agent 一定拿得到技能目录**，不依赖「服务端事先知道谁会什么」。

- **做**：Agent 管理页里「添加 Agent」时检测本机已装客户端（一键登记）或自定义名称 + 技能目录；只扫描已添加 Agent 配的目录；正文输入 `/` 补全并写成 `{UseSkill:id}`；需求视图解析成带目录的 `skills`；`GET /skill/<id>`、`GET /skills`、`GET /skills/rescan`、`GET /clients`。
- **不做**：Agent 能力集、按技能过滤派发、`no_skill` 原因码、扫描未添加的客户端、扫插件市场缓存。
- 相关：需求正文的跨项目引用 `@{项目名}` 见 `doc/requirements-and-agent.md`，两者同构。

## 2. 关键决策

| 决策点 | 结论 | 理由 |
|---|---|---|
| Agent 与技能的关系 | **技能目录是 Agent 的一个可选属性**（`agent.skillDirs`），不是 Agent 的身份 | 身份只能是 AgentID。同机多开时几个 AgentID 共享同一目录，把目录当身份会立刻说错话 |
| 扫描范围 | **只扫已添加 Agent 配的目录**；没添加的客户端一个字节都不读 | 用户明确要求；也让「为什么补全里有别人的技能」这类困惑消失 |
| 检测客户端 | 只判断目录是否存在，只返回候选，**不自动建 Agent、不统计技能数** | `where claude` 平台差异大且慢；进程表是瞬时的。计数等于扫描，与上一条冲突 |
| 表外客户端 | 兜底发现 `~/.<名字>/skills`：目录存在且里面至少有一项 `SKILL.md`（或含它的子目录）即认定为候选，`label` 取目录名 | Trae CN 装在 `~/.trae-cn`、Qoder CN 在 `~/.qoder-cn`，硬编码表必然漏（本轮就是这么漏的）；按形状找可一次覆盖后续新增客户端 |
| 兜底发现的过滤 | 只认隐藏目录，且要求有技能形状的文件 | 本机 `~/.tokentracker/skills` 里全是缓存 json，不加这层会被当成客户端 |
| 目录改动 | 在 Agent 卡片里直接编辑（原生目录选择器），`setAgentSkillDirs` 整表替换并**当场重扫** | 加了目录却要重启才生效，用户会当成 bug |
| 缺技能怎么办 | 需求侧用 `{UseSkill:id}` 关联，视图里带上 `dir` / `entry` | 谁认领谁拿到路径，问题从「先判断谁会」变成「直接给手册」 |
| 技能 chip 悬停 | 出信息窗，只摊开名字 / 描述 / 所属 Agent 三项；出了窗就不再挂原生 `title`，两套提示一起弹很影响观感 | 判断「这条需求要的是不是我要的那个技能」只看这三项就够了；解析不到与「目录已不在」这两种失效态仍退回原生提示，卡里说不清原因就别硬出卡 |
| 认领后的归属 | **不按 Agent 归属过滤**：技能是目录，路径给到谁都能读，解析结果与认领人无关 | 归属过滤会让 agent 收到 `not_owned` 而不敢读；目录可读，没必要限制（2026-11-11 按用户反馈取消） |
| 存哪 | `userData/cache/skills.json`，不进 `db.json` | 可再生的环境缓存；`db.json` 会被备份与整份拷贝，绝对路径换机器即失效 |
| 是否存副本 | 不存。需求只存正文 token，每次 `reqView` 重新解析 | 与 `refs.js` 同一条纪律：缓存路径比缓存 id 更容易变味 |
| 解析位置 | 只在服务端 `domain/skill-refs.js` 一处 | 前端与 agent 读同一份结论 |
| 软链 | 必须跟随（`kindOf` 用 `statSync` 判类型） | 技能管理器普遍用软链挂载，`Dirent.isDirectory()` 对软链返回 false，实测 18 项只剩 1 项 |
| 插件市场缓存 | 不扫（如 `~/.workbuddy/plugins/cache`） | 「可安装池」不是「已启用集」，几千条既慢又会把补全灌满噪声 |
| 触发字符 | `/`，且只认行首或空白后 | 正文是 markdown，`web/src`、`D:/job`、`http://` 的斜杠前面是字母或冒号，这条规则全排掉 |
| token 形态 | `{UseSkill:source/名字}`，落库仍是正文文本 | 结构化只在视图层（`reqView.skills`），正文保持人可读、可复制 |

## 3. 数据与契约

**`db.agents[i]`**：`{id, name, createdAt, client, skillDirs[]}`。后两个字段缺失即「未指定」，与引入前行为完全一致，不需要迁移。`client` 只用于展示与默认目录来源，不参与任何判断。

**解析**：`SKILL_RE` = `/\{UseSkill:([^{}\n]{1,60})\}/gi`，围栏代码块内不解析。含 `/` 按限定 id 精确匹配；裸名全局唯一才命中，重名取第一个并 `ambiguous:true` + `candidates`。

**解析源**：正文 + **最近一次打回 / 继续回复意见**（`views.js` 的 `skillText`）。打回时用户会用 `/` 在回复框点名技能，只在正文里解析的话那个 token 就只是散文，agent 拿不到 `entry`。只并当前这一条意见、不并整条 thread：`feedback` 每次打回都会替换，并入历史会让早已作废的技能一直挂在「使用技能」里。

**视图**：`reqView.skills[]` = `{name, skillId, source, dir, entry, description, exists, ambiguous, candidates, reason}`。

- `reason`：`not_found`（本机没这个技能）/ `null`。
- `/skills` 的每条技能额外带 `agents[]`（归哪些 Agent，按目录前缀算），这只是展示信息，不参与需求解析。
- `reqView.thread[].skills`：每条往返消息单独解析（历史轮次里点名的技能不进「使用技能」清单，但气泡要能渲染成 chip）；`reqView.question.skills` / `reqView.completion.skills` 同理，供待回答 / 待审核区块按 markdown 渲染。

**端点**（`AGENT_ROUTES` 一张表 + 一条 `SKILL_ROUTE_RE` 正则）：

| 端点 | 返回 |
|---|---|
| `GET /skills` | `{scannedAt, roots[], skills[]}` |
| `GET /skills/rescan` | 同上，先重扫 |
| `GET /skill/<id>` | `{skill:{...同视图字段, found, ambiguous, candidates}}`；查不到也回 200 + `found:false` |
| `GET /clients` | 本机客户端候选（`{client,label,dir,exists,agents[]}`），不建 Agent、不扫技能 |

`/next` 与 `/claim` 的 `requirement.skills` 已内联目录，正常流程不需要额外请求。

**agent 行为**（`prompts/worker.md` 第 2 节）：先读 `entry` 按说明执行；`skillId` 为 `null`（本机没这个技能）与 `exists:false` 都用 `/ask` 问人，**不要 `/release`**（释放会触发冷却并把项目锁住）。技能目录不按 Agent 归属限制，路径给到就能读。

## 4. 界面

Agent 管理页即技能管理的唯一入口（两者合并）：

- **卡片**：名称 / AgentID / 技能数 / 每个技能目录一行（带该目录的技能数，目录失效标红）/ 「配置目录」「删除」。
- **需求详情**：正文里的 `{UseSkill:技能id}` 与 `@{项目名}` 一样渲染成 inline chip（`pm-skill:` 链接，同 `req-refs.js` 的两步：先换 markdown 链接、再由 `MarkdownText` 接管成 chip），围栏代码块内不替换；chip 显示 `/技能id`，`title` 与下方「使用技能」清单共用 `skillTip()` 一句话。失效标红只对两种情况生效：**本机没有这个技能**、**目录已不在**。技能不按 Agent 归属过滤，编辑期的 `/` 候选也列全部本机技能。
- **打回 / 继续回复的回复框**：同一个 `ProjectRefInput`，`@` 与 `/` 两套候选都能用；写进去的 token 由服务端并入 `requirement.skills`，agent 认领时拿得到 `entry`。
- **往返记录 / 待回答 / 待审核**：消息按 markdown 渲染（`MarkdownText`），里面的 `{UseSkill:x}` 渲染成 chip；每条消息用自己的解析结果，所以历史轮次里的技能也能显示，不依赖正文那份清单。
- **添加 Agent 弹窗**：上半是「本机已装」（`/clients` 里 `exists:true` 的客户端，点一下即以客户端名 + 默认目录登记）；已经挂在某个 Agent 名下的目录显示「已登记 · Agent 名」并禁用——判断用本地注册表按目录前缀比（`sameOrUnder`），所以登记完当行立刻变灰，不必等下一次拉取。下半是自定义（名称 + 目录，可加多个、可用原生目录选择器）。弹窗用 `createPortal` 挂到 body —— 卡片有 `pop` 动画，nested modal 放在里面会被 `transform` 造出的包含块困住。
- 顶部一行汇总已添加的 Agent 数与技能总数；「重新扫描」在没有 Agent 时禁用（没有可扫的东西）。

## 5. 为什么不做按技能派发

需求自己带着技能目录，所以「派给谁」不存在无解的情况：拿到任务 = 拿到手册。按技能过滤只有在「技能必须由特定环境执行」时才必要，而 AgentID 与机器/客户端没有稳定映射（`client` 是用户声明，不是探测结果）。真要做，增量是 `POST /caps` 自报 + `claim-gate` 里加一条纯同步过滤，不影响本设计的任何字段。

## 6. 交付物

| 文件 | 职责 |
|---|---|
| `electron/services/skill-scan.js` | 探测表 / 扫描 / 缓存 / `detectClients` / `sourceForDir` / `agentDirList` / `agentsForDir` |
| `electron/services/domain/skill-refs.js` | `SKILL_RE` / `skillNames` / `resolveSkills` |
| `electron/services/domain/skills.js` | `skills` / `clients` / `skill` / `rescanSkills` |
| `electron/services/domain/agents.js` | `skillDirs` + `client` 视图、`setAgentSkillDirs`、加/改/删后同步重扫 |
| `electron/services/domain/views.js` | `reqView.skills`（解析源 = 正文 + 当前打回意见）+ `thread[].skills` / `question.skills` / `completion.skills`（逐条解析） |
| `electron/mcp-http.js` | `SKILL_ROUTE_RE` + `/skills`、`/skills/rescan`、`/clients` |
| `electron/main.js` | `cacheDir()`、启动后按已添加 Agent 的目录扫描 |
| `web/src/lib/skill-refs.js` | `activeSkillQuery` / `applySkill` / `skillCandidates` / `skillsUnder` / `loadSkills` / `loadAgentList` / `invalidateSkills` / `invalidateAgentList` / `linkifySkills` / `readSkillHref` / `findSkill` / `skillMissing` / `skillTip` |
| `web/src/components/MarkdownText.jsx` | 正文、往返记录、待回答 / 待审核里的 `pm-skill:` chip（与 `pm-ref:` 同一处接管） |
| `web/src/components/SkillChip.jsx` | 技能 chip：正文与往返记录共用同一个外观与说明；悬停接 `HoverCardLayer` 的信息窗 |
| `web/src/components/SkillHoverCard.jsx` | 技能信息窗：名字 / 描述 / 所属 Agent。技能条目里的 `agents` 只有 id，名字回注册表查，两份清单都走 `lib/skill-refs.js` 的进程内缓存 |
| `web/src/components/ProjectRefInput.jsx` | 同一 textarea 支持 `@` 与 `/` 两套候选（正文编辑器与打回回复框共用） |
| `web/src/components/AiAccessModal.jsx` | Agent 卡片、添加弹窗、目录编辑 |
| `web/src/RequirementDetail.jsx` | 技能 chip（只读，`.rd-skill`）+ 打回回复框 + 复制指令里的技能行 + 往返记录 markdown |

## 7. 已知边界

- 跨机器运行时本机扫描出的路径对另一台机器无效 —— `exists:false` 就是为这个场景准备的。
- 一个客户端多开成多个 AgentID 时，卡片会各自显示同一目录的技能数（共享），这是刻意的：不假装它们技能不同。
- `/skill/<id>` 会返回本机绝对路径，端口本身无鉴权（见 `architecture-and-channels.md` §5），仅本机可达。
- `{UseSkill:x}` 是硬编码词法：正文里真想写这个字面量时会被解析成关联（`@{x}` 有同样的问题），围栏代码块可规避。
- 技能改名 / 删除后，旧 token 解析为 `skillId:null` 或 `exists:false`，需求详情会标红；不会自动修正正文。
- 打回意见里的 token 会随 `feedback` 一直留在 `requirement.skills` 里，直到下一次打回把它替换掉 —— 通过验收后仍会显示，它就是这一轮改动的记录。
- 往返记录气泡按 markdown 渲染：`{UseSkill:x}` 换成 chip，其他 markdown 语法（列表、代码块、粗体）照常生效；每条消息用自己的解析结果，不依赖正文那份清单。
- 一个技能都没添加过 Agent 时，`/` 补全为空 —— 这是「只扫已添加 Agent」的直接后果，界面靠「添加 Agent」按钮引导。
- 兜底发现会带出表外的未知客户端（本机有 `~/.dsh/skills`，`label` 就是 `dsh`）。它只是候选，不添加就不扫描；不认识的一律忽略即可。

## 8. 变更记录（2026-11-11）

- **取消技能归属限制**：用户反馈 agent 请求任务信息时会看到 `not_owned`，但技能引用的是一个文件夹，即使登记在别的 Agent 名下也照样能读，没必要提醒。现在 `resolveSkills` 不再看认领人，任何 agent 拿到的都是同一个 `dir` / `entry`；`owned` / `candidateOwners` / `reason:'not_owned'` 一并删除。编辑期的 `/` 候选也不再按 Agent 过滤（`ProjectRefInput` 去掉 `agentId`），复制指令里的「不属于你」提示删除，`prompts/worker.md` 同步去掉对应条目。
- **往返记录按 markdown 渲染**：气泡由纯文本 `SkillText` 改为 `MarkdownText`，`{UseSkill:x}` 与正文一样渲染成 chip；`reqView.thread[].skills` 为每条消息单独解析，历史轮次里的技能也能显示。「使用技能」清单仍只认正文 + 当前打回意见，不被历史消息污染。待回答的提问原文与待审核的交付说明同样改为 markdown，`reqView.question.skills` / `reqView.completion.skills` 供其渲染 chip。
- **验证**：`npm run check`、`npm run build` 通过；临时数据目录直调 `reqView` 核对 `skills` 字段与 thread 每条消息的解析结果。

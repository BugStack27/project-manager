---
date: 2026-10-28
description: v2 纯 Electron 架构的通道契约：IPC 与本地 HTTP MCP 双通道、userData 数据边界、domain/ 业务域分层与 dispatch 零变更、MCP 入口与提示词下发
status: accepted
---

# 架构与通道 — 决策记录

> 状态：✅ 已验收（2026-10-19 ~ 2026-10-28）；MCP 启动失败提示补充于 2026-11-02

## 1. 目标与范围

v2 去掉 v1 的「Express + React」服务端：界面与后端在同一进程内，渲染端走 IPC，外部 AI 助手走应用内本地 HTTP MCP。本篇只记进程 / 数据边界与通道契约，不含页面内容。

- **做**：IPC 通道与错误形状、本地 HTTP MCP（固定端口 7318）、数据目录迁到 userData、领域层按业务域分层并保持 dispatch 契约、MCP 入口与提示词下发。
- **不做**：对外 REST、SSE、stdio 传输、按客户端分 tab、鉴权与远程可达、自动写入客户端配置文件、借拆分重构行为。
- 相关文档：需求认领 / 交付与提示词真源见 `doc/requirements-and-agent.md`；命令执行见 `doc/launch-and-runs.md`；git 同步见 `doc/changes-and-git-sync.md`；壳层与「设置与数据」浮层见 `doc/app-shell-and-navigation.md`；数据存储与恢复见 `doc/backup-and-restore.md`；启动失败提示与顶部提示条见 `doc/event-log-and-notifications.md`、`doc/system-runtime-and-release.md`。

## 2. 关键决策

### 2.1 进程与数据边界

| 决策点 | 结论 | 理由 |
|---|---|---|
| 单一写入者 | GUI、IPC、MCP 同进程，全部经 `dispatch` 落库 | 多进程同时写 `db.json` 会丢更新；命名管道方案随之退役 |
| 原生替代 | `dialog.showOpenDialog` / `shell.openPath` 取代 PowerShell 选择器 | 删除约 217 行系统兼容代码与外部脚本依赖 |
| 数据目录 | 运行时数据放 `app.getPath('userData')/data`；首启自动复制仓库内 `data/`，之后仓库目录只作迁移源 | 安装目录与仓库目录都不可写 / 会被替换 |
| 迁移节奏 | 先立后破：新通道全量可用且确认无旧调用残留后再删旧传输 | 双轨期可回退，避免一次性切断 |
| 实例约束 | 应用单实例锁；MCP 端口固定，不随占用顺延 | 「配置一次永久有效」优先于容忍他人占端口 |

### 2.2 IPC 契约

| 决策点 | 结论 | 理由 |
|---|---|---|
| 唯一入口 | `preload.js` 经 `contextBridge` 暴露 `window.pm.invoke` 与 `platform`；`ipc.js` 注册 `pm:invoke` 转 `dispatch` | 渲染端不接触 node 与 ipc 原始对象 |
| 响应形状 | 成功 `{ok:true,data}`；失败由分发层序列化为 `{ok:false,status,code,message}` | 统一包装，前端只认一种形状 |
| 错误还原 | `web/src/api.js` 把失败还原成带 `status` 的 Error，`e.status === 501` 等降级判断继续有效 | 错误形状变化会静默打断既有降级 |
| 前端改动面 | 页面层只改 `web/src/api.js`（`fetch` → `invoke`），另加 `mcpInfo` / `mcpRetry` / `scoutPrompt` / `workerPrompt` | 通道替换不外溢到页面组件 |
| 领域层依赖 | 领域层不依赖 electron，只用 node + 本地服务 | 可脱离界面直接断言 |

### 2.3 本地 MCP 服务

| 决策点 | 结论 | 理由 |
|---|---|---|
| 传输方式 | 仅 HTTP（streamable 无状态），客户端一条 URL；删除 stdio | 开发 / 打包路径一致，无路径与 stdio 兼容问题 |
| 端口 | 固定 `127.0.0.1:7318`，不顺延 | 顺延会让客户端已写死的 URL 静默失联，比启动失败更糟 |
| 协议实现 | 手写 JSON-RPC（`initialize` / `tools/list` / `tools/call` / `ping`），不引 SDK | 避免 ESM 依赖与打包体积 |
| 请求形态 | `POST /mcp` 收 JSON-RPC 直回 `application/json`；`GET` / `DELETE` 回 405；校验 `Origin` 与 `Content-Type`；body 上限 1MB | 入口集中做内容与来源校验，非法请求返回 415 / 403 |
| 工具面 | 只暴露 `pm_*` 子集（项目、需求：`pm_list_projects` / `pm_get_project` / `pm_list_requirements` / `pm_create_requirement`）与提示词资源；另保留 `/prompt/<id>.txt` 与执行 agent 的五个动作端点 `/claim`、`/complete`、`/next`、`/release`、`/ask`（`AGENT_ROUTES` 一张表） | 2026-11-06 收窄：命令类工具与 `pm_set_requirement_status` 无合法调用方（两份手册都禁止），删掉后写面只剩「提需求」，状态流转只认认领/交付接口 |
| 长请求 | `GET /next` 没有活时最多挂 5 分钟（`next-waiter.js` 的广播信号 + 30 秒兜底重查，`wait=秒` 可调）；`POST /ask` 最多挂 1 小时等用户回答（一条需求可同时挂多条提问，各按 `questionId` 独立等待），`POST /complete` 最多挂 2 小时等验收（`ask-waiter.js` / `review-waiter.js`）；服务端 `requestTimeout` 按最长等待自动抬高（2 小时 + 10 分钟） | 把等待放服务端而不是让 agent 空转；超时值各写在等待器一处，写操作通过 `bump` / `settle` 直接唤醒对应等待 |
| 失败快照 | `startMcpHttp` 失败时错误带 `port`，主进程存 `mcpFail = {code,port,message}`；`mcpInfo` / `mcpRetry` 同形状返回 `{port,url,error}` | `url` 非空即可用，`error` 只在没起来时给，界面无需猜 |

### 2.4 领域层分层与 dispatch

| 决策点 | 结论 | 理由 |
|---|---|---|
| 目录形态 | `electron/services/domain.js` 拆为 `services/domain/`，`index.js` 组装；旧单文件删除 | 与 `domain/index.js` 并存时 Node 优先解析 `domain.js`，拆分等于没生效 |
| 切分粒度 | 7 个 core（constants / errors / validators / dates / paths / lookups / views）+ 7 个业务域 + 1 个入口，单文件 60–220 行 | 共享工具不重复，业务域可独立 review |
| 契约边界 | 方法名、入参、返回字段与顺序、错误 `code/status/message`、`store.save()` 时机、常量值逐字保留 | MCP 直接透传返回体，字段或顺序变化即破坏性变更 |
| 组装方式 | 每域导出工厂；仅 system / backups 注入 `native`；组装期重名抛错 | 原生依赖最小化，重名守卫防止 48 个方法被静默覆盖 |
| 依赖方向 | 域 → core → 基础服务；禁止反向 require `index.js` | 避免循环依赖 |

### 2.5 MCP 入口与提示词下发

| 决策点 | 结论 | 理由 |
|---|---|---|
| 入口唯一 | 左栏底部「设置与数据」浮层 →「通知与集成」组 →「AI 接入」（三个页签：自动提需求 / 自动认领 / MCP）；`PageBar` 的 `afterTitle` 槽与需求中心页栏图标按钮一并删除 | 接入是全局配置动作，不该散落在业务页栏 |
| 弹窗动作 | 只做复制 `mcpServers` 配置、复制 AI 提示词；`info.url` 缺失时回落 `http://127.0.0.1:7318/mcp` | 配置需要有界面出口，不能只留在 README |
| 未运行提示 | 配置下方一行 `.mcp-err`，文案明确配置仍可复制，不做整屏降级 | 提示不能挡住用户唯一的操作 |
| 服务状态行 | 运行中＝绿点呼吸环 + 端点，未运行＝静态灰点 + 尝试端口，取不到信息＝「状态未知」 | 状态是只读信息，不加边框底色，免得被当成按钮 |
| 启动失败全局提示 | 顶部 `.warnbar` 提示条：标题带端口，说明按 `code` 分叉（`EADDRINUSE` 单独措辞），右侧「重试」+「×」（本次运行不再提示） | 只留 `console.error` 等于没提示，用户会以为服务在跑 |
| 两条通道 | 提示词走 IPC、服务走 HTTP，各自降级，不绑成一个整屏错误态 | 提示词就绪 ≠ 服务存活 |
| 文案单源 | `web/src/lib/mcp-view.js` 的 `mcpFailTitle` / `mcpFailDesc` 同时供提示条与弹窗 | 同一件事不在两处各说一套 |

## 3. 交付物

| 文件（相对路径） | 职责 |
|---|---|
| `electron/main.js` | 应用入口：单实例、窗口、原生桥、生命周期、启动 MCP 服务；维护 `mcpFail` 快照，`shutdown` 关闭服务 |
| `electron/preload.js` | `contextBridge` 暴露 `window.pm.invoke` / `platform` |
| `electron/ipc.js` | 注册 `ipcMain.handle('pm:invoke')`（复用 `dispatch`）与 `mcpInfo` |
| `electron/dispatch.js` | 方法分发；未捕获异常统一序列化为 `{ok:false,status,code,message}` |
| `electron/mcp-http.js` | `startMcpHttp(dispatch, log)`：绑定 `127.0.0.1`、工具表与 JSON-RPC 处理、路由与安全校验；失败把 `port` 挂到 error |
| `electron/services/store.js` | 数据目录可注入（`configure`）+ 原子写 |
| `electron/services/runner.js` | 命令 spawn / 日志 / taskkill / 重启恢复 |
| `electron/services/git.js` | git status / log / diff / 单提交；远程状态、fetch、`pull --ff-only`、推送当前分支、远程列表与网页地址解析 |
| `electron/services/domain/index.js` | `createDomain(deps)` 组装各业务域 + 重名守卫；导出 `STATUSES` / `UNFINISHED` |
| `electron/services/domain/{constants,errors,validators,dates,paths,lookups,views}.js` | 跨域共用的常量、错误助手、校验、日期、路径、查找与视图投影 |
| `electron/services/domain/{projects,requirements,agents,commands,changes,stats,backups,system}.js` | 按业务域落地的方法；agents 负责 Agent 注册表的创建 / 删除与 AgentID；system / backups 接收 `native` |
| `web/src/api.js` | 唯一通道改动点：`fetch` → `window.pm.invoke`；新增 `mcpInfo` / `mcpRetry` / `scoutPrompt` / `workerPrompt` / `agents` / `createAgent` / `deleteAgent` |
| `web/src/components/AiAccessModal.jsx` | 四个页签：Agent 管理（卡片显示名称 / AgentID / 技能目录与技能数，「添加 Agent」弹窗内可一键选择本机已装客户端或自定义名称与目录，目录可改）/ 自动提需求 / 自动认领（单独选择 Agent、AgentID 注入、复制接入说明）/ MCP（服务状态行 + 配置片段 + 复制配置 + 未运行提示与重试） |
| `web/src/components/McpFailBanner.jsx` | 启动失败提示条：原因 / 端口 / 重试 / 本次不再提示 |
| `web/src/components/TopWarn.jsx` | 顶部提示条骨架（数据损坏与 MCP 失败共用） |
| `web/src/lib/mcp-view.js` | 失败文案单源：`mcpFailTitle` / `mcpFailDesc` |
| `web/src/App.jsx` / `web/src/components/AppModals.jsx` | `openMcp` 同时取 `mcpInfo` / `scoutPrompt` / `workerPrompt` / `agents` 并各自降级；首屏自检挂提示条；`retryMcp` 重试；向弹窗传 `info` / `prompt` / `workerPrompt` / `agents` / `busy` / `onRetry` |
| `web/src/Sidebar.jsx` | 「设置与数据」浮层 →「通知与集成」组的「AI 接入」（`IC.plug`） |
| `web/src/ui.jsx` | 移除 `PageBar` 的 `afterTitle` 槽 |
| `web/src/styles/{modal,warnbar,controls}.css` | 配置块与状态行、`.warnbar` 与 `.warnstack` 粘性容器、停机灰点 |

## 4. 关键修正与教训

- **旧 `domain.js` 必须删除** → 与 `domain/index.js` 并存时 Node 先加载旧文件，拆分不会生效且实现会漂移。
- **子目录引用基础服务要走父级路径** → `domain/changes.js` 用 `require('../git')`；写成 `./git` 启动即失败。
- **`native` 注入遗漏会变成运行期 501** → 只有 system / backups 需要，由组装入口统一兜底，不能靠调用方补。
- **重名守卫不能用 `in`** → 会命中原型链键造成误报，改用 `Object.hasOwn`。
- **Windows GUI 进程 stdin/stdout 不可靠** → `--mcp` 直跑主进程只收到空行，无窗口 GUI 仍会崩 GPU 子进程；stdio 透传方案已由本地 HTTP 取代。
- **HTTP 入口必须做内容校验** → 缺 `Content-Type` 校验时非 JSON 会被当正常请求处理；安全校验集中在入口一次覆盖。
- **端口顺延与「配置一次永久有效」互斥** → 顺延唯一作用是容忍他人占端口，代价却是客户端静默失联。
- **端口号不能从文案里抠** → 失败信息改为结构化 `{code,port,message}`，界面不必对字符串做匹配。
- **只写 `console.error` 的错误对用户等于不存在** → 主进程能恢复的失败要连界面：原因、端口、重试都交到渲染端。
- **提示词就绪 ≠ MCP 服务存活** → 两条通道各自降级，不能绑成一个整屏错误态。
- **两条提示条各自 sticky 会在同一 `top` 重合** → 粘性挂到容器 `.warnstack`，条本身只负责内容排布；删控件时一并清理死 import 与空槽。

## 5. 已知边界

- HTTP 端点仅本机可达且无鉴权；服务随进程存在，**应用未运行时 MCP 不可用**。
- 启动失败提示只覆盖「启动时」与「手动重试」两个时刻；运行中意外中断不补提示，需用户自己发现 agent 连不上。
- 不自动写入客户端配置文件，用户需手动粘贴 `mcpServers` 片段；侧栏收起为窄栏时入口不可达。
- macOS / Linux 未实测；进程停止沿用 v1 口径（Windows `taskkill /T`，其余 SIGTERM）。
- 受限环境（远程桌面 / 沙箱 / GPU 异常）启动需加 `--no-sandbox --disable-gpu-sandbox`。

## 6. 后续候选

- 打包应用图标、自动更新、开机自启（见 `doc/system-runtime-and-release.md`）。
- macOS / Linux 实测。
- 自动写入常见客户端配置。

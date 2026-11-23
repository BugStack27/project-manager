---
date: 2026-10-29
description: 事件日志、需求时间线与全局审计；三类关键事件的系统通知与托盘待审核角标
status: accepted
---

# 事件日志、时间线与通知 — 决策记录

> 状态：✅ 已验收（2026-10-29）

## 1. 目标与范围

补上三条断掉的信息链：关键写操作与命令生命周期留痕（append-only 事件日志）、需求详情可看时间线、全局可查只读审计；待审核交付 / 命令异常 / AI 新增需求发系统通知，托盘显示待审核角标。

**做**：事件模型与埋点、需求时间线、全局审计（筛选 / 分页 / 跳转）、通知设置与合并冷却、托盘角标与直达菜单、统一跳转入口。

**不做**：收件箱 / 未读 / 红点聚合、全局搜索、MCP 新工具与 agent 鉴权、云同步、事件导出与自动清理、普通需求状态变更 / 命令正常启停 / git 提交的通知、读操作记录。

## 2. 关键决策

事件类型全集：项目 `created/updated/archived/restored/deleted`；需求 `created/updated/claimed/completed/status_changed/deleted`；命令 `created/updated/deleted/started/exited/spawn_failed/stopped/detached/recovered`；系统 `data.restored`、`settings.changed`。

| 决策点 | 结论 | 理由 |
|---|---|---|
| 事件存储 | 按项目写 `data/events/{projectId}.events.jsonl`；系统事件写 `_system.events.jsonl`；只追加不改写，永久保留 | 与 `db.json` 解耦，恢复备份不抹掉历史；单项目查询只扫自己的文件 |
| 事件结构 | `id / at / type / projectId / requirementId / commandId / actor / data`；`data` ≤2 KB，备注 ≤200 字符、命令文本 ≤300 字符；必须带项目名 / 需求序号标题 / 命令名快照 | 实体删除后审计仍可读；不存正文、diff、完整日志 |
| 事件类型 | 项目 5 类、需求 6 类、命令 9 类、数据与设置 2 类，共 22 类；校验失败与幂等路径不记 | 只记录成功的写操作与命令生命周期，避免噪声 |
| 写入顺序 | 改内存 → `store.save()` → 事件 append → emit；不做跨文件事务 | 先有业务事实再留痕；append 失败记 `[event-log] append failed` 并在 `dataStatus` 暴露，不产生幽灵事件 |
| Actor | 界面写操作=`user/我`；`/claim`、`/complete`=`agent/<AgentID>`；AI 提需求=`agent/AI`；命令、恢复、备份=`system/runner|store`；查询时按 Agent 注册表把 ID 换成名称展示（附带 `data.agentName`，查不到保留原 ID） | MCP 非认领写操作 P0 无法区分通道，统一记 `user` 并在审计中标注；事件文件存 ID 不改写，名称只影响展示 |
| 恢复备份 | 事件文件与 `db.json` 完全解耦：恢复只覆盖 `db.json`，成功后向 `_system` 追加 `data.restored`；每日快照不含事件 | 恢复不丢事件，也不产生 7 份重复历史 |
| 需求时间线 | 详情展示最近 6 条、按天倒序；交付 / 打回 / 拒绝带备注摘要；老需求用 `createdAt` 合成「创建」行并提示从本版本开始记录 | 不翻页即可看到最近上下文，完整历史走审计 |
| 时间线与往返记录去重（2026-11-07） | 需求已有往返记录（含交付 / 打回 / 问答）时，详情不再重复列出时间线，只保留一行「事件记录 · 查看全部」入口；没有往返记录的老需求仍按原样展示最近 6 条 | 两段列表说的是同一批事件，重复占版面；对话留在详情，明细归审计 |
| 全局审计 | 项目（含已删除）/ 类型 / 操作者 / 时间四维筛选；首屏 50 条 + `before` 游标；已删除实体显示快照且不可点，存活实体可直达；只读 | 错过的通知靠审计找回，不引入收件箱状态 |
| 通知范围 | 只通知待审核交付、命令异常退出 / 启动失败、AI 新增需求；设置键 `enabled / reviewReady / commandFailed / aiRequirement`；总开关 + 三类分项开关；AI 60 秒合并、同命令 5 分钟冷却；归档项目、正常退出、手动停止、启动恢复不通知 | 只提醒需要人处理的关键闭环，避免通知风暴与误报 |
| 通知降级 | `Notification.isSupported()` 为假、权限被拒、系统免打扰时静默跳过；角标与时间线 / 审计不受影响；通知对象保留引用到 close | 系统能力不可用不能拖垮主流程 |
| 托盘角标 | 非归档项目 `status='review'` 计数；`0` 不显示、`1–9` 原数、`>9` 显示 `9+`；Windows 图标变体 + tooltip + 任务栏 overlay，macOS Dock + tray title，Linux 尽力而为；菜单可按项目直达 | 待审核是唯一卡在用户这儿的环节，忘记验收会一直留在未完成列表里 |
| 统一跳转 | 主进程 `navigateTo({page, projectId, requirementId|commandId|runId})`：恢复 / 重建窗口，加载中等待完成再推 `pm:navigate`；preload 缓存首条消息，避免 React 挂载前丢失 | 通知点击与审计点击共用一套逻辑，不维护两份跳转 |

入口：审计日志在侧栏「设置与数据」→「数据」二级菜单；通知设置在「通知与集成」；需求时间线的「查看全部」直接打开审计并预置项目 / 需求过滤。

## 3. 交付物

| 文件（相对路径） | 职责 |
|---|---|
| `electron/services/event-log.js` | JSONL 扫描 / 追加、半截行跳过、项目与全局内存索引、`append/query/timeline`、截断与游标 |
| `electron/services/domain/events.js` | `events` / `requirementTimeline` IPC 方法，含已删除实体标记 |
| `electron/services/domain/settings.js` | 通知设置默认值、读取、保存与 `settings.changed` |
| `electron/services/notify.js` | 三类通知、开关、AI 合并、命令冷却、点击跳转、平台降级 |
| `electron/services/review-badge.js` | 待审核计数、平台化角标、托盘菜单数据 |
| `electron/services/runner.js` + `electron/services/domain/{projects,requirements,commands,backups}.js` | 业务事件埋点与命令生命周期事件 |
| `electron/main.js` / `preload.js` / `ipc.js` | 初始化顺序、`navigateTo`、`pm:navigate` 与退出时清理 |
| `web/src/RequirementDetail.jsx` / `components/{AuditModal,NotificationModal}.jsx` | 时间线、全局审计、通知设置 |
| `web/src/lib/events-view.js` | 22 类事件的文案、图标、摘要、actor 与按天分组 |
| `web/src/{App,api,Sidebar}.jsx` + `hooks/useNavigation.js` | 路由、IPC 包装、侧栏入口与跳转落点 |
| `scripts/make-tray-icons.js` + `electron/assets/{tray,overlay}/review/*` | 数字角标与 overlay 资源 |
| `README.md` / `doc/product-spec.md` | 功能、数据目录、操作说明与边界 |

## 4. 关键修正与教训

- **半截事件行会让后续追加粘连** → 启动时跳过坏行且不改写文件；追加前检测文件尾并补换行。
- **`data` 上限按字符算会超 2 KB** → 必须按 UTF-8 字节（`Buffer.byteLength`）截断，省略号也计入长度。
- **恢复备份会顺手把事件写回旧状态** → 事件不进 `db.json`，恢复只覆盖库、`_system` 追加一条 `data.restored`，项目事件文件逐字节不变。
- **启动恢复被误报为命令失败** → `runner.recover` 记 `command.recovered`，通知服务忽略；正常退出与手动停止同样不通知。
- **通知对象被回收后点击无反应** → 通知实例必须保留引用到 `close` / 超时。
- **工具名 / 事件名按关键字一刀切会漏** → 事件记录点以「领域方法 → 事件」映射逐条核对，失败与幂等路径必须为 0 条。
- **审计弹窗的「已删除」不能只看事件** → 查询结果补 `deleted` 标记，归档但存活的项目 / 需求仍应可跳转。

## 5. 已知边界

- 单项目事件文件永久增长；全局审计启动时全量加载并建内存索引，事件量再大需要分片或按需加载。
- 事件文件不在每日快照内：磁盘损坏会丢事件，目前只能靠手工备份。
- 业务保存成功但事件追加失败时，审计缺一条，只有诊断标记，不做补偿 / 对账。
- 无收件箱：错过的通知只能从需求时间线与审计回溯。
- 项目删除后事件文件保留且无清理入口；已删除实体的行只展示快照。
- 窗口聚焦时仍弹系统通知；P0 接受，后续可降级为应用内 toast。

## 6. 后续候选

- 收件箱 / 未读 / 红点聚合；全局搜索 / `Ctrl+K`。
- MCP token、agent 身份与调用审计。
- 事件文件按年 / 月分片、按需加载、导出与归档清理。
- 交付证据（commit SHA / PR / 测试结果）写入 `requirement.completed`。
- 基于事件计算 lead time / cycle time 与周报。

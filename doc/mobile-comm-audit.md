---
date: 2026-11-18
description: 手机端与桌面端通信全链路排查：问题清单、根因证据与修复任务规划
complete: true
---

# 手机端通信全链路排查 - 任务规划

## 1. 需求概述

从配对扫码、网关注册订阅、隧道地址下发、在线判定、待办长轮询到答复与提交回执，逐环节核对
`peoject-manager`（桌面端）与 `project-manager-mobile`（手机端）的实现是否一致、失效后能否自愈。

本次先产出问题清单，再按任务拆分修复；不改配对协议版本（仍为 v2），不重做传输层架构。

最终落地：桌面端地址心跳改为 60 秒；手机端在线 = 频道已连且（远程面可达或 150 秒内收到心跳）；设备记录失效自动重注册；隧道自检走 `net.fetch`；顶部提示覆盖频道、隧道与 MCP 故障；PushGo 仍只下发接入点。

已确认的边界：

- 范围：全链路端到端审计，不止两个已知症状。
- 产出：问题清单 + 带验收标准的修复任务。
- 改动：两端代码都可改。
- 验收：由用户自行验证，本文只给验收口径，不代为执行。

## 2. 需求澄清记录

| 问题 | 结论 |
|---|---|
| 排查覆盖范围 | 全链路端到端：配对 / 注册订阅 / 地址下发 / 在线判定 / 长轮询 / 答复回执 / 断线与重启恢复 |
| 文档产出形式 | 问题清单 + 修复任务规划，问题与任务一一对应 |
| 修复阶段改动边界 | 桌面端与手机端都可改，必要时同步更新协议文档 |
| 修复后的验收环境 | 暂不由本次规划执行验证，用户自行验证；文档给出可手工核对的验收口径 |
| 在线判定最终口径 | 初稿按 150 秒心跳；实施任务 6 后改为「远程面可达即在线，远程面失败即不可达，两者都未知才看心跳」 |
| 实施方式 | dev-loop 要求单条串行，实际按任务 1→7 顺序执行，未采用初稿的并行批次 |
| 文档修正范围 | 除三份协议/设计文档外，实际还修正了 `changes-and-git-sync.md`、`requirements-and-agent.md` 的 `mobileAnswer` 旧引用 |

补充假设（若与预期不符，后续任务需要调整）：

1. 手机端「在线」应表示**桌面端可用**（MCP 与 `/remote` 可达），而不是 PushGo 频道是否存在。
2. 桌面端窗口关闭但驻留托盘、服务仍在运行时，手机端显示在线是正确结果。
3. 桌面端真正退出后，手机端最迟 150 秒内翻为未在线可接受；新配对后最迟 60 秒内拿到地址可接受。

## 3. 链路现状（排查基线）

> 以下参数是本次改造前的基线（2026-11-18 上午），用于定位问题；修复后的节奏与在线口径见任务 1、2、6。

| 环节 | 当前实现 | 节奏 / 关键约束 |
|---|---|---|
| 配对 | 二维码为 PushGo v2 JSON：网关 + 频道 ID + 频道密码（密码兼作 AES-GCM 密钥） | 网关固定 `https://gateway.pushgo.cn`；`.dev` 旧值归一到 `.cn` |
| 设备与频道 | 两端各自注册设备、建立 fcm 路由、订阅频道 | 频道只存在于创建它的网关；换网关必须重扫码 |
| 地址下发 | 桌面端在 keepalive 的 `payload.endpoint` 里带隧道地址与令牌 | 桌面端 5 秒检查一次；地址变化立即发；地址不变每 10 分钟重发 |
| 手机取地址 | 每 15 秒 `/messages/pull` 拉取、解信封、只处理 `endpoint` | Pull 只取本设备队列；桌面端已不再 pull |
| 业务数据 | 手机对每台桌面各跑一条 `/remote/wait` 长轮询 | 客户端挂 25 秒，服务端上限 30 秒；答复走 `/remote/requirement/:rid/answer` |
| 在线判定 | 手机端只看 PushGo 频道是否订阅成功 | 心跳只刷新“通道最近更新”，不参与在线判定 |
| 隧道 | cloudflared quick tunnel + 30 秒自检（连续 2 次失败重启） | 重启后地址变化，靠桌面端强制心跳重新下发 |
| 退出清理 | 桌面端 `shutdown()` 先停通道、再停隧道、最后关 MCP | 窗口关闭只是隐藏到托盘；托盘「退出」才真正退出 |

## 4. 问题清单

> 以下为本次修复前的问题与证据；每项的修复状态见文末「Complements」。

### P0-1 手机端「在线」只反映网关频道，桌面端退出后不会变

- **证据**
  - 手机端 `connected` 仅在 `ensureReady()`（注册设备、建路由、订阅频道）成功后置真：
    `project-manager-mobile/.../link/PushGoSession.kt:94-99`。
  - 状态文案只认 `connected`，并明确不再用心跳判断在线：
    `.../data/Models.kt:143-162`；单测还断言「心跳过期仍算在线」：
    `.../test/.../LinkFailuresTest.kt:88-110`。
  - 连接页与前台服务通知的「N 台在线」同源：`LinkManager.kt:108-115`、
    `MobileLinkService.kt:110-120`。
  - 桌面端退出时会停止心跳与隧道（`electron/main.js:570-574`），但频道在网关上仍然存在，
    手机端每 15 秒 pull 依旧成功，`connected` 一直为真。
- **影响**：桌面端已退出、手机端通信已关闭，手机仍显示在线；用户按“在线”判断能否操作，实际请求全失败。
- **对应任务**：任务 2（在线语义）、任务 6（远程面健康补充）。

### P0-2 新配对后地址最长要等 10 分钟

- **证据**
  - 地址未变化时桌面端不重发，只有 `REFRESH_MS = 10 分钟` 到期才发：
    `electron/services/mobile-link.js:19-21`、`:305-323`。
  - Pull 原型按设备队列取消息（`doc/pushgo-link.md:54`）：手机在桌面端上一次发布之后才订阅频道，
    收不到之前那条消息，只能等下一轮重发。
  - 手机端此时 `RemoteConfig.ready=false`，项目页显示「等待桌面端地址」：
    `RemoteScreens.kt:79-94`、`RemoteViewModel.kt:88-107`。
- **影响**：手机扫码 / 重新安装后，明明是同一台电脑、电脑也开着，却可能干等接近 10 分钟。
- **置信度**：高（按当前 Pull 队列实现推断），建议在修复前用真机复现一次确认时延。
- **对应任务**：任务 1（心跳节奏）。

### P1-3 手机端不处理 `device_key_not_found`，网关清数据后无法自愈

- **证据**
  - 桌面端会解析 `error_code` 并重新注册设备、重建路由：`mobile-link.js:91-96`、`:221-250`。
  - 手机端 `ensureReady()` 只在 `deviceKey` 为空时注册；路由 / pull 报设备不存在时，
    `PushGoHttpException` 只保留 HTTP 状态码与文本，不解析 `error_code`：
    `.../link/PushGoClient.kt:141-157`、`PushGoSession.kt:116-138`。
  - 失败会归到「网关报错」并无限重试同一把旧 key：`LinkFailures.kt:24-52`。
- **影响**：网关维护 / 数据清理后，手机端一直重连失败，只能删连接重新扫码；桌面端同一场景可自愈。
- **对应任务**：任务 5。

### P1-4 隧道自检使用 Node fetch，代理与中间人证书环境下可能误判

- **证据**
  - 自检直接使用全局 `fetch` 打公网地址：`electron/services/tunnel.js:69-92`。
  - 项目里已记录 Node fetch 不读系统代理与系统证书库，cloudflared 下载因此改走 `net.fetch`：
    `electron/main.js:857-863`。
  - 本机网络存在中间人证书（GitHub 场景已验证）时，若代理同样接管 `trycloudflare.com`，
    自检会连续失败 2 次并重启隧道，地址反复变化。
- **影响**：隧道进入「拿到地址 → 自检失败 → 重启 → 新地址」循环，手机端地址频繁失效，
  表现为反复等待地址 / 连接失败。需结合桌面日志确认是否命中。
- **对应任务**：任务 4。

### P1-5 手机端远程面失败完全静默，状态与真实可用性脱节

- **证据**
  - `RemoteWatcher` 的长轮询失败只做退避，不记录也不上报：`.../link/RemoteWatcher.kt:74-95`。
  - 项目页的 `online` 只由手动加载项目成功/失败更新，且重试间隔 30 秒：
    `RemoteViewModel.kt:123-150`；长轮询恢复后不会主动刷新这个状态。
  - 连接页面的「在线」又来自 PushGo 频道（P0-1），两条状态互不相干。
- **影响**：桌面端退出后，待办页、项目页、连接页给出的结论不一致；用户无法判断是网络问题还是电脑没开。
- **对应任务**：任务 6。

### P2-6 桌面端顶部提示只覆盖「频道失效」，隧道与网关故障藏在弹窗里

- **证据**
  - `mobileAlert` 只把 `channel_not_found` 报为需要用户介入：`main.js:983-996`；
    隧道准备中 / 下载失败 / MCP 未就绪只在「手机端通信」弹窗内展示。
- **影响**：cloudflared 缺失、MCP 没起来时，主界面没有任何提示，手机端只能干等；与项目既有的
  「需要用户动手的失效态必须在页面顶部提示」口径不一致。
- **对应任务**：任务 3。

### P2-7 文档与常量停留在旧语义

- **证据**
  - `doc/pushgo-link.md:58-60` 仍写「双方每分钟 keepalive、桌面端按手机心跳判在线」，
    与改造后「桌面端只发地址、手机端不做心跳判定」不符。
  - `electron/services/mobile-protocol.js:29-32` 与手机端 `core/Protocol.kt:39-40` 的
    `KEEPALIVE_MS` / `CLIENT_ONLINE_MS` 已不参与在线判定，容易误导后续修改。
- **影响**：下次改动会按错误规格实现，复现本次两类问题。
- **对应任务**：任务 7。

### P2-8 手机端仍保留带 `op_id` 的发送能力

- **证据**：`PushGoClient.send` 仍写 `op_id`（`.../link/PushGoClient.kt:83-106`），
  而公共网关自 2026-11-18 起对客户端传入 `op_id` 返回 400；当前无调用方。
- **影响**：死代码，但容易被后续功能误用，直接踩网关限制。
- **对应任务**：任务 7。

### P3-9 异常退出可能遗留 cloudflared 子进程（本轮不修）

- **证据**：正常退出会 `tunnelCtl.stop()`（`main.js:570-574`）；崩溃或被强杀时子进程可能存活，
  隧道仍指向已关闭的 7318 端口。
- **影响**：残留进程占用资源；公网请求得到 502，但地址已不再广播，影响有限。
- **处理**：本轮只记录，不纳入任务；若后续确认有残留，再单独评估随进程组终止的方案。

### P3-10 项目页「连接中断」可能长期停留在旧结论（并入任务 6）

- **证据**：`RemoteScreens.kt:79-94` 依据 `RemoteDesktopState.online`，该值只在加载项目时更新；
  桌面端恢复后，未触发加载就不会自己变回在线。
- **处理**：由任务 6 统一远程面健康状态后一并解决，不单独拆任务。

## 5. 任务列表

### 任务 1：桌面上调地址心跳节奏，新配对 60 秒内可拿到地址

| 属性 | 值 |
|---|---|
| **描述** | 地址未变化时的重发周期从 10 分钟调整为 60 秒，与协议文档、手机端 Pull 节奏一致；地址变化仍立即发送。`hasEndpoint` 改为只在最近一次 `/message` 成功后为真，发送失败、无地址或关闭开关时清零。 |
| **涉及文件** | `electron/services/mobile-link.js`（`REFRESH_MS`、`publishEndpoint`、`tick`、`statusView`） |
| **依赖关系** | 无 |
| **验收标准** | ① 桌面端运行、手机端通信开启、地址不变时，网关约每 60 秒收到一条 `/message`，5 秒 tick 不额外产生消息；② 手机新配对后 ≤60 秒 `RemoteConfig.ready` 为真；③ 发送失败时弹窗显示连接失败，不显示“已下发接入点”；④ 关闭手机端通信后不残留“已下发接入点”；⑤ `npm run check` 通过。 |

### 任务 2：手机端在线语义改为「频道连通 + 桌面端心跳新鲜」

| 属性 | 值 |
|---|---|
| **描述** | 用 `connected && lastInboundAt` 是否在 150 秒内判定桌面端在线；频道已连上但心跳过期显示「等待桌面端」（非报错态，不催用户扫码）；频道本身失败时沿用现有失败分类。每轮 Pull 后上报带 `checkedAt` 的运行态，让纯时间变化也能触发界面翻态。最终在线口径在任务 6 中扩展为「远程面可达或心跳新鲜」。 |
| **涉及文件** | `app/.../link/PushGoSession.kt`；`app/.../data/Models.kt`（`statusText` / `chipText` / `isOnline` / `checkedAt`）；`app/.../link/LinkManager.kt`；`app/.../service/MobileLinkService.kt`；`app/.../ui/ConnectionsScreen.kt`；`app/.../ui/ConnectionDetailScreen.kt`；`app/.../ui/TodoScreen.kt`；`app/src/test/.../LinkFailuresTest.kt` |
| **依赖关系** | 任务 1（60 秒心跳是 150 秒判定的前提） |
| **验收标准** | ① 托盘「退出」后 ≤150 秒，连接页与通知从在线翻为“等待桌面端”；② 窗口关闭驻留托盘时保持在线；③ 桌面端重新启动后 ≤60 秒恢复在线；④ 新配对首条心跳到达前沿用“等待桌面端”，不出现误导性的失败文案；⑤ 没有新消息时，靠 15 秒一次的运行态上报也能在约 150 秒后自动翻态；⑥ 相关 JVM 单测覆盖：新鲜心跳=在线、过期心跳=等待桌面端、频道失败=原分类。 |

### 任务 3：桌面端顶部提示覆盖隧道与网关未就绪

| 属性 | 值 |
|---|---|
| **描述** | 扩展 `mobileAlert` 的判据：除 `channel_not_found` 外，把 cloudflared 下载失败 / 缺失、MCP 未就绪、隧道持续不可达也作为需要用户介入的状态返回。`tunnelState()` 在 MCP 未就绪时直接给出 `mcp_down`；隧道用 `consecutiveRestarts`（自检成功清零、退出累加，连续 3 次才提示）区分短暂重连与持续故障，`start()` 时清理旧故障态。顶部提示按故障类型给出文案与打开「手机端通信」弹窗的入口，保持“只读状态、不触发联网”。 |
| **涉及文件** | `electron/main.js`（`mobileAlert`、`tunnelState`）；`electron/services/tunnel.js`（`consecutiveRestarts`、`start` 清理）；`web/src/hooks/useMobileAlert.js`；`web/src/components/MobileRepairBanner.jsx`；`web/src/components/TopWarnStack.jsx` |
| **依赖关系** | 无 |
| **验收标准** | ① 关闭 MCP 或删除 cloudflared 后，主界面顶部出现提示且可一键打开弹窗；② 隧道短暂重连不提示，连续退出且自检未恢复（3 次）才提示；③ 未开启手机端通信时不出现任何提示；④ `mobileAlert` 只读状态、不触发网络；⑤ 提示标题与按钮能区分「重新配对」与「去处理」；⑥ `npm run check` 与 web build 通过。 |

### 任务 4：隧道健康检查改走 Chromium 网络栈

| 属性 | 值 |
|---|---|
| **描述** | 给 `createTunnel` 增加可注入的 `fetchImpl`，由 `main.js` 传入 `net.fetch`，与 cloudflared 下载保持同一网络栈；仅当确实连续 2 次失败才判定隧道失效，证书/代理类错误不再触发无意义重启。 |
| **涉及文件** | `electron/services/tunnel.js`（`checkHealth` 改为使用注入实现）；`electron/main.js`（`startTunnel` 传参） |
| **依赖关系** | 无 |
| **验收标准** | ① 在开启系统代理 / 中间人证书的环境中连续 30 分钟，桌面日志不出现 `tunnel_unreachable` 重启循环；② 手动断网或杀掉 cloudflared 后仍能在连续 2 次自检失败后按退避重启；③ `npm run check` 通过。 |

### 任务 5：手机端设备会话失效自恢复

| 属性 | 值 |
|---|---|
| **描述** | `PushGoHttpException` 解析网关返回的 `error_code`；`PushGoSession` 遇到 `device_key_not_found` 时清空设备 key、路由与订阅标记，重新注册并重建路由、重新订阅，只自愈一轮，失败再按现有退避重试。频道不存在仍走「频道失效 + 重新扫码」。 |
| **涉及文件** | `app/.../link/PushGoClient.kt`；`app/.../link/PushGoSession.kt`；`app/.../link/LinkFailures.kt`（如新增错误码映射）；`app/src/test/.../LinkFailuresTest.kt` |
| **依赖关系** | 无 |
| **验收标准** | ① 在网关侧清掉设备记录后，手机端无需重扫码即可重新注册并恢复地址接收；② 频道真失效时仍显示「频道失效」并给扫码入口；③ 连续失败不会陷入注册风暴（有退避、单轮只尝试一次）；④ 单测覆盖新错误码分支。 |

### 任务 6：手机端把远程面健康纳入统一状态

| 属性 | 值 |
|---|---|
| **描述** | `RemoteWatcher` 在每台连接上记录最近一次长轮询成功 / 失败时间（`remoteOkAt` / `remoteFailAt`）与可达布尔值，并提供可观察状态。`ConnectionRuntime.isOnline` 最终口径为：频道已连且 `remoteReachable != false`，并且「远程面可达或 150 秒内收到心跳」；远程面失败直接显示「桌面端不可达」。取消 / 换接入点不记为失败，旧请求结果不覆盖新状态。连接页、项目页、待办与通知共用这一结论；恢复后自动回到在线，失败不弹窗打扰。 |
| **涉及文件** | `app/.../link/RemoteWatcher.kt`；`app/.../link/LinkManager.kt`；`app/.../data/Models.kt`；`app/.../service/MobileLinkService.kt`；`app/.../ui/RemoteViewModel.kt`；`app/.../ui/RemoteScreens.kt`；`app/.../ui/ConnectionsScreen.kt`；`app/.../ui/ConnectionDetailScreen.kt`；`app/.../ui/TodoScreen.kt`；`app/src/test/.../LinkFailuresTest.kt` |
| **依赖关系** | 任务 2（复用在线/等待/失败三态口径） |
| **验收标准** | ① 桌面端退出或隧道重建时，项目页在一个长轮询周期加退避内显示「桌面端不可达」；② 恢复后无需手动刷新即回到在线；③ 连接页、项目页、通知对同一台桌面端给出相同结论，并区分「等待桌面端」与「不可达」；④ 频道失败仍显示原分类，不误报不可达；⑤ 长轮询失败不产生重复通知，取消/换接入点不误判；⑥ `remoteOkAt` / `remoteFailAt` 只随对应结果更新。 |

### 任务 7：清理协议残留并对齐文档

| 属性 | 值 |
|---|---|
| **描述** | 删除手机端带 `op_id` 的 `PushGoClient.send`（当前无调用方）；处理两端已失效的 `KEEPALIVE_MS` / `CLIENT_ONLINE_MS` 常量（桌面端删除，手机端各保留一处并被实际使用）；更新协议、远程面与手机端设计文档中的在线判定、心跳节奏、地址下发说明；顺带修正其他文档里 `mobileAnswer` / `mobilePending` 的旧引用与 `/remote/wait` 的长轮询描述。 |
| **涉及文件** | `app/.../link/PushGoClient.kt`；`app/.../core/Protocol.kt`；`electron/services/mobile-protocol.js`；`doc/pushgo-link.md`；`doc/remote-access.md`；`doc/pushgo-endpoint-only.md`；`doc/changes-and-git-sync.md`；`doc/requirements-and-agent.md`；`project-manager-mobile/doc/mobile-app-design.md` |
| **依赖关系** | 任务 1、2、5、6（常量与文档按最终实现收口） |
| **验收标准** | ① 手机端源码中不再出现 `op_id`；② 心跳/在线常量只有一处定义且被实际使用；③ 文档描述的节奏与行为能逐条对应到代码（含 60 秒心跳、在线三态、`answerRemote`、`/remote/wait` 长轮询、net.fetch 自检）；④ `npm run check`、web build、手机端单测通过。 |

## 6. 执行顺序

实际按 dev-loop 的单条串行方式执行：任务 1 → 2 → 3 → 4 → 5 → 6 → 7。依赖关系保持不变（1→2、2→6、1/2/5/6→7）；任务 3、4、5 虽可独立，也没有并行，以便每条需求单独审查和记录。

风险提示：

- 任务 1 把消息频率从 0.1 次/分钟提到 1 次/分钟，仍远低于网关限额（60 次/IP/分钟），但需确认既有日志与统计不被刷屏。
- 任务 2 会推翻手机端现有「心跳不参与在线」的产品结论，必须同步改测试与设计文档，否则后续维护会回退。
- 任务 6 的在线判定是「远程面可达即在线，远程面失败即不可达，两者都未知才看心跳」；远程面成功就足以证明桌面端可用，不必等心跳，避免网关投递延迟造成误判离线。

## 7. 用户自验清单

不执行构建与真机操作，修复完成后可按以下顺序手工核对：

1. 桌面端开启手机端通信，手机端扫码：观察从扫码到项目页出现地址的耗时（应 ≤60 秒）。
2. 桌面端窗口关闭（驻留托盘）：手机端连接页应保持在线，项目页可正常加载。
3. 桌面端托盘「退出」：手机端通常 45 秒内显示「桌面端不可达」；若长轮询还没失败，心跳过期后显示「等待桌面端」（最迟 150 秒）。
4. 桌面端重新打开：手机端应在一个心跳周期内恢复在线，无需重扫码。
5. 开启本机代理 / FastGithub，持续运行 30 分钟：桌面端不应反复重建隧道，手机端地址不跳变。
6. 在网关侧清理设备数据（或换一台网关上不存在的设备 key）后重启手机端：应自动恢复，不需要重扫码。
7. 在桌面端「重新配对」：手机端应显示频道失效并引导扫码，扫码后恢复。

## Complements

### 1. 桌面端地址心跳节奏与下发状态
- **状态**：✅ 已完成
- **修改文件**：
  - `electron/services/mobile-link.js` — `REFRESH_MS` 改为 60 秒；`hasEndpoint` 改为仅在最近一次 `/message` 成功后为真，发送失败与关闭开关时清零
- **审查结果**：审查通过（60 秒重发、变址立即发、失败态正确；补充关闭开关清零）
- **完成时间**：2026-11-18 11:47

### 2. 手机端在线语义改为心跳新鲜度
- **状态**：✅ 已完成
- **修改文件**：
  - `app/.../data/Models.kt` — 新增 `isOnline()`（任务 6 后为「远程面可达或 150 秒内心跳」）与 `checkedAt`，状态/短标签改为在线、等待桌面端、失败三态
  - `app/.../link/PushGoSession.kt` — 每轮 Pull 后上报运行态并刷新 `checkedAt`，保证心跳过期能自动翻态
  - `app/.../link/LinkManager.kt`、`service/MobileLinkService.kt`、`ui/ConnectionsScreen.kt`、`ui/ConnectionDetailScreen.kt`、`ui/TodoScreen.kt` — 列表、详情、待办、通知与汇总统一使用 `isOnline()`；通知与汇总区分等待桌面端与真失败
  - `app/src/test/.../link/LinkFailuresTest.kt` — 覆盖新鲜、过期、无心跳与 150 秒边界
- **审查结果**：首轮未通过（通知与汇总未区分等待态），补齐后复审通过；单测 39 项全过
- **完成时间**：2026-11-18 12:02

### 3. 桌面端顶部故障提示
- **状态**：✅ 已完成
- **修改文件**：
  - `electron/main.js` — `mobileAlert` 覆盖频道失效、MCP 未就绪、cloudflared 缺失/下载失败与持续隧道故障；`tunnelState` 合并 `mcp_down`
  - `electron/services/tunnel.js` — 新增 `consecutiveRestarts`（自检成功清零、退出累加），`start()` 清理旧故障态
  - `web/src/hooks/useMobileAlert.js`、`components/MobileRepairBanner.jsx`、`components/TopWarnStack.jsx` — 按故障类型给出提示标题与「去处理 / 去重新配对」入口
- **审查结果**：首轮未通过（`mcp_down` 无法进入快照），修复后复审通过；check 与 web build 通过
- **完成时间**：2026-11-18 12:05

### 4. 隧道自检改走 Chromium 网络栈
- **状态**：✅ 已完成
- **修改文件**：
  - `electron/services/tunnel.js` — `createTunnel` 支持注入 `fetchImpl`，自检默认回退全局 fetch
  - `electron/main.js` — 传入 `(url, opts) => net.fetch(url, opts)`，与 cloudflared 下载同一网络栈
- **审查结果**：审查通过（自检间隔、超时、连续失败阈值均未变）
- **完成时间**：2026-11-18 12:07

### 5. 手机端设备会话失效自恢复
- **状态**：✅ 已完成
- **修改文件**：
  - `app/.../link/PushGoClient.kt` — 解析顶层与 `problem.error_code`
  - `app/.../link/LinkFailures.kt` — 新增 `isDeviceGone()`，兼容只有文本的老网关
  - `app/.../link/PushGoSession.kt` — `device_key_not_found` 时清空设备/路由/订阅状态，下一轮重新注册
  - `app/src/test/.../link/LinkFailuresTest.kt` — 覆盖设备失效判定，排除频道失效
- **审查结果**：审查通过；频道失效仍走重新扫码，退避未被绕过
- **完成时间**：2026-11-18 12:09

### 6. 手机端远程面健康状态
- **状态**：✅ 已完成
- **修改文件**：
  - `app/.../link/RemoteWatcher.kt` — `/remote/wait` 成功/失败按连接上报，取消不误判，旧请求不覆盖新状态
  - `app/.../link/LinkManager.kt`、`data/Models.kt` — `remoteReachable` 与成功/失败时间并入运行态；PushGo 重报时保留
  - `app/.../service/MobileLinkService.kt`、`ui/ConnectionsScreen.kt`、`ui/ConnectionDetailScreen.kt`、`ui/TodoScreen.kt`、`ui/RemoteViewModel.kt`、`ui/RemoteScreens.kt` — 在线 / 等待桌面端 / 桌面端不可达统一口径，项目页自动恢复
  - `app/src/test/.../LinkFailuresTest.kt` — 覆盖远程面失败与可达
- **审查结果**：首轮未通过（项目页/通知/汇总未区分不可达与等待），修复后复审通过；单测 42 项全过
- **完成时间**：2026-11-18 12:13

### 7. 协议残留清理与文档对齐
- **状态**：✅ 已完成
- **修改文件**：
  - `electron/services/mobile-protocol.js` — 删除失效的 `KEEPALIVE_MS` / `CLIENT_ONLINE_MS`
  - `app/.../link/PushGoClient.kt` — 删除带 `op_id` 且已无调用方的 `send`
  - `doc/pushgo-link.md`、`doc/remote-access.md`、`doc/pushgo-endpoint-only.md`、`doc/changes-and-git-sync.md`、`doc/requirements-and-agent.md` — 60 秒心跳、在线语义、`answerRemote`、net.fetch 自检、`/remote/wait` 长轮询
  - `project-manager-mobile/doc/mobile-app-design.md` — 在线判定、状态标签、只下发接入点、设备自愈
- **审查结果**：三轮审查后通过（补齐答复领域方法、长轮询说明与历史基线标注）；check、web build、手机端单测通过
- **完成时间**：2026-11-18 12:15

## 完成总结

- 7 个任务全部完成并通过审查；桌面端 `npm run check`、web build，手机端 `testDebugUnitTest`（42 项）均通过。
- 关键行为变化：地址心跳 10 分钟 → 60 秒；手机端在线改为「心跳新鲜或远程面可达」，桌面退出 150 秒内（通常更快）翻为等待/不可达；设备记录被网关清理后自动重注册；隧道自检改走系统网络栈；顶部提示覆盖隧道与服务故障。
- 未执行真机与打包版验证，按约定由用户按「用户自验清单」逐项核对。


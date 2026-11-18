---
date: 2026-11-16
description: 把 PushGo 收窄成「只下发接入点」，审批与提问全部改走 /remote 长轮询，并把长轮询搬进前台服务保证后台通知
---

# PushGo 只做地址通道 - 任务规划

## 需求概述

现在待审核有两条路：PushGo 推送（前台服务里拉）与 `/remote/wait` 长轮询（界面 ViewModel 里跑）。
第二条绑在 Activity 上，退到后台被回收就断，于是「后台收不到通知」。

目标是把职责切开：**PushGo 只负责把隧道地址与令牌送到手机**，一条消息都不承载业务；
**所有审批、提问、回答只走 HTTP 远程面**，长轮询搬进前台服务，与 PushGo 同生命周期常驻。

## 需求澄清记录

| 问题 | 结论 |
|---|---|
| PushGo 保留到哪一步 | 只下发地址与令牌：心跳只带 `endpoint`，去掉 review/question/answer/pending/resolvedIds |
| 后台保活做到哪一档 | 前台服务 + 唤醒锁。不加 WorkManager，不加精确闹钟 |
| 被划掉/强杀后怎么办 | 承认 force-stop 后无法自拉起，重开时按持久化的已提醒集合补发 |

## Requirements

### 1. 领域层：待办与答复改用远程口径

| 属性 | 值 |
|---|---|
| **目标** | 新增 `remotePendingTickets()` 与 `answerRemote({rid,decision,text,questionId})`；删除 `mobilePending` / `mobileAnswer` / `pendingMessages`；`commitAndPushApproved` 迁进 `answerRemote`，保住「通过即提交并推送」 |
| **涉及文件** | `electron/services/domain/mobile.js` |
| **验收标准** | `answerRemote` 对 approve 先提交推送再落库；对 answer 走 `answerRequirement`；返回 `{applied, duplicate?, reason?, commit?}` 与旧 `mobileAnswer` 一致 |
| **依赖** | 无 |

### 2. 传输层：PushGo 只发接入点

| 属性 | 值 |
|---|---|
| **目标** | `mobile-link.js` 只保留设备注册 / 订阅 / 心跳；心跳 payable 只带 `endpoint`；删掉内层 pull 循环、`sendPending`、`pollPage`、`resolvedIds`、`pending` |
| **涉及文件** | `electron/services/mobile-link.js` |
| **验收标准** | 桌面端不再向频道发 review/question；不再拉取答案；`statusView` 不再有 `pending/published/lastAnswer` |
| **依赖** | 1 |

### 3. 协议层：删掉业务消息形状

| 属性 | 值 |
|---|---|
| **目标** | `mobile-protocol.js` 删 `reviewMessage` / `questionMessage` / `normalizeAnswer` / 答案 id 生成；保留连接信息、信封、keepalive |
| **涉及文件** | `electron/services/mobile-protocol.js` |
| **验收标准** | `npm run check` 通过；无残留调用方（grep 为空） |
| **依赖** | 2 |

### 4. 远程面接线

| 属性 | 值 |
|---|---|
| **目标** | `mcp-http.js` 的 `requirementAnswer` / `pending` / `wait` 改调 `answerRemote` / `remotePendingTickets`，删除手工构造协议消息那段 |
| **涉及文件** | `electron/mcp-http.js` |
| **验收标准** | 27 条远程面断言改写后仍全过；答案 id 由领域层生成 |
| **依赖** | 1 |

### 5. 桌面端文案与状态收尾

| 属性 | 值 |
|---|---|
| **目标** | 手机端通信弹窗去掉「待处理」「上次发送」这类 PushGo 业务状态，说明改为「只负责下发接入点」 |
| **涉及文件** | `web/src/components/MobileLinkModal.jsx`、`electron/services/mobile-link.js` |
| **验收标准** | 弹窗里不再出现待办数量；状态只剩连接/在线 |
| **依赖** | 2 |

### 6. 手机端：PushGo 只解析 endpoint

| 属性 | 值 |
|---|---|
| **目标** | `PushGoSession.kt` 只处理 keepalive 的 `endpoint`；删除 review/question 落库、答案发送、失败重发；`LinkManager.sendAnswer` 删除 |
| **涉及文件** | `app/src/main/java/com/projectmanager/mobile/link/PushGoSession.kt`、`link/LinkManager.kt` |
| **验收标准** | 编译通过；客户端不再发 answer 消息；地址变更仍能落盘 |
| **依赖** | 2 |

### 7. 手机端：待办来自 HTTP 并持久去重

| 属性 | 值 |
|---|---|
| **目标** | `StoreSnapshot` 加 `remoteNotified`；新增把 `RemoteTicket` 映射成 `PendingItem`（`connId="remote"`）并写库的方法；已提醒集合落盘，供重开补发 |
| **涉及文件** | `data/Models.kt`、`data/AppRepository.kt` |
| **验收标准** | 映射后的条目在待办页可正常展示；重启后同一条不重复提醒 |
| **依赖** | 6 |

### 8. 手机端：长轮询常驻前台服务

| 属性 | 值 |
|---|---|
| **目标** | `RemoteWatcher` 常驻 `MobileLinkService`，用落盘集合去重，首轮补发历史待办；服务里持有唤醒锁 |
| **涉及文件** | `link/RemoteWatcher.kt`、`service/MobileLinkService.kt` |
| **验收标准** | 退到后台并息屏 ≥10 分钟，桌面端交付新审核仍能收到通知 |
| **依赖** | 7 |

### 9. 手机端：提交改走 HTTP

| 属性 | 值 |
|---|---|
| **目标** | 待办详情页的通过/打回/回答改调 `/remote/requirement/:rid/answer`；`AppViewModel.answer` 不再走 `linkManager.sendAnswer` |
| **涉及文件** | `ui/AppViewModel.kt`、`ui/ItemScreen.kt`、`ui/AppRoot.kt` |
| **验收标准** | 点通过后桌面端状态变 done 且触发提交推送；连接名回落显示「桌面端」 |
| **依赖** | 8 |

## Complements

- **1 领域层**：`remotePendingTickets` + `answerRemote` 落地；`pendingMessages` / `mobilePending` / `mobileAnswer` 删除；
  `commitAndPushApproved` 原样迁进 `answerRemote`，通过即提交推送的口径没变。
- **2 传输层**：`mobile-link.js` 只剩设备注册 / 订阅 / 心跳；心跳在地址变化时立即发、未变化时每 60 秒重发一次，桌面端不再 pull。
- **3 协议层**：删掉 `reviewMessage` / `questionMessage` / `normalizeAnswer` / `newAnswerId` / `openMessage`。
- **4 远程面**：`requirementAnswer` 改调 `answerRemote`；`pending` / `wait` 改吃 `remotePendingTickets`，
  对手机仍返回 `messages` 字段（沿用旧命名，省一次客户端改造）。
- **5 桌面文案**：弹窗状态改为「已下发接入点 / 等待隧道地址」，去掉待办数量与上次推送。
- **6 手机 PushGo**：`PushGoSession` 只解析 `endpoint`；客户端心跳与答案发送删除；
  `sendAnswer` 保留为抛错桩，避免老代码静默走老路。ntfy 遗留通道整体删除（`NtfyClient` / `ConnectionSession` / v1 扫码）。
- **7 持久去重**：`StoreSnapshot.remoteNotified` + `syncRemoteTickets`（整体替换、按 messageId 继承本地答复状态）。
- **8 常驻**：`RemoteWatcher` 由 `MobileLinkService` 启动，与服务同生命周期；唤醒锁沿用既有实现。
- **9 提交走 HTTP**：`AppViewModel.answer` 按 `connId` 分流；远程条目经 `RemoteApi.answer` 提交，
  回执带提交短哈希；通知点击改为深链进详情。

验证：`npm run check` 0；远程面 26/26；web build 通过；`compileDebugKotlin` BUILD SUCCESSFUL。

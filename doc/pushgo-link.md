---
date: 2026-11-14
description: 手机端通信（PushGo Pull 原型）：设备注册、频道订阅、加密消息、Pull/ACK 与 resolved 心跳
---

> **2026-11-16 收窄**：这条通道现在**只下发接入点**（隧道地址 + 令牌），心跳 payload 为
> `{ endpoint: { v, url, token } }`。review / question / answer / pending / resolvedIds 全部停用，
> 审批与提问只走 `/remote` 长轮询（见 `remote-access.md`），由手机端前台服务常驻拉取。
> 桌面端也不再 pull —— 没有入站消息，ACK 一并去掉。下文关于业务消息的描述是收窄前的历史实现。

# 手机端通信 - PushGo Pull 原型

> 状态：**已实现并验证**。桌面端 `electron/services/mobile-link.js` 已从 ntfy 切换为 PushGo Pull 版；手机端同时支持 PushGo 与旧版 ntfy 连接信息。
> 这是原型：设备路由使用 `fcm + 随机 provider_token` 进入 Pull 队列，不依赖真实 FCM 送达；`send_status` 可能显示 `partially_failed`，但 Pull/ACK 可靠。正式版可切换 PushGo 私有 WSS。

## 连接信息（v2）

二维码里是一段 JSON：

```json
{
  "v": 2,
  "type": "pm-mobile",
  "provider": "pushgo",
  "gateway": "https://gateway.pushgo.cn",
  "channel": "<26 位频道 ID>",
  "password": "<32 位频道密码>"
}
```

- `gateway`：公共网关固定用 `https://gateway.pushgo.cn`（`.dev` 在部分网络里连 TCP 都超时，
  且两个域名不是同一套设备/频道数据，不做自动切换）；自建网关仍支持。
- `channel`：桌面端首次打开弹窗时由网关创建，26 位大写 Crockford Base32。
- `password`：桌面端生成，同时作为频道密码与端到端 AES-GCM 密钥。
- 重新生成频道后旧频道立即作废，手机端必须重新扫码。

## 设备与频道

1. 两端各注册一个设备：`POST /device/register`（`platform: "android"`）。
2. 原型路由：`POST /channel/device`（`channel_type: "fcm"` + 随机 `provider_token`），让消息进入 Pull 队列。
3. 桌面端创建频道并订阅：`POST /channel/subscribe`（`channel_name` + `password`）。
4. 手机端订阅已有频道：`POST /channel/subscribe`（`channel_id` + `password`）。
5. 设备 key、频道 ID、频道密码持久化在本地；桌面端存 `db.mobile`，手机端存连接记录。

## 消息收发

- **发送**：`POST /message`，字段：
  - `channel_id`、`password`
  - `title`（固定「项目管理台」）、`body`（空）
  - `ciphertext`：既有 AES-GCM 信封 `{"v":1,"n":"<iv>","d":"<密文+tag>"}` 的 JSON 字符串
  - `op_id`：**不要传**。网关自己生成并在响应里返回（`data.op_id` / `data.message_id`）；
    2026-11-18 起公共网关对客户端传入的 `op_id` 直接回 400 `op_id_not_allowed`。
  - `metadata`：`{from: "server"|"client", kind: "review"|"question"|"answer"|"keepalive"}`
- **接收**：`POST /v2/messages/pull`（`device_key`，按 `page_token` 翻页），逐条解 `payload.ciphertext`，处理后 `POST /v2/messages/ack`（`delivery_ids`）。
- **去重**：信封里的 `id` 是稳定消息 id；两端都按 id 去重，重复的 delivery 直接 ACK。
- **过滤**：频道广播；桌面端忽略 `from=server` 的自身消息，手机端忽略 `from=client` 的自身消息。
- **在线与完成**：
  - 双方每分钟发一条 `keepalive`；手机端在线由桌面端最近收到的手机消息判定（150 秒）。
  - 桌面端 `keepalive` 的 payload 带 `pending` 与 `resolvedIds`；手机端收到后把已处理的 review/question 从待办移除。
- **答案**：手机端 `answer` 走 `/remote/requirement/:rid/answer`（HTTP），不再发 PushGo 消息；桌面端落库后，下一次 keepalive 带 `resolvedIds`。
- **验收即提交**：手机端通过需求（`review → done`）时，桌面端在落库前按默认勾选口径自动提交并推送工作区改动：提交信息取 `completion.commitMessage`（缺省 `#序号 标题`），没有仓库 / 路径失效 / 无改动则跳过提交；提交失败答案不落库（手机端可重试），推送失败只记日志、不阻断验收。答案回执里的 `commit` 字段带 `committed` / `shortSha` / `pushError`。

## 加密

- KDF：PBKDF2-HMAC-SHA256，`password=频道密码`，`salt="pm-mobile-v1:"+channel`，100000 次，32 字节。
- 信封：AES-256-GCM，12 字节 IV、16 字节 tag，AAD 为频道 ID。
- `ciphertext` 字段只放信封 JSON；PushGo 的 `title/body` 不携带业务明文。
- 单条消息 32 KiB，长文本由桌面端按摘要截断。

## 限额与限制

- 公共网关官方文档未列每日消息上限；受每分钟频率限制（60 次/IP/分钟、1200 次/网关/分钟）。
- 本原型轮询节奏：15 秒/次 + 每分钟 keepalive；两台设备约 10 次/分钟，远低于限制。
- Pull 原型最多 15 秒延迟；不是即时推送。
- 假 FCM 路由会让 `send_status` 显示 `partially_failed`，但消息仍在 Pull 队列；不要用它替代正式 provider。
- 生产建议：改用 PushGo 私有 WSS（公共网关已开放 `wss://gateway.pushgo.dev/private/ws`，子协议 `pushgo-private.v1`），或自建 Gateway。

## 实现与验证

- 桌面端：`electron/services/mobile-protocol.js`（v2 连接信息 / 去空格校验）、`electron/services/mobile-link.js`（设备、频道、发送、翻页 Pull、ACK、resolved keepalive）、`electron/services/domain/mobile.js`（设置、频道/设备会话）、`web/src/components/MobileLinkModal.jsx`（网关 + 二维码 + 频道）。
- 手机端：`core/Protocol.kt`（v2 解析、频道 AAD）、`link/PushGoClient.kt`、`link/PushGoSession.kt`、`link/LinkManager.kt`（provider 分支）、连接详情 UI。
- 验证：
  - `npm run check`、`npm run build` 通过。
  - 真实公共网关：桌面端链路测试完成「审核发送 → 手机 Pull/ACK → 手机回答案 → 桌面 Pull/ACK → resolved 心跳」。
  - 模拟器 API 35：手机端扫码/粘贴 v2 连接信息，收到审核并显示；点通过后桌面端收到答案，手机端收到 resolved 并移除条目。
- 旧 ntfy 协议已删除（2026-11-16）：`NtfyClient` / `ConnectionSession` / v1 连接信息解析一并移除，扫到 v1 二维码会被拒绝。

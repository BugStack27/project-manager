---
date: 2026-11-14
description: 手机端通信（PushGo Pull 原型）：设备注册、频道订阅、加密消息、Pull/ACK 与 resolved 心跳
---

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
  "gateway": "https://gateway.pushgo.dev",
  "channel": "<26 位频道 ID>",
  "password": "<32 位频道密码>"
}
```

- `gateway`：公共 `https://gateway.pushgo.dev` / `https://gateway.pushgo.cn`，或自建网关。
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
  - `op_id`：稳定的消息 id（清理成 PushGo 允许的字符），用于重发幂等
  - `metadata`：`{from: "server"|"client", kind: "review"|"question"|"answer"|"keepalive"}`
- **接收**：`POST /v2/messages/pull`（`device_key`，按 `page_token` 翻页），逐条解 `payload.ciphertext`，处理后 `POST /v2/messages/ack`（`delivery_ids`）。
- **去重**：信封里的 `id` 是稳定消息 id；两端都按 id 去重，重复的 delivery 直接 ACK。
- **过滤**：频道广播；桌面端忽略 `from=server` 的自身消息，手机端忽略 `from=client` 的自身消息。
- **在线与完成**：
  - 双方每分钟发一条 `keepalive`；手机端在线由桌面端最近收到的手机消息判定（150 秒）。
  - 桌面端 `keepalive` 的 payload 带 `pending` 与 `resolvedIds`；手机端收到后把已处理的 review/question 从待办移除。
- **答案**：手机端 `answer` 使用固定答案 id 作为 `op_id`；桌面端 `mobileAnswer` 落库后，下一次 keepalive 带 `resolvedIds`。

## 加密

- KDF：PBKDF2-HMAC-SHA256，`password=频道密码`，`salt="pm-mobile-v1:"+channel`，100000 次，32 字节。
- 信封：AES-256-GCM，12 字节 IV、16 字节 tag，AAD 为频道 ID。
- `ciphertext` 字段只放信封 JSON；PushGo 的 `title/body` 不携带业务明文。
- 单条消息 32 KiB（比 ntfy 4 KiB 宽裕），但长文本仍由桌面端按摘要截断。

## 限额与限制

- 公共网关官方文档未列每日消息上限；受每分钟频率限制（60 次/IP/分钟、1200 次/网关/分钟）。
- 本原型轮询节奏：15 秒/次 + 每分钟 keepalive；两台设备约 10 次/分钟，远低于限制。
- Pull 原型最多 15 秒延迟；不是即时推送。
- 假 FCM 路由会让 `send_status` 显示 `partially_failed`，但消息仍在 Pull 队列；不要用它替代正式 provider。
- 生产建议：改用 PushGo 私有 WSS（公共网关已开放 `wss://gateway.pushgo.dev/private/ws`，子协议 `pushgo-private.v1`），或自建 Gateway。

## 实现与验证

- 桌面端：`electron/services/mobile-protocol.js`（v2 连接信息 / op_id / 去空格校验）、`electron/services/mobile-link.js`（设备、频道、发送、翻页 Pull、ACK、resolved keepalive）、`electron/services/domain/mobile.js`（设置、频道/设备会话）、`web/src/components/MobileLinkModal.jsx`（网关 + 二维码 + 频道）。
- 手机端：`core/Protocol.kt`（v2 解析、频道 AAD）、`link/PushGoClient.kt`、`link/PushGoSession.kt`、`link/LinkManager.kt`（provider 分支）、连接详情 UI。
- 验证：
  - `npm run check`、`npm run build` 通过。
  - 真实公共网关：桌面端链路测试完成「审核发送 → 手机 Pull/ACK → 手机回答案 → 桌面 Pull/ACK → resolved 心跳」。
  - 模拟器 API 35：手机端扫码/粘贴 v2 连接信息，收到审核并显示；点通过后桌面端收到答案，手机端收到 resolved 并移除条目。
- 旧 ntfy 协议保留在 `doc/mobile-link.md`，手机端仍可识别 v1 连接信息；本版桌面端不再生成 ntfy 二维码。

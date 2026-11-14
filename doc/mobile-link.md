---
date: 2026-11-14
description: 手机端通信（服务端）：ntfy + 对称加密的审核/提问推送与答案回写
---

# 手机端通信 - 任务规划

## 需求概述

用 ntfy 做桌面端（server）与手机端（client）之间的通信通道：桌面端随机生成 topic 与连接密钥，两端同时订阅同一个 topic，消息经对称加密后借 ntfy 转发；桌面端只在「等待审核」「等待回答」时推送消息，并给每条消息固定 id 便于重发与去重；手机端把审核结论与问题答案通过同一 topic 发回；双方每分钟发一次 keepAlive 报在线。

手机端（App / 页面）单独开发，本轮只做桌面端：会话与设置、加密协议、ntfy 收发、待推送消息生成、答案回写、桌面端展示（含二维码，供手机端后续扫码接入）。

## 需求澄清记录

| 问题 | 结论 |
|---|---|
| 手机端页面由谁承载 | 手机端单独开发，本轮只写服务端逻辑，不做手机页面、不起局域网静态页 |
| 二维码怎么生成 | 桌面端生成，新增 `qrcode-generator` 依赖（纯 JS、无传递依赖） |

## Requirements

### 1. 协议与加密模块

| 属性 | 值 |
|------|-----|
| **目标** | 定义两端共用的会话生成、密钥派生（PBKDF2-HMAC-SHA256）、AES-256-GCM 信封、消息类型与幂等 id 规则；纯 Node 模块，不依赖 electron，便于手机端按同一份规格实现 |
| **涉及文件** | `electron/services/mobile-protocol.js` |
| **验收标准** | 同 key + topic 加解密互逆；topic 不符或密文被篡改时解密失败；`review:<rid>:<completedAt>`、`question:<qid>` 两条固定 id 规则可单独验证；生成 topic/key 只含 ntfy 允许字符 |
| **依赖** | — |

### 2. 领域层会话、设置与待推送消息

| 属性 | 值 |
|------|-----|
| **目标** | 在 `db.settings.mobile` 存开关 / ntfy 地址 / 可选令牌；在 `db.mobile` 存会话；提供会话生成与轮换、待推送的审核与提问消息清单、手机答案回写（审核结论落到 `setRequirementStatus`，问题答案落到 `answerRequirement`），并做答案幂等去重 |
| **涉及文件** | `electron/services/domain/mobile.js`、`electron/services/domain/index.js` |
| **验收标准** | 首读自动生成会话且重启后不变；轮换后 topic/key 都变；`mobilePending` 只列出 `status=review` 的交付与 `doing` 下未过期的提问；重复 answer id 第二次不写库；审核 approve / feedback / reject 分别落到 `done` / `doing` / `rejected` |
| **依赖** | 1 |

### 3. 二维码与 ntfy 传输

| 属性 | 值 |
|------|-----|
| **目标** | `qr.js` 把连接信息渲染成 SVG；`mobile-link.js` 负责订阅 ntfy `/json` 流、发布加密消息、待处理消息按固定 id 重发、每分钟 keepAlive、上下线判定与断线重连；`main.js` 挂启动 / 退出与 dispatch 入口 |
| **涉及文件** | `electron/services/qr.js`、`electron/services/mobile-link.js`、`electron/main.js`、`package.json` |
| **验收标准** | npm run check 通过；连真实 ntfy 后，另一客户端在 topic 上收到的消息可解出审核 / 提问内容；同一消息 60 秒后重发仍为同一 id；收到的 answer 能改变需求状态或写入回答；关掉开关后不再发布；客户端 keepAlive 能让状态变为在线、超时后回到离线 |
| **依赖** | 1、2 |

### 4. 桌面端设置弹窗

| 属性 | 值 |
|------|-----|
| **目标** | 「设置与数据 → 通知与集成 → 手机端通信」弹窗：开关、ntfy 地址与可选令牌、连接二维码、topic 与密钥（可复制 / 可显示）、手机在线状态与通道状态、轮换会话（二次确认） |
| **涉及文件** | `web/src/components/MobileLinkModal.jsx`、`web/src/api.js`、`web/src/components/AppModals.jsx`、`web/src/App.jsx`、`web/src/Sidebar.jsx`、`web/src/styles/modal.css` |
| **验收标准** | vite 构建通过；弹窗能读到并保存开关与地址；二维码随轮换刷新；手机在线 / 离线、SSE 状态与最近一次收发时间可见；轮换有二次确认且提示手机端需要重新扫码 |
| **依赖** | 2、3 |

### 5. 文档与检查清单

| 属性 | 值 |
|------|-----|
| **目标** | 写清协议规格（手机端照着实现即可对接）、安全边界与已知限制；README 增加功能入口与文档链接；`npm run check` 覆盖新增文件 |
| **涉及文件** | `doc/mobile-link.md`、`README.md`、`package.json` |
| **验收标准** | 文档里的字段、id 规则、KDF 参数与代码一致；README 链接可点；check 脚本包含全部新增 electron 模块 |
| **依赖** | 1~4 |

## 协议规格（手机端对接用）

手机端是独立实现，下面这份规格就是全部对接依据；桌面端实现见 `electron/services/mobile-protocol.js`（协议）与 `electron/services/mobile-link.js`（传输）。

### 连接信息

二维码里是一段 JSON，扫码后取三件套：

```json
{"v":1,"type":"pm-mobile","server":"https://ntfy.sh","topic":"pm-xxxxxxxxxxxxxxxx","key":"<32 位>"}
```

- `topic`：`pm-` + 16 位，字符集 `abcdefghijkmnpqrstuvwxyz23456789`（去掉 l / o / 0 / 1 防手抄看错），正则 `^pm-[a-z2-9]{16}$`。
- `key`：同一字符集 32 位，正则 `^[a-z2-9]{32}$`。
- 桌面端「重新生成会话」后旧 topic / 密钥立刻作废，手机端必须重新扫码。

### 加密

- 派生：`PBKDF2-HMAC-SHA256(password=key, salt="pm-mobile-v1:"+topic, iterations=100000, dkLen=32)`。
- 加密：AES-256-GCM，12 字节随机 IV、16 字节 tag，AAD 为 topic 原文（UTF-8）；topic 不符或密文被改都会解密失败。
- 信封就是发布到 ntfy 的 body：

```json
{"v":1,"n":"<IV base64>","d":"<密文 base64，末 16 字节为 tag>"}
```

- 明文是 UTF-8 JSON：`{v:1, type, from, id, at, payload}`；`from` 只能是 `server` / `client`，`v` 目前为 1。

### 传输

- 发布：`POST {server}/{topic}`，`Content-Type: text/plain; charset=utf-8`，`X-Ttl: 600`，`X-Priority: 3`；自建 ntfy 开了鉴权时加 `Authorization: Bearer <token>`。
- 订阅：`GET {server}/{topic}/json?since=10m`，NDJSON 一行一个事件，只处理 `event === "message"` 的行。
- 解不开或不是 `{` 开头的消息一律静默跳过：同一个 topic 可能被别的工具复用。
- 断线重连：2 秒起指数退避到 30 秒；重连时 `since=10m` 会重放旧消息，靠消息 `id` 去重。

### 消息类型与固定 id

| type | 方向 | 触发 | id |
|---|---|---|---|
| `review` | server → client | 需求进入待审核 | `review:<requirementId>:<completedAt>` |
| `question` | server → client | 进行中的需求有待回答提问 | `question:<questionId>` |
| `answer` | client → server | 审核结论 / 提问答案 | `answer:<时间戳 base36><随机 10 位>`，重发必须复用 |
| `keepalive` | 双向 | 每分钟一次 | `keepalive:<from>:<毫秒时间戳>` |

payload 字段：

- `review`：`requirementId, seq, title, projectId, projectName, agent, agentName, note, completedAt`
- `question`：`requirementId, seq, title, projectId, projectName, questionId, text, options[], default, expiresAt`
- `answer`：`requirementId, questionId?, decision, text`
- `keepalive`：`online: true`；服务端额外带 `pending`（当前待推送条数）

### 手机端回传答案

```json
{"v":1,"type":"answer","from":"client","id":"answer:...","at":"<ISO>","payload":{"requirementId":"r_xxx","questionId":"q_xxx","decision":"answer","text":"..."}}
```

| decision | 条件 | 桌面端落点 |
|---|---|---|
| `answer` | 必须带合法 `questionId` 与非空 `text` | `answerRequirement` |
| `approve` | — | 需求状态 → `done` |
| `feedback` | `text` 必填 | 需求状态 → `doing`，`text` 记为打回意见 |
| `reject` | — | 需求状态 → `rejected` |

- `text` 上限 2000 字符；`id` 正则 `^answer:[A-Za-z0-9_-]{6,64}$`，同一条答案重发必须用同一个 id。
- 桌面端两层去重：传输层按消息 id 记最近 500 条，领域层按答案 id 再记 500 条；重复不会写两遍。
- 只有真正落库成功的答案才记为已处理；目标需求已被删除、或状态不允许该操作时返回「未生效」，不抛错，手机端重发还能再试。

### 推送节奏与在线判定

- 待推送消息内容不变时每 60 秒重发一次（同一 id）；内容变了立即重发；被处理掉就停止重发。
- 发布 TTL 600 秒：手机端晚几分钟上线也能补收。
- 双方每分钟发一次 `keepalive`；桌面端以手机最近一条消息（任意类型）判定，超过 150 秒没有即离线。
- 只有「等待审核」「等待回答」才会产生内容推送，其余时间仅 keepalive。

### 安全边界与已知限制

- ntfy 是第三方中转：内容对 ntfy 不可读，但 topic、发送时间、消息大小与频率对 ntfy 可见。
- 连接密钥「持有即授权」：二维码截图等于把通道交给对方，丢了就重新生成会话。
- PBKDF2 只是口令派生，不是 PAKE：能延缓离线爆破，但挡不住拿到二维码的人冒充手机端。
- 访问令牌明文存在本机数据文件里；事件日志只记录「是否变更」，不留原文。
- 单条消息受 ntfy 4KB 限制：桌面端组装消息时按字符截断长文本（标题 100、完成说明 500、提问正文 300、单个候选 40、默认回答 100，超出部分以 `…` 结尾），手机端看到的是摘要，全文仍在桌面端；发布前还会再量一次信封大小，超限直接报错而不是静默丢消息。

## Complements

### 1. 协议与加密模块 ✅

- 变更文件：`electron/services/mobile-protocol.js`（新增）
- 审查结果：通过；按审查意见补了 4KB 正文裁剪（标题 100 / 完成说明 500 / 提问正文 300 / 候选 40 / 默认回答 100），避免长中文撑爆 ntfy 上限。
- 完成时间：2026-11-14

### 2. 领域层会话、设置与待推送消息 ✅

- 变更文件：`electron/services/domain/mobile.js`（新增）、`electron/services/domain/index.js`
- 审查结果：通过；答案去重改为「落库成功才记为已处理」，没生效的答案不会被永久吞掉。
- 完成时间：2026-11-14

### 3. 二维码与 ntfy 传输 ✅

- 变更文件：`electron/services/qr.js`、`electron/services/mobile-link.js`、`electron/main.js`、`package.json`、`package-lock.json`（新增 `qrcode-generator`）
- 审查结果：通过；配置变更先断旧订阅再重连、入站消息串行处理、发布前校验信封大小；真实 ntfy.sh 端到端通过。
- 完成时间：2026-11-14

### 4. 桌面端设置弹窗 ✅

- 变更文件：`web/src/components/MobileLinkModal.jsx`、`web/src/api.js`、`web/src/components/AppModals.jsx`、`web/src/App.jsx`、`web/src/Sidebar.jsx`、`web/src/styles/modal.css`、`web/src/lib/events-view.js`
- 审查结果：通过；事件流补了「手机端通道已开启 / 关闭」文案，不再误显示为「通知设置已更新」。
- 完成时间：2026-11-14

### 5. 文档与检查清单 ✅

- 变更文件：`doc/mobile-link.md`、`README.md`
- 审查结果：通过；4KB 说明按实现改为「截断上限 + 发布前校验」，协议规格与代码逐项核对一致。
- 完成时间：2026-11-14

### 验证记录

- `npm run check` 通过（新增 4 个 electron 模块已纳入）
- `npm run build` 通过
- 真实 ntfy.sh 端到端：提问 / 审核推送、固定 id 重发、答案回写、重复答案去重、审批通过、双向 keepAlive、在线判定全部通过
- 弹窗用临时 vite 页面在浏览器里看过布局（临时页面已删除）
- 未做：Electron 安装态窗口内的点击验证；手机端本身另行开发

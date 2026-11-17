---
date: 2026-11-16
description: 远程访问面（/remote/*）：公网隧道后的只读接口与令牌门禁，供手机端取项目、需求、diff 与命令输出
---

# 远程访问面 — /remote/*

> 状态：**接口与门禁已实现**（`electron/mcp-http.js` + `electron/services/domain/remote.js`）。
> 隧道进程托管与地址广播（PushGo keepalive 下发 endpoint）尚未实现，见文末「待办」。

## 为什么单独开一套接口

本地 MCP 服务（`127.0.0.1:7318`）整条链路没有鉴权 —— 本机形态下这没问题：能连上回环地址的人本来就能用 IPC。
一旦经隧道暴露到公网，域名本身就是能力：拿到 URL 就能读全量数据、提需求，还能通过 `/complete` 触发
`git commit + push`。所以远程面不复用 MCP 工具表，而是单独在 `/remote/` 下收口。

第二个理由更硬：`/claim`、`/next`、`/ask`、`/complete` 都是**长轮询**（`/next` 等 5 分钟、`/ask` 等 1 小时、
`/complete` 等 2 小时）。公网边缘 100 秒就断，放出去只会在服务端留下挂死的等待器，客户端拿到的是 524。
这几个端点只服务本机 agent，不对外。

## 门禁

| 层 | 规则 | 位置 |
|---|---|---|
| 来源判定 | 回环地址（127.0.0.1 / ::1）才是「本机」；局域网与隧道来源一律按远程处理 | `mcp-http.js` `isLoopback()` |
| 路径白名单 | 非本机来源只放行 `/remote/*`，其余一律 `403 remote_forbidden` | `mcp-http.js` 请求入口 |
| 令牌 | 除 `/remote/hello` 外都要 `X-PM-Token` 头（或 `?token=`） | `remoteAuth` |
| 开关 | 只看 **手机端通信**（`settings.mobile.enabled`）：关掉时连令牌都不认 | `remote.js` |

服务绑 `0.0.0.0:7318` 而不是回环：手机在同一局域网要能直连。代价是端口对局域网可见，
但非回环来源碰不到 `/mcp`、`/claim`、`/next`、`/complete`，只有 `/remote/hello` 是不需要令牌的。

**开关只有一个**：手机端通信。开着，远程面可用、隧道自动起、地址随心跳下发；关着，整条链路关闭。
不再有独立的「远程访问」或「隧道」开关 —— 两个开关必然会被调成互相矛盾的状态，而它们真正的含义
永远是同一件事。MCP 页签里因此没有任何远程相关配置。

- 令牌：24 字节随机 → base64url，32 字符；存 `db.settings.remote.token`，首次读取时自动生成。
- 比较用 `crypto.timingSafeEqual`，长度不等直接失败。
- 令牌与隧道地址解耦：换隧道、换地址都不用重发令牌；怀疑泄漏用 `remoteRotateToken` 单独轮换。
- 本机调用不受影响：不带代理头就不进这一支，老路由（`/mcp`、`/claim`、`/prompt/*`）照旧。

### 为什么说「这层只给手机」

AI agent 走的是本机 MCP（`/mcp` 那 4 个工具）与 `/claim`、`/next`、`/complete`，**不需要也不该**
经过远程面：令牌只随配对信息发到手机，AI 侧没有任何合法路径拿到它。

需要说清楚的是强度：这是**防误用**而不是防恶意。任何在你这台机器上有 shell 权限的 agent 都能直接读
`db` 文件里的令牌，也能直接调本机 IPC —— 远程面拦不住它，也没打算拦。它的真正作用是「公网扫描器
与误配的客户端进不来」，以及「AI 不会因为多一个 URL 就误用长轮询和 commit+push」。


## 公网隧道（cloudflared）

`electron/services/tunnel.js` 托管一个 quick tunnel，把 `127.0.0.1:7318` 挂到
`https://xxx.trycloudflare.com` 上，只产地址、不管谁来用。

| 关注点 | 处理 |
|---|---|
| 地址解析 | 扫 cloudflared 的 stdout/stderr，取 `*.trycloudflare.com` 的第一个匹配 |
| 链路存活 | 每 30 秒打一次 `<公网地址>/remote/hello`，连续 2 次失败即判定隧道已死 |
| 进程退出 | 退避重开（1s → 2s → 5s → 10s → 30s → 60s），地址会变，重开后重新广播 |
| 缺 cloudflared | 安装包自带一份（`resources/cloudflared`，发版时由 `npm run prep:cloudflared` 准备）；没有则用 `<userData>/bin` 下载过的、PATH 里的，最后才自动下载（约 50MB），不询问 |
| 下载通道 | Electron `net.fetch`（系统代理 + 系统证书）→ https + 系统证书库（兜代理中间人证书）→ Node `fetch`；全失败等 2 秒重试首选一次 |
| 下载失败 | `cloudflared_download_failed`，错误里逐通道列出真实原因（`ERR_CERT_*` / `UNABLE_TO_VERIFY_LEAF_SIGNATURE` / `ECONNRESET`…）；手机端通信弹窗给一个「重试」按钮 |
| 自定义 | `PM_CLOUDFLARED` 指定可执行文件，`PM_CLOUDFLARED_URL` 换下载源 |
| MCP 没起来 | 直接拒绝启动，不给一个连不通的空壳地址 |
| 退出清理 | `shutdown()` 里先停隧道再停 MCP |

临时隧道没有 SLA（断连超过 5 分钟会被回收、地址每次重建都变），所以「地址会变」是常态而不是异常：
界面上重连中只作提示，不做报错。

## 地址怎么到手机上

1. 隧道拿到（或换到）新地址 → `mobile-link.forceKeepalive()` 立刻推一轮，不等下一个 60 秒心跳窗口。
2. 心跳的 `payload` 里带 `endpoint: { v, url, token }`（复用 `keepaliveMessage` 的 `extra`，**不新增消息类型**，
   老客户端读到不认识的字段只会忽略）。
3. 手机端 `PushGoSession` 收到心跳后对比本地 `RemoteConfig`，不同就落盘 —— 手机端**没有任何配置界面**，
   配对之后地址与令牌就自动到位，地址变了也自动跟上。
4. 远程访问关着时 `endpoint` 字段整个不出现（给一个必然 401 的地址比不给更糟），手机会保留上一次的配置。

桌面端启动时按 `settings.mobile.enabled` 决定要不要接隧道；开关一变（`saveMobileSettings`）立刻对齐，
首次可能要先下 cloudflared，这部分在后台做，不阻塞界面。

## 接口

全部同步短请求，没有一个超过毫秒级（`gitDiff` 受仓库大小影响，仍在秒级内）。

| 方法 | 路径 | 领域方法 | 说明 |
|---|---|---|---|
| GET | `/remote/hello` | — | 健康检查，回 `{name, version, remote:true}`，**不需要令牌**、不含业务数据 |
| GET | `/remote/projects?includeArchived=1` | `projects` | 项目列表 |
| GET | `/remote/project/:id/requirements?status=todo,doing&pending=1` | `allRequirements` | 需求列表；不传 `status` 时不含候选池 |
| GET | `/remote/project/:id/changes` | `gitChanges` | 工作区改动清单（未提交） |
| GET | `/remote/project/:id/diff?path=src/a.js&untracked=1` | `gitDiff` | 单文件 diff 或新文件内容 |
| GET | `/remote/project/:id/commits?limit=30&skip=0` | `gitCommits` | 提交历史 |
| GET | `/remote/project/:id/commit-diff?sha=abc1234&path=src/a.js` | `gitCommitDiff` | 某次提交里单个文件的 diff |
| GET | `/remote/project/:id/commands` | `commands` | 该项目的命令清单 |
| GET | `/remote/command/:cid/runs` | `commandRuns` | 最近若干次运行 |
| GET | `/remote/command/:cid/logs?runId=run_x` | `logs` | 命令输出（不传 runId 取最近一次） |
| POST | `/remote/requirement/:rid/status` | `setRequirementStatus` | 体 `{status, note?}`，**只接受 `todo` 与 `rejected`** |
| POST | `/remote/requirement/:rid/answer` | `mobileAnswer` | 体 `{decision, text?, questionId?}`，回复提问与审核 |
| GET | `/remote/pending` | `mobilePending` | 待办快照（待审核 + 待回答） |
| GET | `/remote/wait?key=&wait=20` | `mobilePending` | 长轮询，有变化立即返回，最多挂 30 秒 |

响应统一 `{ ok: true, ...data }`；失败 `{ ok: false, code, message }`，状态码沿用领域层抛出的 `status`。

### 答复接口

`decision` 四种，语义与 `mobile-protocol` 的答案消息完全一致：

| decision | 含义 | 附加字段 |
|---|---|---|
| `answer` | 回答 agent 的提问 | `questionId`、`text` 必填 |
| `approve` | 验收通过 | `text` 可选 |
| `feedback` | 打回让 agent 改 | `text` 必填 |
| `reject` | 拒绝 | `text` 可选 |

落地直接调 `mobileAnswer`，传一条按协议搭好的答案消息 —— 所以「通过即提交并推送」
（`commitAndPushApproved`）、幂等、提交失败不落库这些口径与 PushGo 通道完全一致，
不会因为换了传输方式就对不上。答案 id 由服务端生成，形状满足 `ANSWER_ID_RE`。

### 为什么用长轮询而不是 SSE / WebSocket

公网边缘对**单条 HTTP 请求**限 100 秒，SSE 与 WebSocket 都会被周期性掐断；断线窗口里丢掉的
通知还得另做补偿逻辑。长轮询每轮都是一条普通请求，穿 Cloudflare、Tailscale、nginx 都安全：
没变化就挂 20 秒再回，客户端拿到响应立刻发下一轮，体感与推送一致，且天然自带重连。

`key` 是待办指纹（消息 id 集合的 sha1 前 12 位）。客户端把上一轮的 `key` 回传，相同就继续等，
不同就说明有新东西——服务端不必比对内容，客户端也不必自己算 diff。


### 为什么只放开 todo / rejected

- `todo`：候选池 → 未开始，就是手机上的「采纳」。
- `rejected`：拒绝，含把待审核的交付打回。
- **不放 `done`**：验收统一走 `mobileAnswer`（PushGo 通道与 `/remote/requirement/:rid/answer`
  都指向它），它会先提交并推送工作区改动再落库。从远程面直接把状态改成 `done`，改动会停在未提交状态。
- 不放 `doing` / `candidate` / `review`：前两个会破坏认领与项目锁，`review` 本来就只能由
  `/complete` 进入（`requirements.js` 有 `use_complete_api` 拦着）。

## 调用示例

```bash
BASE=https://xxxx.trycloudflare.com
TOKEN=<32 位令牌>

curl -s $BASE/remote/hello
curl -s -H "X-PM-Token: $TOKEN" "$BASE/remote/projects"
curl -s -H "X-PM-Token: $TOKEN" "$BASE/remote/project/p_abc/requirements?pending=1"
curl -s -H "X-PM-Token: $TOKEN" "$BASE/remote/project/p_abc/diff?path=src/main.js"
curl -s -X POST -H "X-PM-Token: $TOKEN" -H "Content-Type: application/json" \
  -d '{"status":"todo"}' "$BASE/remote/requirement/r_abc/status"
```

## 领域方法（经 IPC 即可用）

| 方法 | 作用 |
|---|---|
| `remoteInfo` | 读 `{token, createdAt, rotatedAt}` |
| `remoteRotateToken()` | 换令牌，旧令牌立即失效，手机端下一轮心跳自动更新 |

## 待办与通知（2026-11-16 起）

远程面是**唯一**的待办来源。PushGo 只负责把接入点送到手机，不再承载任何业务消息。

- 手机端 `RemoteWatcher` 常驻 `MobileLinkService`（前台服务 + 唤醒锁），循环 `/remote/wait`；
  拿到待办后先写本地库（`connId = "remote"`）再弹通知，点通知直接进详情。
- 已提醒的待办 id 落盘在 `StoreSnapshot.remoteNotified`：进程被杀后重开，积压的旧待办补一次通知，
  不会每轮重放，也不会因为重启而漏掉。
- 退到后台、息屏都能收到，因为真正的拉取发生在前台服务里；界面里的长轮询只用于刷新列表。
- 系统强杀（force-stop）后 Android 不允许自拉起，重新打开即按当前待办补发。

剩下的是体验问题，不是功能缺口：
1. 手机端「项目」页没有下拉刷新，靠长轮询与进入页面时拉取。
2. 隧道重连期间手机列表会报连接失败，恢复后由长轮询自动接上。
3. 老安装包（不带内置 cloudflared）首次下载失败时，弹窗给原因与「重试」，不会自动换镜像源。




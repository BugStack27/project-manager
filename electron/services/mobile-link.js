'use strict';

const eventLog = require('./event-log');
const protocol = require('./mobile-protocol');
const qr = require('./qr');

/**
 * 手机端通道的传输层：订阅 ntfy、发布加密消息、按固定 id 重发、双向 keepAlive。
 *
 * 设计取舍：
 * - 进程内状态，应用启动时 start()、退出时 stop()；关掉开关即断开订阅，不偷偷跑。
 * - 待推送消息由领域层算出（mobilePending），这里只负责发送节奏与去重：
 *   内容没变时每 KEEPALIVE_MS 重发一次，内容变了立刻重发；消息消失就停止重发。
 * - 收到的答案先按消息 id 去重（reconnect 的 since 窗口会重放旧消息），再交给领域层落库；
 *   领域层内部还有一层答案 id 去重，两层都幂等。
 * - ntfy 公共服务的消息上限 4KB：审核 note 与提问正文都有各自上限，封出来远小于它。
 * - 订阅地址用 /json（一行一个 JSON 对象），不用 SSE：解析更简单，事件类型同样齐全。
 */

const RECONNECT_MIN_MS = 2000;
const RECONNECT_MAX_MS = 30000;
/** 重连时回看 10 分钟：既够覆盖一次断线，又不会把很久以前的答案翻出来 */
const SUBSCRIBE_SINCE = '10m';
/** ntfy 缓存时长：手机端晚几分钟上线也能收到；过期的待办本来就有下一次重发 */
const PUBLISH_TTL_SECONDS = 600;
const PUBLISH_TIMEOUT_MS = 10000;
/** ntfy 公共实例的正文上限是 4096 字节，留一点给服务端自己的统计字段 */
const MAX_BODY_BYTES = 4000;
const SEEN_MAX = 500;

let started = false;
let dispatchRef = null;
let logRef = () => {};

let config = { enabled: false, ntfyUrl: '', token: '', topic: '', key: '' };
let subscription = null;
let tickTimer = null;
let reconnectTimer = null;
let reconnectDelay = RECONNECT_MIN_MS;
let ticking = false;
let rerun = false;
let unsubscribe = null;

/** id → { hash, at }：内容指纹没变就按节奏重发，变了立刻重发 */
const sent = new Map();
/** 已经处理过的入站消息 id */
const seen = new Map();

const state = {
  startedAt: null,
  connected: false,
  error: null,
  errorAt: null,
  lastInboundAt: null,
  lastPublishAt: null,
  clientLastSeenAt: null,
  lastAnswerAt: null,
  lastAnswer: null,
  pending: 0,
  published: 0
};

function baseUrl() {
  return String(config.ntfyUrl || '').replace(/\/+$/, '');
}

function authHeaders() {
  return config.token ? { Authorization: 'Bearer ' + config.token } : {};
}

function rememberError(e) {
  const message = (e && e.message) || String(e);
  if (state.error === message) return;
  state.error = message;
  state.errorAt = new Date().toISOString();
  logRef('[mobile] ' + message);
}

function pruneSeen() {
  while (seen.size > SEEN_MAX) seen.delete(seen.keys().next().value);
}

async function readConfig() {
  const res = await dispatchRef('mobileSessionInfo');
  if (!res || !res.ok) throw new Error((res && res.message) || '读取手机端设置失败');
  const settings = (res.data && res.data.settings) || {};
  const session = (res.data && res.data.session) || {};
  return {
    enabled: settings.enabled === true,
    ntfyUrl: String(settings.ntfyUrl || ''),
    token: String(settings.token || ''),
    topic: String(session.topic || ''),
    key: String(session.key || '')
  };
}

function sameConfig(a, b) {
  return (
    a.enabled === b.enabled &&
    a.ntfyUrl === b.ntfyUrl &&
    a.token === b.token &&
    a.topic === b.topic &&
    a.key === b.key
  );
}

async function publish(message) {
  const url = baseUrl() + '/' + config.topic;
  const body = protocol.sealMessage(config.topic, config.key, message);
  // ntfy 单条消息上限 4KB：宁可在这里报错，也不要等服务端把发布整个拒掉
  if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) {
    throw new Error('消息过长（' + message.id + '），已超出 ntfy 4KB 限制');
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Ttl': String(PUBLISH_TTL_SECONDS),
      'X-Priority': '3',
      ...authHeaders()
    },
    body,
    signal: AbortSignal.timeout(PUBLISH_TIMEOUT_MS)
  });
  if (!res.ok) {
    let text = '';
    try {
      text = await res.text();
    } catch (_) {}
    throw new Error('ntfy 发布失败：HTTP ' + res.status + (text ? ' ' + text.slice(0, 120) : ''));
  }
}

function stopSubscription() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (subscription) {
    try {
      subscription.controller.abort();
    } catch (_) {}
    subscription = null;
  }
  state.connected = false;
}

function scheduleReconnect() {
  if (!started || !config.enabled || reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    subscribe();
  }, reconnectDelay);
  if (reconnectTimer.unref) reconnectTimer.unref();
  reconnectDelay = Math.min(RECONNECT_MAX_MS, reconnectDelay * 2);
}

async function handleInbound(text) {
  let ev;
  try {
    ev = JSON.parse(text);
  } catch (_) {
    return;
  }
  // /json 流里除了 message 还有 open / keepalive 事件，后两者交给连接状态即可
  if (!ev || ev.event !== 'message' || typeof ev.message !== 'string') return;
  if (ev.topic && ev.topic !== config.topic) return;
  // 同一个 topic 可能被别的工具复用：只有长得像信封的才尝试解密，解不开就静默跳过
  if (ev.message.trim().charAt(0) !== '{') return;

  let message;
  try {
    message = protocol.openMessage(config.topic, config.key, ev.message);
  } catch (_) {
    return;
  }
  if (message.from !== 'client') return;

  const at = new Date().toISOString();
  state.lastInboundAt = at;
  state.clientLastSeenAt = at;
  if (message.type !== 'answer') return;
  if (seen.has(message.id)) return;

  try {
    const res = await dispatchRef('mobileAnswer', { message });
    // 处理失败（落库抛错 / 需求已处理掉）不记入已见：同一 id 重发或状态变化后还能再试
    if (res && res.ok) {
      seen.set(message.id, Date.now());
      pruneSeen();
      state.lastAnswerAt = new Date().toISOString();
      state.lastAnswer = {
        id: message.id,
        applied: !!(res.data && res.data.applied),
        duplicate: !!(res.data && res.data.duplicate),
        reason: (res.data && res.data.reason) || null
      };
      if (!state.lastAnswer.applied && !state.lastAnswer.duplicate) {
        logRef('[mobile] 答案未生效：' + (state.lastAnswer.reason || 'unknown'));
      }
    } else {
      state.lastAnswer = { id: message.id, applied: false, error: (res && res.message) || '处理失败' };
    }
  } catch (e) {
    rememberError(e);
  }
}

async function subscribe() {
  if (!started || !config.enabled) return;
  stopSubscription();

  const controller = new AbortController();
  const mine = { controller, at: Date.now() };
  subscription = mine;
  const url = baseUrl() + '/' + config.topic + '/json?since=' + SUBSCRIBE_SINCE;

  let res;
  try {
    res = await fetch(url, {
      headers: { Accept: 'application/json', ...authHeaders() },
      signal: controller.signal
    });
  } catch (e) {
    if (subscription === mine) {
      subscription = null;
      if (!controller.signal.aborted) rememberError(e);
      scheduleReconnect();
    }
    return;
  }

  if (!res.ok || !res.body) {
    let text = '';
    try {
      text = await res.text();
    } catch (_) {}
    if (subscription === mine) {
      subscription = null;
      rememberError(new Error('ntfy 订阅失败：HTTP ' + res.status + (text ? ' ' + text.slice(0, 120) : '')));
      scheduleReconnect();
    }
    return;
  }

  state.connected = true;
  state.error = null;
  state.errorAt = null;
  reconnectDelay = RECONNECT_MIN_MS;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (line) await handleInbound(line);
      }
    }
  } catch (e) {
    if (!controller.signal.aborted) rememberError(e);
  } finally {
    if (subscription === mine) {
      subscription = null;
      state.connected = false;
      scheduleReconnect();
    }
  }
}

async function tick() {
  if (!started) return;
  if (ticking) {
    rerun = true;
    return;
  }
  ticking = true;
  try {
    const next = await readConfig();
    if (!sameConfig(next, config)) {
      config = next;
      sent.clear();
      // 地址 / 令牌 / 会话变了：先断旧流（含挂着的重连），再按新配置连
      stopSubscription();
      if (config.enabled) {
        subscribe();
      } else {
        state.pending = 0;
      }
    }
    if (!config.enabled) {
      state.pending = 0;
      return;
    }
    if (!subscription && !reconnectTimer) subscribe();

    const res = await dispatchRef('mobilePending');
    if (!res || !res.ok) throw new Error((res && res.message) || '读取待推送消息失败');
    const list = (res.data && res.data.messages) || [];
    state.pending = list.length;

    const now = Date.now();
    const alive = new Set();
    for (const message of list) {
      alive.add(message.id);
      const hash = JSON.stringify(message);
      const prev = sent.get(message.id);
      if (!prev || prev.hash !== hash || now - prev.at >= protocol.KEEPALIVE_MS) {
        await publish(message);
        sent.set(message.id, { hash, at: Date.now() });
        state.published += 1;
      }
    }
    // 已经有人处理掉的待办：不再重发，也不留在指纹表里
    for (const id of Array.from(sent.keys())) {
      if (!alive.has(id)) sent.delete(id);
    }

    await publish(protocol.keepaliveMessage('server', null, { pending: list.length }));
    state.lastPublishAt = new Date().toISOString();
  } catch (e) {
    rememberError(e);
  } finally {
    ticking = false;
    if (rerun) {
      rerun = false;
      tick();
    }
  }
}

function statusView(session) {
  const clientLastSeenAt = state.clientLastSeenAt;
  const onlineAge = clientLastSeenAt ? Date.now() - Date.parse(clientLastSeenAt) : Infinity;
  return {
    running: started,
    connected: state.connected,
    clientOnline: onlineAge < protocol.CLIENT_ONLINE_MS,
    clientLastSeenAt,
    lastInboundAt: state.lastInboundAt,
    lastPublishAt: state.lastPublishAt,
    lastAnswer: state.lastAnswer,
    lastAnswerAt: state.lastAnswerAt,
    pending: state.pending,
    published: state.published,
    error: state.error,
    errorAt: state.errorAt,
    topic: config.topic || (session && session.topic) || '',
    startedAt: state.startedAt
  };
}

/** 弹窗用：设置 + 会话 + 二维码 + 实时状态，一次取全 */
async function info() {
  const res = await dispatchRef('mobileSessionInfo');
  if (!res || !res.ok) throw new Error((res && res.message) || '读取手机端设置失败');
  const settings = res.data.settings;
  const session = res.data.session;
  const connect = protocol.connectPayload({
    server: settings.ntfyUrl,
    topic: session.topic,
    key: session.key
  });
  return { settings, session, connect, qrSvg: qr.svg(connect), status: statusView(session) };
}

/** 轮换会话：旧 topic / 密钥立刻作废，重订阅后手机端必须重新扫码 */
async function rotate() {
  const res = await dispatchRef('mobileRotateSession');
  if (!res || !res.ok) throw new Error((res && res.message) || '轮换会话失败');
  sent.clear();
  seen.clear();
  await tick();
  return info();
}

function start(deps) {
  if (started) return;
  dispatchRef = deps && deps.dispatch;
  logRef = (deps && deps.log) || console.log;
  if (typeof dispatchRef !== 'function') throw new Error('mobile-link 缺少 dispatch');
  started = true;
  state.startedAt = new Date().toISOString();

  // 需求状态一变就冲一轮，让手机端尽快收到；settings.changed 用于开关 / 地址 / 令牌即时生效
  unsubscribe = eventLog.subscribe((ev) => {
    if (!ev || typeof ev.type !== 'string') return;
    if (ev.type.indexOf('requirement.') === 0 || ev.type === 'settings.changed') tick();
  });

  tickTimer = setInterval(tick, protocol.KEEPALIVE_MS);
  if (tickTimer.unref) tickTimer.unref();
  tick();
}

function stop() {
  started = false;
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = null;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  if (unsubscribe) unsubscribe();
  unsubscribe = null;
  stopSubscription();
  sent.clear();
  seen.clear();
}

module.exports = { start, stop, tick, rotate, info, statusView };

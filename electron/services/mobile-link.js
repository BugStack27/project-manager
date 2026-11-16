'use strict';

const eventLog = require('./event-log');
const protocol = require('./mobile-protocol');
const qr = require('./qr');

/**
 * 手机端通道的传输层（PushGo Pull 版）。
 *
 * - 桌面端与手机端各自注册一个 PushGo 设备，订阅同一个频道；
 * - 这里每 15 秒 /v2/messages/pull 拉一次手机答案，处理完按 delivery_id ACK；
 * - 待推送消息只在内容变化时发一次，Pull 队列会保留到手机 ACK；
 * - 双方每分钟发一条 keepalive；桌面端 keepalive 里带 pending 与 resolvedIds，
 *   手机端收到后更新在线状态，并把桌面端已处理掉的条目标记完成。
 *
 * 这是 Pull 原型：设备路由暂用 fcm + 随机 provider_token，让消息进入 Pull 队列，
 * 不依赖真实 FCM 送达；send_status 可能显示 partially_failed，但 Pull/ACK 是可靠的。
 * 正式版可替换为 PushGo 私有 WSS 通道。
 */

const POLL_MS = 15000;
const TICK_MS = 5000;
const MAX_BODY_BYTES = 32000;
const SEEN_MAX = 500;

let started = false;
let dispatchRef = null;
let logRef = () => {};
let timer = null;
let unsubscribe = null;
let ticking = false;
let rerun = false;
let lastTickAt = 0;
let lastKeepaliveAt = 0;

let config = {
  enabled: false,
  gateway: '',
  channelId: '',
  channelName: '',
  channelPassword: '',
  deviceKey: '',
  providerToken: ''
};

let routeReady = false;
let subscribed = false;
let ensurePromise = null;
let pendingIds = new Set();
let resolvedIds = new Set();
const sent = new Map();
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
  return String(config.gateway || '').replace(/\/+$/, '');
}

function rememberError(e) {
  const message = (e && e.message) || String(e);
  state.connected = false;
  if (state.error === message) return;
  state.error = message;
  state.errorAt = new Date().toISOString();
  logRef('[mobile/pushgo] ' + message);
}

function clearError() {
  state.error = null;
  state.errorAt = null;
}

function pruneSeen() {
  while (seen.size > SEEN_MAX) seen.delete(seen.keys().next().value);
}

async function post(path, body) {
  if (!baseUrl()) throw new Error('PushGo 网关未配置');
  const raw = JSON.stringify(body);
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
    throw new Error('消息超过 PushGo 32KB 限制');
  }
  const res = await fetch(baseUrl() + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: raw,
    signal: AbortSignal.timeout(20000)
  });
  let data = null;
  try {
    data = await res.json();
  } catch (_) {
    throw new Error('PushGo 返回不是 JSON：HTTP ' + res.status);
  }
  if (!res.ok || !data || data.success !== true) {
    const detail = (data && (data.error || (data.problem && data.problem.detail))) || '';
    const e = new Error('PushGo HTTP ' + res.status + (detail ? '：' + detail : ''));
    e.status = res.status;
    e.code = data && data.error_code;
    throw e;
  }
  return data.data || {};
}

async function readConfig() {
  const res = await dispatchRef('mobileSessionInfo');
  if (!res || !res.ok) throw new Error((res && res.message) || '读取手机端设置失败');
  const settings = (res.data && res.data.settings) || {};
  const session = (res.data && res.data.session) || {};
  return {
    enabled: settings.enabled === true,
    gateway: String(settings.gateway || '').replace(/\/+$/, ''),
    channelId: String(session.channelId || ''),
    channelName: String(session.channelName || ''),
    channelPassword: String(session.channelPassword || ''),
    deviceKey: String(session.deviceKey || ''),
    providerToken: String(session.providerToken || '')
  };
}

function sameConfig(a, b) {
  return (
    a.enabled === b.enabled &&
    a.gateway === b.gateway &&
    a.channelId === b.channelId &&
    a.channelName === b.channelName &&
    a.channelPassword === b.channelPassword &&
    a.deviceKey === b.deviceKey &&
    a.providerToken === b.providerToken
  );
}

function resetTransportState() {
  routeReady = false;
  subscribed = false;
  pendingIds = new Set();
  resolvedIds = new Set();
  sent.clear();
  seen.clear();
  state.connected = false;
  state.clientLastSeenAt = null;
  state.lastInboundAt = null;
}

async function saveState(patch) {
  const res = await dispatchRef('mobileSavePushGoState', { state: patch });
  if (!res || !res.ok) throw new Error((res && res.message) || '保存 PushGo 会话失败');
  const session = (res.data && res.data.session) || {};
  config.channelId = String(session.channelId || config.channelId);
  config.channelName = String(session.channelName || config.channelName);
  config.channelPassword = String(session.channelPassword || config.channelPassword);
  config.deviceKey = String(session.deviceKey || config.deviceKey);
  config.providerToken = String(session.providerToken || config.providerToken);
}

async function pollPage() {
  const ack = [];
  const now = Date.now();
  let pageToken = '';
  let pages = 0;

  do {
    const body = { device_key: config.deviceKey };
    if (pageToken) body.page_token = pageToken;
    const data = await post('/v2/messages/pull', body);
    const items = Array.isArray(data.items) ? data.items : [];

    for (const item of items) {
      const deliveryId = item && item.delivery_id;
      if (!deliveryId) continue;
      let message = null;
      try {
        const ciphertext = item.payload && item.payload.ciphertext;
        message = ciphertext
          ? protocol.openMessage(config.channelId, config.channelPassword, ciphertext)
          : null;
      } catch (_) {
        message = null;
      }
      if (!message || !message.id) {
        // 解不开的旧消息直接清掉，避免占住队列
        ack.push(deliveryId);
        continue;
      }
      if (seen.has(message.id)) {
        ack.push(deliveryId);
        continue;
      }
      seen.set(message.id, now);
      pruneSeen();

      if (message.from === 'server') {
        // 自己发出的 review/question/keepalive 会广播回来，直接 ACK
        ack.push(deliveryId);
        continue;
      }
      if (message.from !== 'client') {
        ack.push(deliveryId);
        continue;
      }

      state.clientLastSeenAt = new Date().toISOString();
      state.lastInboundAt = state.clientLastSeenAt;

      if (message.type === 'keepalive') {
        ack.push(deliveryId);
        continue;
      }

      if (message.type === 'answer') {
        const res = await dispatchRef('mobileAnswer', { message });
        if (res && res.ok) {
          state.lastAnswerAt = new Date().toISOString();
          state.lastAnswer = {
            id: message.id,
            applied: !!(res.data && res.data.applied),
            duplicate: !!(res.data && res.data.duplicate),
            reason: (res.data && res.data.reason) || null
          };
          if (!state.lastAnswer.applied && !state.lastAnswer.duplicate) {
            logRef('[mobile/pushgo] 答案未生效：' + (state.lastAnswer.reason || 'unknown'));
          }
          // 验收提交后的推送失败不阻断验收，但要留痕，方便对账远程状态
          if (res.data && res.data.commit && res.data.commit.pushError) {
            logRef('[mobile/pushgo] 验收提交后推送失败：' + res.data.commit.pushError);
          }
        } else {
          state.lastAnswer = {
            id: message.id,
            applied: false,
            error: (res && res.message) || '处理失败'
          };
        }
        // 原型阶段统一 ACK：未生效的答案保留在手机端“已提交”，用户可重试
        ack.push(deliveryId);
        continue;
      }

      ack.push(deliveryId);
    }

    pageToken = data.has_more === true ? String(data.next_page_token || '') : '';
    pages += 1;
  } while (pageToken && pages < 10);

  if (ack.length) {
    await post('/v2/messages/ack', {
      device_key: config.deviceKey,
      delivery_ids: ack
    });
  }
}

function publishBody(message, ciphertext) {
  return {
    channel_id: config.channelId,
    password: config.channelPassword,
    title: '项目管理台',
    body: '',
    ciphertext,
    op_id: protocol.pushgoOpId(message.id),
    metadata: { from: message.from, kind: message.type }
  };
}

async function ensure() {
  if (ensurePromise) return ensurePromise;
  ensurePromise = ensureOnce();
  try {
    return await ensurePromise;
  } finally {
    ensurePromise = null;
  }
}

async function ensureOnce() {
  if (!config.gateway) throw new Error('PushGo 网关未配置');
  if (!config.channelPassword) throw new Error('PushGo 频道密码未生成');

  const patch = {};
  if (!config.deviceKey) {
    const data = await post('/device/register', { platform: 'android' });
    if (!data.device_key) throw new Error('PushGo 未返回 device_key');
    config.deviceKey = String(data.device_key);
    patch.deviceKey = config.deviceKey;
  }
  if (!config.providerToken) {
    config.providerToken = 'pm-pull-' + protocol.newAnswerId().slice(7);
    patch.providerToken = config.providerToken;
  }
  if (Object.keys(patch).length) await saveState(patch);

  if (!routeReady) {
    await post('/channel/device', {
      device_key: config.deviceKey,
      channel_type: 'fcm',
      provider_token: config.providerToken
    });
    routeReady = true;
  }

  if (!config.channelId) {
    const data = await post('/channel/subscribe', {
      device_key: config.deviceKey,
      channel_name: config.channelName,
      password: config.channelPassword
    });
    if (!data.channel_id) throw new Error('PushGo 未返回 channel_id');
    config.channelId = String(data.channel_id);
    if (data.channel_name) config.channelName = String(data.channel_name);
    subscribed = true;
    await saveState({ channelId: config.channelId, channelName: config.channelName });
  } else if (!subscribed) {
    await post('/channel/subscribe', {
      device_key: config.deviceKey,
      channel_id: config.channelId,
      password: config.channelPassword
    });
    subscribed = true;
  }

  state.connected = true;
  clearError();
}

async function sendPending() {
  const res = await dispatchRef('mobilePending');
  if (!res || !res.ok) throw new Error((res && res.message) || '读取待推送消息失败');
  const list = (res.data && res.data.messages) || [];
  state.pending = list.length;

  const current = new Set(list.map((m) => m.id));
  for (const id of pendingIds) {
    if (!current.has(id)) resolvedIds.add(id);
  }
  pendingIds = current;

  for (const message of list) {
    const hash = JSON.stringify(message);
    const prev = sent.get(message.id);
    if (prev && prev.hash === hash) continue;

    let ciphertext;
    try {
      ciphertext = protocol.sealMessage(config.channelId, config.channelPassword, message);
    } catch (e) {
      throw new Error('加密待推送消息失败：' + e.message);
    }
    await post('/message', publishBody(message, ciphertext));
    sent.set(message.id, { hash, at: Date.now() });
    state.published += 1;
    state.lastPublishAt = new Date().toISOString();
  }

  for (const id of Array.from(sent.keys())) {
    if (!current.has(id)) sent.delete(id);
  }
}

/**
 * 隧道地址 + 令牌：随心跳带给手机，手机据此直连 /remote。
 *
 * 远程访问没开、或隧道还没拿到地址时返回 null —— 心跳里就不带 endpoint 字段，
 * 手机端保持上一次的值（地址暂时连不上比被清空更可用）。
 */
async function endpointOf() {
  try {
    const res = await dispatchRef('endpointInfo');
    const data = res && res.ok ? res.data : null;
    if (!data || !data.url) return null;
    return { v: 1, url: data.url, token: data.token || '' };
  } catch (_) {
    return null;
  }
}

async function maybeKeepalive() {
  const now = Date.now();
  if (resolvedIds.size === 0 && now - lastKeepaliveAt < 60000) return;

  const endpoint = await endpointOf();
  const message = protocol.keepaliveMessage('server', null, {
    pending: state.pending,
    resolvedIds: Array.from(resolvedIds),
    ...(endpoint ? { endpoint } : {})
  });
  const ciphertext = protocol.sealMessage(config.channelId, config.channelPassword, message);
  await post('/message', publishBody(message, ciphertext));
  lastKeepaliveAt = Date.now();
  resolvedIds.clear();
  state.lastPublishAt = new Date().toISOString();
}

async function tick(force) {
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
      resetTransportState();
    }
    if (!config.enabled) {
      state.connected = false;
      state.pending = 0;
      return;
    }
    const now = Date.now();
    if (!force && now - lastTickAt < POLL_MS) return;
    lastTickAt = now;

    await ensure();
    await pollPage();
    await sendPending();
    await maybeKeepalive();
    clearError();
  } catch (e) {
    rememberError(e);
  } finally {
    ticking = false;
    if (rerun) {
      rerun = false;
      tick(true);
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
    gateway: config.gateway,
    channelId: config.channelId || (session && session.channelId) || '',
    startedAt: state.startedAt
  };
}

/** 弹窗用：设置 + 会话 + 二维码 + 实时状态，一次取全 */
async function info() {
  const next = await readConfig();
  if (!sameConfig(next, config)) {
    config = next;
    resetTransportState();
  }
  await ensure();
  const res = await dispatchRef('mobileSessionInfo');
  const session = (res && res.data && res.data.session) || {};
  const connect = protocol.connectPayloadPushGo({
    gateway: config.gateway,
    channel: config.channelId,
    password: config.channelPassword
  });
  return {
    settings: { enabled: config.enabled, gateway: config.gateway },
    session,
    connect,
    qrSvg: qr.svg(connect),
    status: statusView(session)
  };
}

/** 轮换会话：生成新频道与密码；设备 key 保留，旧频道立即作废 */
async function rotate() {
  const res = await dispatchRef('mobileRotateSession');
  if (!res || !res.ok) throw new Error((res && res.message) || '轮换 PushGo 频道失败');
  resetTransportState();
  state.published = 0;
  const infoData = await info();
  await tick(true);
  return infoData;
}

function start(deps) {
  if (started) return;
  dispatchRef = deps && deps.dispatch;
  logRef = (deps && deps.log) || console.log;
  if (typeof dispatchRef !== 'function') throw new Error('mobile-link 缺少 dispatch');
  started = true;
  state.startedAt = new Date().toISOString();

  unsubscribe = eventLog.subscribe((ev) => {
    if (!ev || typeof ev.type !== 'string') return;
    if (ev.type.indexOf('requirement.') === 0 || ev.type === 'settings.changed') tick(true);
  });

  timer = setInterval(() => tick(false), TICK_MS);
  if (timer.unref) timer.unref();
  tick(true);
}

function stop() {
  started = false;
  if (timer) clearInterval(timer);
  timer = null;
  if (unsubscribe) unsubscribe();
  unsubscribe = null;
  resetTransportState();
}

/**
 * 隧道地址刚换时调用：把心跳节流清零并立刻推一轮，手机端不必等下一个 60 秒窗口。
 * 地址失效后旧配置本身就连不通，晚一分钟拿不到新地址的代价是「手机上什么都打不开」。
 */
function forceKeepalive() {
  lastKeepaliveAt = 0;
  tick(true);
}

module.exports = { start, stop, tick, rotate, info, statusView, forceKeepalive };

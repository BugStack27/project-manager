'use strict';

const eventLog = require('./event-log');
const protocol = require('./mobile-protocol');
const qr = require('./qr');

/**
 * 手机端通道的传输层 —— **只做一件事：把接入点（隧道地址 + 令牌）送到手机**。
 *
 * 2026-11-16 收窄：这条通道以前还负责推 review/question、再把 answer 拉回来，等于和
 * `/remote` 长轮询并行维护两套业务状态。但它跑在界面进程里、靠 pull 节奏推进，
 * 真正能在后台工作的只有手机端前台服务里的长轮询那一条 —— 两条路只会制造「谁先到」的问题。
 * 现在业务全部走 `/remote`，这里只发 keepalive，payload 里带 `endpoint`。
 *
 * 频道、设备与会话仍然保留：那是把一条消息送到手机的唯一手段，去掉就没法下发地址了。
 * 桌面端不再 pull：没有入站消息，ACK 自然也不需要。
 */

const TICK_MS = 5000;
/** 地址没变也每 10 分钟重发一次：手机重装 / 清数据后不必等地址变化才能拿到接入点 */
const REFRESH_MS = 10 * 60 * 1000;
const MAX_BODY_BYTES = 32000;

let started = false;
let dispatchRef = null;
let logRef = () => {};
let timer = null;
let unsubscribe = null;
let ticking = false;
let rerun = false;
let lastTickAt = 0;
let lastPublishAt = 0;
let lastEndpointKey = '';

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

const state = {
  startedAt: null,
  connected: false,
  error: null,
  errorAt: null,
  published: 0,
  lastPublishAt: null,
  hasEndpoint: false
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
  lastEndpointKey = '';
  state.connected = false;
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

function publishBody(message, ciphertext) {
  return {
    channel_id: config.channelId,
    password: config.channelPassword,
    title: '项目管理台',
    body: '',
    ciphertext,
    op_id: protocol.pushgoOpId(message.id),
    // kind 固定 endpoint：网关侧若做统计，一眼能看出这条通道上只有地址消息
    metadata: { from: message.from, kind: 'endpoint' }
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
    config.providerToken = 'pm-endpoint-' + protocol.newKey().slice(0, 16);
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

/**
 * 接入点：隧道地址 + 令牌，来自 main 的 endpointInfo。
 * 手机端通信关着、或隧道还没拿到地址时返回 null —— 这条消息就不发，
 * 手机保留上一次的值（地址暂时连不上比被清空更可用）。
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

/** 发一次接入点心跳：内容没变且没过刷新周期就不发，避免每分钟往频道里塞一条一模一样的 */
async function publishEndpoint(force) {
  const endpoint = await endpointOf();
  state.hasEndpoint = !!endpoint;
  if (!endpoint) return false;

  const key = endpoint.url + '|' + endpoint.token;
  const now = Date.now();
  if (!force && key === lastEndpointKey && now - lastPublishAt < REFRESH_MS) return false;

  const message = protocol.keepaliveMessage('server', null, { endpoint });
  const ciphertext = protocol.sealMessage(config.channelId, config.channelPassword, message);
  await post('/message', publishBody(message, ciphertext));

  lastEndpointKey = key;
  lastPublishAt = now;
  state.published += 1;
  state.lastPublishAt = new Date(now).toISOString();
  return true;
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
      return;
    }
    const now = Date.now();
    if (!force && now - lastTickAt < TICK_MS) return;
    lastTickAt = now;

    await ensure();
    await publishEndpoint(!!force);
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
  return {
    running: started,
    connected: state.connected,
    published: state.published,
    lastPublishAt: state.lastPublishAt,
    hasEndpoint: state.hasEndpoint,
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

async function rotate() {
  const res = await dispatchRef('mobileRotateSession');
  if (!res || !res.ok) throw new Error((res && res.message) || '轮换 PushGo 频道失败');
  resetTransportState();
  state.published = 0;
  const infoData = await info();
  await tick(true);
  return infoData;
}

/**
 * 隧道地址刚换时调用：清掉「上次发过的内容」与节奏，立刻推一轮。
 * 地址变了而手机没收到，等于手机上什么都打不开，这一条不能等下一个周期。
 */
function forceKeepalive() {
  lastEndpointKey = '';
  lastPublishAt = 0;
  tick(true);
}

function start({ dispatch, log }) {
  if (started) return;
  dispatchRef = dispatch;
  logRef = typeof log === 'function' ? log : () => {};
  started = true;
  state.startedAt = new Date().toISOString();

  unsubscribe = eventLog.subscribe((ev) => {
    if (!ev || typeof ev.type !== 'string') return;
    if (ev.type === 'settings.changed') tick(true);
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

module.exports = { start, stop, tick, rotate, info, statusView, forceKeepalive };

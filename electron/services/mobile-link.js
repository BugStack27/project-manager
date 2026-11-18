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
/**
 * 地址没变也每分钟重发一次：手机新配对 / 重装 / 清数据后不必等地址变化才能拿到接入点。
 * 同时这也是手机端判断桌面端在线的唯一信号，节奏必须短于 150 秒的在线容差。
 */
const REFRESH_MS = 60 * 1000;
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
  errorCode: '',
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
  state.errorCode = (e && e.code) || '';
  if (state.error === message) return;
  state.error = message;
  state.errorAt = new Date().toISOString();
  logRef('[mobile/pushgo] ' + message);
}

function clearError() {
  state.error = null;
  state.errorCode = '';
  state.errorAt = null;
}

async function post(path, body) {
  const base = baseUrl();
  if (!base) throw new Error('PushGo 网关未配置');
  const raw = JSON.stringify(body);
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
    throw new Error('消息超过 PushGo 32KB 限制');
  }
  try {
    return await postOnce(base, path, raw);
  } catch (e) {
    // 设备记录失效（过期 / 数据被清）：清掉就绪标记，下一次 ensure 会重新注册
    if (e && e.code === 'device_key_not_found') {
      routeReady = false;
      subscribed = false;
    }
    throw e;
  }
}

async function postOnce(base, path, raw) {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: raw,
    signal: AbortSignal.timeout(20000)
  });
  let data = null;
  try {
    data = await res.json();
  } catch (_) {
    const e = new Error('PushGo 返回不是 JSON：HTTP ' + res.status);
    e.status = res.status;
    throw e;
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

/** 配置变了（开关 / 网关 / 频道 / 设备）就重置传输层；返回是否发生了变化 */
function applyConfig(next) {
  if (sameConfig(next, config)) return false;
  config = next;
  resetTransportState();
  return true;
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
    // op_id 由网关生成，客户端再传会被 400 op_id_not_allowed
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
  if (!config.deviceKey) await registerDevice();
  if (!config.providerToken) {
    config.providerToken = 'pm-endpoint-' + protocol.newKey().slice(0, 16);
    patch.providerToken = config.providerToken;
  }
  if (Object.keys(patch).length) await saveState(patch);

  await ensureRoute();
  await ensureSubscribe();

  state.connected = true;
  clearError();
}

/** 注册设备并落库；换了新设备后路由与订阅都要重建 */
async function registerDevice() {
  const data = await post('/device/register', { platform: 'android' });
  if (!data.device_key) throw new Error('PushGo 未返回 device_key');
  config.deviceKey = String(data.device_key);
  routeReady = false;
  subscribed = false;
  await saveState({ deviceKey: config.deviceKey });
}

/**
 * 设备路由。旧 device_key 在新网关上不存在（或已过期）时，网关会回 400 device_key_not_found；
 * 这不是用户能处理的事，自动重注册一次再建路由。
 */
async function ensureRoute() {
  if (routeReady) return;
  const route = () =>
    post('/channel/device', {
      device_key: config.deviceKey,
      channel_type: 'fcm',
      provider_token: config.providerToken
    });
  try {
    await route();
  } catch (e) {
    if (!e || e.code !== 'device_key_not_found') throw e;
    await registerDevice();
    await route();
  }
  routeReady = true;
}

async function ensureSubscribe() {
  if (subscribed) return;
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
    return;
  }
  try {
    await post('/channel/subscribe', {
      device_key: config.deviceKey,
      channel_id: config.channelId,
      password: config.channelPassword
    });
    subscribed = true;
  } catch (e) {
    /**
     * 频道只存在于创建它的网关上：频道过期、网关数据被清都会到这里。
     * 新建频道意味着手机必须重新扫码，所以不静默处理，直接把下一步告诉用户。
     */
    if (e && e.code === 'channel_not_found') {
      const err = new Error('当前网关上没有原来的频道（换过网关或频道已失效），请点「重新配对」后让手机重新扫码');
      err.code = 'channel_not_found';
      throw err;
    }
    throw e;
  }
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

/** 发一次接入点心跳：地址变了立即发，没变也按 60 秒周期重发，手机据此判断桌面端在线 */
async function publishEndpoint(force) {
  const endpoint = await endpointOf();
  if (!endpoint) {
    state.hasEndpoint = false;
    return false;
  }

  const key = endpoint.url + '|' + endpoint.token;
  const now = Date.now();
  if (!force && key === lastEndpointKey && now - lastPublishAt < REFRESH_MS) return false;

  const message = protocol.keepaliveMessage('server', null, { endpoint });
  const ciphertext = protocol.sealMessage(config.channelId, config.channelPassword, message);
  try {
    await post('/message', publishBody(message, ciphertext));
  } catch (e) {
    // 「已下发」只认最近一次真正送达，避免发送失败时界面仍显示已下发
    state.hasEndpoint = false;
    throw e;
  }

  state.hasEndpoint = true;
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
    applyConfig(next);
    if (!config.enabled) {
      state.connected = false;
      state.hasEndpoint = false;
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
    errorCode: state.errorCode,
    errorAt: state.errorAt,
    gateway: config.gateway,
    channelId: config.channelId || (session && session.channelId) || '',
    startedAt: state.startedAt
  };
}

/** 弹窗用：设置 + 会话 + 二维码 + 实时状态，一次取全 */
async function info() {
  const next = await readConfig();
  applyConfig(next);
  // 注册/订阅要联网：网关慢或不通时别把弹窗卡在「正在读取」，结果交给 status 反映
  if (config.enabled) ensure().catch((e) => rememberError(e));
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
  // 轮换会清掉频道，必须等新频道建好再取快照，否则弹窗会短暂显示旧的空频道
  await tick(true);
  return info();
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

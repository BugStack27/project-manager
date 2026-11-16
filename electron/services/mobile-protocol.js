'use strict';

const crypto = require('crypto');

/**
 * 手机端通信的协议层：会话生成、密钥派生、对称加密信封、消息与固定 id 规则。
 *
 * 手机端是独立实现，所以这里的每条规则都是**对外规格**（见 doc/mobile-link.md），
 * 不依赖 electron、不读写存储：改算法等于改协议，手机端必须同步升级 v。
 */

/** 频道标识只允许字母数字与 -_；去掉 l / 0 / 1 / o，避免口头或手抄时认错 */
const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
const TOPIC_PREFIX = 'pm-';
const TOPIC_RANDOM_LEN = 16;
const KEY_LEN = 32;

/** 派生参数：PBKDF2-HMAC-SHA256，盐固定带版本前缀，换版本就换协议 */
const KDF_SALT_PREFIX = 'pm-mobile-v1:';
const KDF_ITERATIONS = 100000;
const KDF_KEYLEN = 32;

/** 信封：AES-256-GCM，12 字节随机 IV，AAD 绑 topic（串错 topic 直接解不开） */
const ENVELOPE_VERSION = 1;
const IV_LEN = 12;
const TAG_LEN = 16;
const MESSAGE_VERSION = 1;

/** 重发与在线判定的统一节奏：双方每分钟一次 keepAlive，待处理消息也按这个节奏重发 */
const KEEPALIVE_MS = 60 * 1000;
/** 客户端超过这个时间没有 keepAlive 就算离线（两个周期，容忍一次丢包） */
const CLIENT_ONLINE_MS = 150 * 1000;

const TOPIC_RE = /^pm-[a-z2-9]{16}$/;
const KEY_RE = /^[a-z2-9]{32}$/;
const derived = new Map();

function protocolError(message, code) {
  const e = new Error(message);
  e.code = code;
  return e;
}

function randomToken(len) {
  let out = '';
  for (let i = 0; i < len; i += 1) out += ALPHABET[crypto.randomInt(0, ALPHABET.length)];
  return out;
}

function newTopic() {
  return TOPIC_PREFIX + randomToken(TOPIC_RANDOM_LEN);
}

function newKey() {
  return randomToken(KEY_LEN);
}

function isValidTopic(value) {
  return typeof value === 'string' && TOPIC_RE.test(value);
}

function isValidKey(value) {
  return typeof value === 'string' && KEY_RE.test(value);
}

/** 连接密钥 → AES-256 密钥。缓存最近几条，避免每分钟重算 10 万轮 */
function deriveKey(key, topic) {
  if (!isValidKey(key)) {
    throw protocolError('连接密钥或 topic 不合法', 'bad_session');
  }
  // topic 在 PushGo 模式下是频道 ID，只作为 AAD / 盐的一部分，格式由连接信息解析处校验
  const cacheKey = topic + '|' + key;
  const hit = derived.get(cacheKey);
  if (hit) return hit;
  const out = crypto.pbkdf2Sync(key, KDF_SALT_PREFIX + topic, KDF_ITERATIONS, KDF_KEYLEN, 'sha256');
  derived.set(cacheKey, out);
  if (derived.size > 8) derived.delete(derived.keys().next().value);
  return out;
}

/**
 * 把一条消息封成网关能承载的文本：`{"v":1,"n":"<iv>","d":"<密文+tag>"}`。
 * 明文是 UTF-8 JSON，tag 在 `d` 的末尾 16 字节。
 */
function sealMessage(topic, key, message) {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(key, topic), iv);
  cipher.setAAD(Buffer.from(topic, 'utf8'));
  const body = Buffer.concat([cipher.update(JSON.stringify(message), 'utf8'), cipher.final()]);
  return JSON.stringify({
    v: ENVELOPE_VERSION,
    n: iv.toString('base64'),
    d: Buffer.concat([body, cipher.getAuthTag()]).toString('base64')
  });
}

/** 二维码里的连接信息：手机端扫到后按这个 JSON 取三件套 */
/** PushGo 二维码：网关 + 频道 + 频道密码（密码同时作为端到端加密密钥） */
function connectPayloadPushGo({ gateway, channel, password }) {
  return JSON.stringify({
    v: 2,
    type: 'pm-mobile',
    provider: 'pushgo',
    gateway: String(gateway || '').replace(/\/+$/, ''),
    channel,
    password
  });
}

/** PushGo op_id 只允许字母/数字/下划线/冒号/短横；把消息 id 稳定地映射过去 */
function pushgoOpId(id) {
  const clean = String(id || '').replace(/[^A-Za-z0-9_:-]/g, '-').slice(0, 128);
  return clean || ('op-' + Date.now().toString(36));
}

/** keepAlive 每轮都是新消息（时间戳进 id），客户端只把它用来判定在线，不参与去重展示 */
function keepaliveMessage(from, at, extra) {
  return {
    v: MESSAGE_VERSION,
    id: 'keepalive:' + from + ':' + Date.now(),
    type: 'keepalive',
    from,
    at: at || new Date().toISOString(),
    payload: { online: true, ...(extra || {}) }
  };
}

module.exports = {
  ALPHABET,
  KEEPALIVE_MS,
  CLIENT_ONLINE_MS,
  ENVELOPE_VERSION,
  MESSAGE_VERSION,
  newTopic,
  newKey,
  isValidTopic,
  isValidKey,
  deriveKey,
  sealMessage,
  connectPayloadPushGo,
  pushgoOpId,
  keepaliveMessage
};

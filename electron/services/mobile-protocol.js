'use strict';

const crypto = require('crypto');

/**
 * 手机端通信的协议层：会话生成、密钥派生、对称加密信封、消息与固定 id 规则。
 *
 * 手机端是独立实现，所以这里的每条规则都是**对外规格**（见 doc/mobile-link.md），
 * 不依赖 electron、不读写存储：改算法等于改协议，手机端必须同步升级 v。
 */

/** ntfy 的 topic 只允许字母数字与 -_；去掉 l / 0 / 1 / o，避免口头或手抄时认错 */
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
const ANSWER_ID_RE = /^answer:[A-Za-z0-9_-]{6,64}$/;
const REQUIREMENT_ID_RE = /^r_[A-Za-z0-9]+$/;
const QUESTION_ID_RE = /^q_[A-Za-z0-9]+$/;
const DECISIONS = new Set(['answer', 'approve', 'feedback', 'reject']);
const TYPES = new Set(['review', 'question', 'answer', 'keepalive']);
const SIDES = new Set(['server', 'client']);
const TEXT_MAX = 2000;
/** 单条消息要装进 ntfy 的 4KB 正文：长文本按字符截断，手机上只看摘要，全文留在桌面端 */
const CLIP = { title: 100, note: 500, question: 300, option: 40, defaultValue: 100 };

function clip(value, max) {
  const s = String(value == null ? '' : value);
  return s.length > max ? s.slice(0, max) + '…' : s;
}

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
  if (!isValidKey(key) || !isValidTopic(topic)) {
    throw protocolError('连接密钥或 topic 不合法', 'bad_session');
  }
  const cacheKey = topic + '|' + key;
  const hit = derived.get(cacheKey);
  if (hit) return hit;
  const out = crypto.pbkdf2Sync(key, KDF_SALT_PREFIX + topic, KDF_ITERATIONS, KDF_KEYLEN, 'sha256');
  derived.set(cacheKey, out);
  if (derived.size > 8) derived.delete(derived.keys().next().value);
  return out;
}

/**
 * 把一条消息封成 ntfy 能承载的文本：`{"v":1,"n":"<iv>","d":"<密文+tag>"}`。
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

/** 解信封并校验消息外形；任何一步失败都当「不是给我们的消息」处理（返回前抛出） */
function openMessage(topic, key, text) {
  let env;
  try {
    env = JSON.parse(String(text || ''));
  } catch (_) {
    throw protocolError('信封不是合法 JSON', 'bad_envelope');
  }
  if (!env || env.v !== ENVELOPE_VERSION || typeof env.n !== 'string' || typeof env.d !== 'string') {
    throw protocolError('信封版本或字段不对', 'bad_envelope');
  }

  const iv = Buffer.from(env.n, 'base64');
  const raw = Buffer.from(env.d, 'base64');
  if (iv.length !== IV_LEN || raw.length <= TAG_LEN) {
    throw protocolError('信封长度不对', 'bad_envelope');
  }

  let message;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(key, topic), iv);
    decipher.setAAD(Buffer.from(topic, 'utf8'));
    decipher.setAuthTag(raw.subarray(raw.length - TAG_LEN));
    const json = Buffer.concat([
      decipher.update(raw.subarray(0, raw.length - TAG_LEN)),
      decipher.final()
    ]).toString('utf8');
    message = JSON.parse(json);
  } catch (_) {
    throw protocolError('解密失败：密钥或 topic 不匹配，或密文被改动', 'decrypt_failed');
  }

  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    throw protocolError('明文不是对象', 'bad_message');
  }
  if (message.v !== MESSAGE_VERSION) throw protocolError('消息版本不支持：' + message.v, 'bad_message');
  if (!TYPES.has(message.type)) throw protocolError('未知消息类型：' + message.type, 'bad_message');
  if (!SIDES.has(message.from)) throw protocolError('未知发送方：' + message.from, 'bad_message');
  if (typeof message.id !== 'string' || !message.id) throw protocolError('消息缺少 id', 'bad_message');
  return message;
}

/** 二维码里的连接信息：手机端扫到后按这个 JSON 取三件套 */
function connectPayload({ server, topic, key }) {
  return JSON.stringify({
    v: 1,
    type: 'pm-mobile',
    server: String(server || '').replace(/\/+$/, ''),
    topic,
    key
  });
}

/** 审核消息：id 由「需求 + 这一轮交付时间」组成，重发不会变成新消息 */
function reviewMessage({ requirementId, seq, title, projectId, projectName, agent, agentName, note, completedAt, at }) {
  return {
    v: MESSAGE_VERSION,
    id: 'review:' + requirementId + ':' + completedAt,
    type: 'review',
    from: 'server',
    // 消息内容必须随 id 一起稳定：at 取交付时间而不是发送时间，重发不会改变内容指纹
    at: at || completedAt,
    payload: {
      requirementId,
      seq: seq === undefined ? null : seq,
      title: clip(title, CLIP.title),
      projectId: projectId || null,
      projectName: projectName || '',
      agent: agent || '',
      agentName: agentName || '',
      note: clip(note, CLIP.note),
      completedAt
    }
  };
}

/** 提问消息：一条提问一个固定 id，即使同一条需求上还有别的提问也互不覆盖 */
function questionMessage({ requirementId, seq, title, projectId, projectName, question, at }) {
  return {
    v: MESSAGE_VERSION,
    id: 'question:' + question.id,
    type: 'question',
    from: 'server',
    at: at || question.at || new Date().toISOString(),
    payload: {
      requirementId,
      seq: seq === undefined ? null : seq,
      title: clip(title, CLIP.title),
      projectId: projectId || null,
      projectName: projectName || '',
      questionId: question.id,
      text: clip(question.text, CLIP.question),
      options: Array.isArray(question.options)
        ? question.options.map((o) => clip(o, CLIP.option))
        : [],
      default: clip(question.default, CLIP.defaultValue),
      expiresAt: question.expiresAt || null
    }
  };
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

function newAnswerId() {
  return 'answer:' + Date.now().toString(36) + randomToken(10);
}

/**
 * 手机端回传的答案：question 走 `decision=answer`，审核走 approve / feedback / reject。
 * 只在这里做形状与长度校验，不改业务状态。
 */
function normalizeAnswer(message) {
  if (!message || message.type !== 'answer' || message.from !== 'client') {
    throw protocolError('不是手机端发来的答案消息', 'bad_answer');
  }
  if (!ANSWER_ID_RE.test(String(message.id || ''))) {
    throw protocolError('答案 id 不合法', 'bad_answer');
  }
  const p = message.payload || {};
  const requirementId = String(p.requirementId || '').trim();
  if (!REQUIREMENT_ID_RE.test(requirementId)) throw protocolError('缺少合法的需求 id', 'bad_answer');

  const decision = String(p.decision || '').trim();
  if (!DECISIONS.has(decision)) throw protocolError('未知的答案类型：' + decision, 'bad_answer');

  const text = String(p.text == null ? '' : p.text).trim();
  if (text.length > TEXT_MAX) throw protocolError('答案过长（上限 ' + TEXT_MAX + ' 字符）', 'bad_answer');

  let questionId = '';
  if (decision === 'answer') {
    questionId = String(p.questionId || '').trim();
    if (!QUESTION_ID_RE.test(questionId)) throw protocolError('缺少合法的提问 id', 'bad_answer');
    if (!text) throw protocolError('答案内容不能为空', 'bad_answer');
  }
  if (decision === 'feedback' && !text) {
    throw protocolError('打回意见不能为空', 'bad_answer');
  }

  return { id: message.id, requirementId, questionId, decision, text };
}

module.exports = {
  ALPHABET,
  KEEPALIVE_MS,
  CLIENT_ONLINE_MS,
  ENVELOPE_VERSION,
  MESSAGE_VERSION,
  newTopic,
  newKey,
  newAnswerId,
  isValidTopic,
  isValidKey,
  deriveKey,
  sealMessage,
  openMessage,
  connectPayload,
  reviewMessage,
  questionMessage,
  keepaliveMessage,
  normalizeAnswer
};

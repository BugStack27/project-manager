'use strict';

const store = require('../store');
const eventLog = require('../event-log');
const { actor } = eventLog;
const { nowIso } = require('./dates');
const { listQuestions } = require('./questions');
const { agentNameMap } = require('./lookups');
const protocol = require('../mobile-protocol');

/**
 * 手机端通信的领域状态：设置、会话、待推送消息、手机答案回写。
 *
 * 不碰网络：ntfy 的订阅 / 发布在 services/mobile-link.js，那里只消费这里产出的
 * 「待推送消息清单」，收到的答案回传到这里落库。这样协议与业务状态可以脱离传输单测。
 */

const DEFAULT_URL = 'https://ntfy.sh';
const DEFAULTS = { enabled: false, ntfyUrl: DEFAULT_URL, token: '' };
const URL_MAX = 300;
const TOKEN_MAX = 300;
/** 记住最近处理过的答案 id：手机端网络抖动会重发同一条，重复答案不能写两遍 */
const PROCESSED_MAX = 500;
const processed = new Map();

function readSettings(db) {
  const raw = (db && db.settings && db.settings.mobile) || {};
  const url = typeof raw.ntfyUrl === 'string' && raw.ntfyUrl.trim() ? raw.ntfyUrl.trim() : DEFAULT_URL;
  return {
    enabled: raw.enabled === true,
    ntfyUrl: url.replace(/\/+$/, ''),
    token: typeof raw.token === 'string' ? raw.token : ''
  };
}

function bad(message, code, status) {
  const e = new Error(message);
  e.code = code || 'bad_mobile_settings';
  e.status = status || 400;
  return e;
}

/** ntfy 服务器地址：只收 http/https，允许带路径（自建反代常见），去掉尾部斜杠 */
function normalizeUrl(value) {
  const url = String(value == null ? '' : value).trim();
  if (!url) return DEFAULT_URL;
  if (url.length > URL_MAX) throw bad('ntfy 地址过长（上限 ' + URL_MAX + ' 字符）');
  let u;
  try {
    u = new URL(url);
  } catch (_) {
    throw bad('ntfy 地址不是合法 URL');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw bad('ntfy 地址只支持 http / https');
  }
  return url.replace(/\/+$/, '');
}

function redact(settings) {
  return { ...settings, token: settings.token ? '<已设置>' : '' };
}

/** 会话按需生成：老库没有 db.mobile，或字段被改坏时补一份新的 */
function ensureSession(db) {
  if (!db.mobile || typeof db.mobile !== 'object' || Array.isArray(db.mobile)) db.mobile = {};
  const m = db.mobile;
  if (protocol.isValidTopic(m.topic) && protocol.isValidKey(m.key)) return m;

  const at = nowIso();
  m.topic = protocol.newTopic();
  m.key = protocol.newKey();
  m.createdAt = at;
  delete m.rotatedAt;
  store.save();
  return m;
}

function sessionInfo(db) {
  const m = ensureSession(db || store.get());
  return {
    topic: m.topic,
    key: m.key,
    createdAt: m.createdAt || null,
    rotatedAt: m.rotatedAt || null
  };
}

/**
 * 当前该推给手机端的消息：只有「等待审核」的交付与「等待回答」的提问。
 * id 与内容都稳定（见 mobile-protocol），传输层据此做重发与内容指纹。
 */
function pendingMessages() {
  const db = store.get();
  const names = agentNameMap();
  const projects = new Map((db.projects || []).map((p) => [p.id, p]));
  const now = Date.now();
  const messages = [];

  for (const r of db.requirements || []) {
    const proj = projects.get(r.projectId);
    if (proj && proj.archived) continue;
    const base = {
      requirementId: r.id,
      seq: r.seq,
      title: r.title,
      projectId: r.projectId,
      projectName: proj ? proj.name : ''
    };

    if (r.status === 'review' && r.completion && r.completion.at) {
      messages.push(
        protocol.reviewMessage({
          ...base,
          agent: r.completion.agent,
          agentName: names.get(r.completion.agent) || '',
          note: r.completion.note,
          completedAt: r.completion.at
        })
      );
    }

    if (r.status === 'doing') {
      for (const q of listQuestions(r)) {
        // 已过期的提问手机端答了也没用：/ask 侧已经按超时收尾
        if (q.expiresAt && Date.parse(q.expiresAt) <= now) continue;
        messages.push(protocol.questionMessage({ ...base, question: q }));
      }
    }
  }

  return { messages, count: messages.length };
}

function pruneProcessed() {
  while (processed.size > PROCESSED_MAX) {
    processed.delete(processed.keys().next().value);
  }
}

function createMobile(getMethods) {
  return {
    /** 设置 + 会话：连接弹窗与传输层共用同一份快照 */
    mobileSessionInfo: () => {
      const db = store.get();
      return { settings: readSettings(db), session: sessionInfo(db) };
    },

    saveMobileSettings: ({ patch }) => {
      const db = store.get();
      const before = readSettings(db);
      const next = { ...before };

      if (patch && typeof patch.enabled === 'boolean') next.enabled = patch.enabled;
      if (patch && patch.ntfyUrl !== undefined) next.ntfyUrl = normalizeUrl(patch.ntfyUrl);
      if (patch && patch.token !== undefined) {
        const token = String(patch.token == null ? '' : patch.token).trim();
        if (token.length > TOKEN_MAX) throw bad('访问令牌过长（上限 ' + TOKEN_MAX + ' 字符）');
        next.token = token;
      }

      if (JSON.stringify(before) === JSON.stringify(next)) {
        return { settings: before, session: sessionInfo(db) };
      }

      db.settings.mobile = next;
      store.save();
      eventLog.append({
        type: 'settings.changed',
        projectId: null,
        actor: actor.user(),
        // 审计里不留令牌原文，只记「有没有变」
        data: { mobile: { before: redact(before), after: redact(next) } }
      });
      return { settings: next, session: sessionInfo(db) };
    },

    /** 换一套 topic + 密钥：旧会话上的消息与答案立刻作废，手机端必须重新扫码 */
    mobileRotateSession: () => {
      const db = store.get();
      const m = ensureSession(db);
      const at = nowIso();
      m.topic = protocol.newTopic();
      m.key = protocol.newKey();
      m.createdAt = at;
      m.rotatedAt = at;
      store.save();
      return { session: sessionInfo(db), settings: readSettings(db) };
    },

    /** 传输层每轮取一次：清单里的消息按固定 id 重发，消失的停止重发 */
    mobilePending: () => pendingMessages(),

    /**
     * 手机端回传的答案：question → answerRequirement，审核 → setRequirementStatus。
     * 目标已经不存在 / 已处理过时返回 applied:false，不抛错——重发与迟到都是正常现象。
     */
    mobileAnswer: ({ message }) => {
      let ans;
      try {
        ans = protocol.normalizeAnswer(message);
      } catch (e) {
        e.status = 400;
        throw e;
      }

      if (processed.has(ans.id)) return { id: ans.id, applied: false, duplicate: true };

      const methods = getMethods();
      const r = (store.get().requirements || []).find((x) => x.id === ans.requirementId);
      if (!r) {
        // 目标已不在库里：这条答案永远无法再生效，直接记下，避免重连重放时反复处理
        processed.set(ans.id, Date.now());
        pruneProcessed();
        return { id: ans.id, applied: false, duplicate: false, reason: 'requirement_gone' };
      }

      try {
        if (ans.decision === 'answer') {
          methods.answerRequirement({ rid: ans.requirementId, qid: ans.questionId, text: ans.text });
        } else {
          const status = ans.decision === 'approve' ? 'done' : ans.decision === 'feedback' ? 'doing' : 'rejected';
          methods.setRequirementStatus({
            rid: ans.requirementId,
            status,
            feedback: ans.decision === 'feedback' ? ans.text : undefined
          });
        }
      } catch (e) {
        // 没落库就不能记为已处理：手机端重发或状态变化后仍有生效机会
        return {
          id: ans.id,
          applied: false,
          duplicate: false,
          reason: e.code || 'not_applicable',
          message: e.message || ''
        };
      }
      processed.set(ans.id, Date.now());
      pruneProcessed();
      return { id: ans.id, applied: true, duplicate: false };
    }
  };
}

module.exports = { createMobile, DEFAULTS, readSettings, pendingMessages };

'use strict';

const store = require('../store');
const eventLog = require('../event-log');
const { actor } = eventLog;
const { nowIso } = require('./dates');
const { listQuestions } = require('./questions');
const { agentNameMap } = require('./lookups');
const protocol = require('../mobile-protocol');

/**
 * 手机端通信的领域状态：PushGo 网关设置、频道/设备会话、待推送消息、手机答案回写。
 *
 * 传输（PushGo Pull/ACK）在 services/mobile-link.js，这里只维护业务状态，
 * 这样会话、待推送与答案幂等可以脱离网络单测。
 */

const DEFAULT_GATEWAY = 'https://gateway.pushgo.dev';
const DEFAULTS = { enabled: false, gateway: DEFAULT_GATEWAY };
const URL_MAX = 300;
const PROCESSED_MAX = 500;
/** 记住最近处理过的答案 id：手机端网络抖动会重发同一条，重复答案不能写两遍 */
const processed = new Map();

function readSettings(db) {
  const raw = (db && db.settings && db.settings.mobile) || {};
  const gateway = typeof raw.gateway === 'string' && raw.gateway.trim()
    ? raw.gateway.trim()
    : DEFAULT_GATEWAY;
  return {
    enabled: raw.enabled === true,
    gateway: gateway.replace(/\/+$/, '')
  };
}

function bad(message, code, status) {
  const e = new Error(message);
  e.code = code || 'bad_mobile_settings';
  e.status = status || 400;
  return e;
}

/** PushGo 网关地址：只收 http/https，允许带路径（自建反代常见），去掉尾部斜杠 */
function normalizeGateway(value) {
  const url = String(value == null ? '' : value).trim();
  if (!url) return DEFAULT_GATEWAY;
  if (url.length > URL_MAX) throw bad('PushGo 网关地址过长（上限 ' + URL_MAX + ' 字符）');
  let u;
  try {
    u = new URL(url);
  } catch (_) {
    throw bad('PushGo 网关不是合法 URL');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw bad('PushGo 网关只支持 http / https');
  }
  return url.replace(/\/+$/, '');
}

/** 频道与会话按需生成；渠道 ID 由 PushGo 网关创建，link 层写入 */
function ensureSession(db) {
  if (!db.mobile || typeof db.mobile !== 'object' || Array.isArray(db.mobile)) db.mobile = {};
  const m = db.mobile;
  let changed = false;

  if (!protocol.isValidKey(m.channelPassword)) {
    m.channelPassword = protocol.newKey();
    changed = true;
  }
  if (typeof m.channelName !== 'string' || !m.channelName.trim()) {
    m.channelName = protocol.newTopic();
    changed = true;
  }
  if (typeof m.channelId !== 'string') {
    m.channelId = '';
    changed = true;
  }
  if (typeof m.deviceKey !== 'string') {
    m.deviceKey = '';
    changed = true;
  }
  if (typeof m.providerToken !== 'string') {
    m.providerToken = '';
    changed = true;
  }
  if (!m.createdAt) {
    m.createdAt = nowIso();
    changed = true;
  }
  if (changed) store.save();
  return m;
}

function sessionInfo(db) {
  const m = ensureSession(db || store.get());
  return {
    channelId: m.channelId || '',
    channelName: m.channelName,
    channelPassword: m.channelPassword,
    deviceKey: m.deviceKey || '',
    providerToken: m.providerToken || '',
    createdAt: m.createdAt || null,
    rotatedAt: m.rotatedAt || null
  };
}

/**
 * 当前该推给手机端的消息：只有「等待审核」的交付与「等待回答」的提问。
 * id 与内容都稳定（见 mobile-protocol），传输层据此做去重与内容指纹。
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

/** 与桌面端 buildCommitMessage 同一口径：agent 单独提供的提交信息优先，老交付回落到「#序号 标题」 */
function approvalCommitMessage(r) {
  const supplied = String((r.completion && r.completion.commitMessage) || '').trim();
  return supplied || '#' + r.seq + ' ' + String(r.title || '').trim();
}

/**
 * 手机端通过需求时没有桌面端那个默认勾选的「提交并推送」可点，这里在落库前补上同一段流程：
 * 有未提交改动才提交，随后推送；没有仓库 / 路径失效按「没有可提交的改动」处理，验收照常。
 * 提交失败直接抛出（答案不落库，手机端可见「未生效」并重试）；推送失败只回报，不阻断验收。
 */
async function commitAndPushApproved(methods, r) {
  const out = { committed: false, shortSha: '', pushError: '' };

  let changes;
  try {
    changes = await methods.gitChanges({ id: r.projectId });
  } catch (_) {
    return out;
  }
  if (!changes || changes.isRepo === false) return out;
  if (!(changes.counts && changes.counts.total > 0)) return out;

  try {
    const res = await methods.gitCommit({ id: r.projectId, message: approvalCommitMessage(r) });
    out.committed = true;
    out.shortSha = (res && res.shortSha) || '';
  } catch (e) {
    // 改动已被别处提交不是失败：接着推送即可，与桌面端口径一致
    if (!e || e.code !== 'nothing_to_commit') throw e;
  }

  try {
    await methods.gitPush({ id: r.projectId });
  } catch (e) {
    out.pushError = (e && e.message) || '推送失败';
  }
  return out;
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
      if (patch && patch.gateway !== undefined) next.gateway = normalizeGateway(patch.gateway);

      if (JSON.stringify(before) === JSON.stringify(next)) {
        return { settings: before, session: sessionInfo(db) };
      }

      if (before.gateway !== next.gateway) {
        const m = ensureSession(db);
        m.channelId = '';
        m.deviceKey = '';
        m.providerToken = '';
        m.channelName = protocol.newTopic();
        m.channelPassword = protocol.newKey();
        m.createdAt = nowIso();
        delete m.rotatedAt;
      }

      db.settings.mobile = next;
      store.save();
      eventLog.append({
        type: 'settings.changed',
        projectId: null,
        actor: actor.user(),
        data: { mobile: { before, after: next } }
      });
      return { settings: next, session: sessionInfo(db) };
    },

    /** 换一套频道 + 密码：旧频道立刻作废，手机端必须重新扫码 */
    mobileRotateSession: () => {
      const db = store.get();
      const m = ensureSession(db);
      const at = nowIso();
      m.channelName = protocol.newTopic();
      m.channelPassword = protocol.newKey();
      m.channelId = '';
      m.createdAt = at;
      m.rotatedAt = at;
      store.save();
      return { session: sessionInfo(db), settings: readSettings(db) };
    },

    /** link 层创建频道/注册设备后写回；只覆盖传入的字段 */
    mobileSavePushGoState: ({ state }) => {
      const db = store.get();
      const m = ensureSession(db);
      const input = state || {};
      for (const key of ['channelId', 'channelName', 'channelPassword', 'deviceKey', 'providerToken']) {
        if (typeof input[key] === 'string' && input[key].trim()) m[key] = input[key].trim();
      }
      store.save();
      return { session: sessionInfo(db) };
    },

    /** 传输层每轮取一次：清单里的消息按固定 id 去重，消失的停止重发 */
    mobilePending: () => pendingMessages(),

    /**
     * 手机端回传的答案：question → answerRequirement，审核 → setRequirementStatus。
     * 通过待审核需求时先按桌面端默认勾选的口径提交并推送工作区改动，提交失败则不落库。
     * 目标已经不存在 / 已处理过时返回 applied:false，不抛错——重发与迟到都是正常现象。
     */
    mobileAnswer: async ({ message }) => {
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

      let commit = null;
      try {
        if (ans.decision === 'approve' && r.status === 'review') {
          commit = await commitAndPushApproved(methods, r);
        }
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
      return { id: ans.id, applied: true, duplicate: false, commit };
    }
  };
}

module.exports = { createMobile, DEFAULTS, readSettings, pendingMessages };

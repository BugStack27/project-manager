'use strict';

const store = require('../store');
const eventLog = require('../event-log');
const { actor } = eventLog;
const { nowIso } = require('./dates');
const { fail } = require('./errors');
const { listQuestions } = require('./questions');
const { agentNameMap } = require('./lookups');
const protocol = require('../mobile-protocol');

/**
 * 手机端的传输与会话状态。
 *
 * 这里只管「怎么把接入点送到手机」：网关地址、频道、设备会话。
 * 审批与提问**不经过这里** —— 它们只走 mcp-http.js 的 /remote 远程面，由手机主动长轮询取走。
 * 这条界线是 2026-11-16 划的：PushGo 一旦也承载业务消息，就会和 HTTP 那条路产生两套状态、
 * 两套去重、两套「谁先到」的问题，而实际能在后台工作的只有 HTTP 长轮询那一条。
 */

const DEFAULT_GATEWAY = 'https://gateway.pushgo.dev';
const DEFAULTS = { enabled: false, gateway: DEFAULT_GATEWAY };
const URL_MAX = 300;

/** 手机端能提交的答复类型 */
const DECISIONS = new Set(['answer', 'approve', 'feedback', 'reject']);
const TEXT_MAX = 2000;

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
 * 当前该让手机处理的待办：只有「等待审核」的交付与「等待回答」的提问。
 *
 * 形状刻意做成一张平表（id / type / at / payload），手机端映射成自己的待办模型即可；
 * id 稳定（review 带交付时间、question 带提问 id），长轮询指纹与客户端去重都靠它。
 */
function pendingTickets() {
  const db = store.get();
  const names = agentNameMap();
  const projects = new Map((db.projects || []).map((p) => [p.id, p]));
  const now = Date.now();
  const tickets = [];

  for (const r of db.requirements || []) {
    const proj = projects.get(r.projectId);
    if (proj && proj.archived) continue;
    const base = {
      requirementId: r.id,
      seq: r.seq === undefined ? null : r.seq,
      title: r.title || '',
      projectId: r.projectId,
      projectName: proj ? proj.name : ''
    };

    if (r.status === 'review' && r.completion && r.completion.at) {
      tickets.push({
        id: 'review:' + r.id + ':' + r.completion.at,
        type: 'review',
        from: 'server',
        at: r.completion.at,
        payload: {
          ...base,
          agent: r.completion.agent || '',
          agentName: names.get(r.completion.agent) || '',
          note: r.completion.note || '',
          completedAt: r.completion.at
        }
      });
    }

    if (r.status === 'doing') {
      for (const q of listQuestions(r)) {
        // 已过期的提问答了也没用：/ask 侧已按超时收尾
        if (q.expiresAt && Date.parse(q.expiresAt) <= now) continue;
        tickets.push({
          id: 'question:' + q.id,
          type: 'question',
          from: 'server',
          at: q.at || nowIso(),
          payload: {
            ...base,
            agent: q.agent || '',
            agentName: names.get(q.agent) || '',
            questionId: q.id,
            text: q.text || '',
            options: Array.isArray(q.options) ? q.options : [],
            default: q.default || '',
            expiresAt: q.expiresAt || null
          }
        });
      }
    }
  }

  return { tickets, count: tickets.length };
}

/** 与桌面端「提交并推送」同一口径：agent 单独提供的提交信息优先，老交付回落到「#序号 标题」 */
function approvalCommitMessage(r) {
  const supplied = String((r.completion && r.completion.commitMessage) || '').trim();
  return supplied || '#' + r.seq + ' ' + String(r.title || '').trim();
}

/**
 * 通过审核时补上「提交并推送」那段流程。
 * 有未提交改动才提交，随后推送；没有仓库 / 路径失效按「没有可提交的改动」处理，验收照常。
 * 提交失败直接抛出（答复不落库，手机端可见未生效）；推送失败只回报，不阻断验收。
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

    /** /remote/pending 与 /remote/wait 的唯一数据源 */
    remotePendingTickets: () => pendingTickets(),

    /**
     * 手机端的答复：answer 回答提问，approve / feedback / reject 走需求状态机。
     *
     * 通过时先按桌面端默认勾选的口径提交并推送工作区改动，提交失败则不落库。
     * 目标已不存在 / 已处理过时返回 applied:false 而不是抛错 —— 重发与迟到都是正常现象。
     */
    answerRemote: async ({ rid, decision, text, questionId }) => {
      const d = String(decision || '').trim();
      if (!DECISIONS.has(d)) fail('未知的答复类型：' + (d || '(空)'), 'bad_decision', 400);

      const body = String(text == null ? '' : text).trim();
      if (body.length > TEXT_MAX) fail('答复过长（上限 ' + TEXT_MAX + ' 字符）', 'bad_answer', 400);
      const qid = String(questionId || '').trim();
      if (d === 'answer') {
        if (!qid) fail('回答提问必须带 questionId', 'bad_answer', 400);
        if (!body) fail('回答内容不能为空', 'bad_answer', 400);
      }
      if (d === 'feedback' && !body) fail('打回要写清楚改什么', 'bad_answer', 400);

      const methods = getMethods();
      const r = (store.get().requirements || []).find((x) => x.id === rid);
      if (!r) return { applied: false, duplicate: false, reason: 'requirement_gone' };

      let commit = null;
      try {
        if (d === 'approve' && r.status === 'review') {
          commit = await commitAndPushApproved(methods, r);
        }
        if (d === 'answer') {
          methods.answerRequirement({ rid, qid, text: body });
        } else {
          methods.setRequirementStatus({
            rid,
            status: d === 'approve' ? 'done' : d === 'feedback' ? 'doing' : 'rejected',
            feedback: d === 'feedback' ? body : undefined
          });
        }
      } catch (e) {
        // 没落库就不能算完成：手机端可以重试，状态变化后仍有生效机会
        return {
          applied: false,
          duplicate: false,
          reason: (e && e.code) || 'not_applicable',
          message: (e && e.message) || ''
        };
      }
      return { applied: true, duplicate: false, commit };
    }
  };
}

module.exports = { createMobile, DEFAULTS, readSettings, pendingTickets };

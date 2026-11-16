'use strict';

const crypto = require('crypto');
const store = require('../store');
const eventLog = require('../event-log');
const { actor } = eventLog;
const { nowIso } = require('./dates');
const { readSettings: readMobileSettings } = require('./mobile');

/**
 * 远程访问的门禁：局域网 / 公网进来说话时唯一要出示的凭据。
 *
 * 开关只有一个 —— 手机端通信。开着，远程面就可用（地址与令牌随心跳下发）；关着，整条链路关闭，
 * 连令牌都不认。不再单独提供「远程访问」开关：两个开关必然会被调成互相矛盾的状态，
 * 而它们真正的含义永远是同一件事（要不要让手机连进来）。
 *
 * token 与隧道地址解耦：隧道重建、地址变化都不需要换令牌；怀疑泄漏时单独轮换即可。
 */

/** base64url 的 24 字节 = 32 字符，足够暴力破解不现实，又便于贴进配置与手抄 */
const TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;

function newToken() {
  return crypto.randomBytes(24).toString('base64url');
}

/** 老库没有 remote 块、或 token 被写坏时补齐；只在真改动时落盘 */
function ensureRemote(db) {
  if (!db.settings || typeof db.settings !== 'object') db.settings = {};
  if (!db.settings.remote || typeof db.settings.remote !== 'object' || Array.isArray(db.settings.remote)) {
    db.settings.remote = { token: newToken(), createdAt: nowIso() };
    store.save();
    return db.settings.remote;
  }

  const r = db.settings.remote;
  if (!TOKEN_RE.test(String(r.token || ''))) {
    r.token = newToken();
    r.createdAt = nowIso();
    store.save();
  }
  return r;
}

function snapshot(r) {
  return {
    token: r.token,
    createdAt: r.createdAt || null,
    rotatedAt: r.rotatedAt || null
  };
}

/** 定长比较，避免按字符提前返回泄漏前缀 */
function sameToken(a, b) {
  const x = Buffer.from(String(a || ''), 'utf8');
  const y = Buffer.from(String(b || ''), 'utf8');
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

function unauthorized(message) {
  const e = new Error(message);
  e.code = 'remote_unauthorized';
  e.status = 401;
  throw e;
}

function createRemote() {
  return {
    /** 设置弹窗与接入点广播共用同一份快照 */
    remoteInfo: () => ({ remote: snapshot(ensureRemote(store.get())) }),

    /** 怀疑泄漏时换一把：隧道不用重建，手机端下一轮心跳就拿到新令牌 */
    remoteRotateToken: () => {
      const db = store.get();
      const r = ensureRemote(db);
      const before = snapshot(r);
      r.token = newToken();
      r.rotatedAt = nowIso();
      if (!r.createdAt) r.createdAt = r.rotatedAt;
      store.save();
      eventLog.append({
        type: 'settings.changed',
        projectId: null,
        actor: actor.user(),
        data: { remote: { before, after: snapshot(r) } }
      });
      return { remote: snapshot(r) };
    },

    /**
     * 远程请求的准入校验。成功回 { rotatedAt }，失败按 401 抛出。
     * 手机端通信关着时连 token 都不认 —— 关掉就该彻底进不来，而不是「只是不广播地址」。
     */
    remoteAuth: ({ token }) => {
      const db = store.get();
      if (!readMobileSettings(db).enabled) unauthorized('手机端通信未开启');
      const r = ensureRemote(db);
      if (!sameToken(token, r.token)) unauthorized('访问令牌不正确');
      return { rotatedAt: r.rotatedAt || null };
    }
  };
}

module.exports = { createRemote, TOKEN_RE, ensureRemote };

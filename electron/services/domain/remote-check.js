'use strict';

const fs = require('fs');
const store = require('../store');
const git = require('../git');
const { PROBE_TIMEOUT } = require('./constants');
const { readGitSettings } = require('./settings');

/**
 * 远程位置巡检：「这个项目落后上游几个提交」。
 *
 * 为什么要单独一个服务，而不是塞进 gitSummary：
 * gitSummary 每 30 秒被侧栏轮询一次，而它现在只跑本地 `git status`（零网络）。
 * 若在它里面直接 fetch，一次弱网就能把整条侧栏拖住，而且会在没有新提交时
 * 反复为「什么都没变」付网络代价。所以这里把「联网抓取」与「读汇总」拆开：
 *   - 本模块按固定间隔在后台跑 fetch + behindCount，把结果放进进程内 cache；
 *   - gitSummary 只读 cache，永不阻塞、永不联网。
 * 代价是数字最多滞后一个间隔（见 CHECK_INTERVAL），这一点在界面的 tooltip 里有交代。
 */

/** 后台检查间隔：fetch 是网络操作，比侧栏 30s 的本地上限宽得多 */
const CHECK_INTERVAL = 10 * 60 * 1000;

/** 同时联网的仓库数：fetch 比 status 重，两个就够，别把网络与 git 进程打满 */
const CONCURRENCY = 2;

/** projectId → { behind, upstream, at, fetched, error }；没有条目 = 还没检查过或不是仓库 */
const cache = new Map();

/** 同一时刻只跑一轮：定时器与「立即检查」可能撞车，复用到同一份结果 */
let inflight = null;
let lastRun = null;

function now() {
  return new Date().toISOString();
}

/** 单个项目的远程位置：抓一次再算，抓取失败就退回本地已知的引用并记下原因 */
async function checkOne(project) {
  const base = { projectId: project.id, name: project.name };

  // 目录被移走 / 删掉的项目直接从结果里摘掉：界面上不该为一个不存在的目录保留提示
  if (!fs.existsSync(project.path)) {
    cache.delete(project.id);
    return { ...base, behind: 0, upstream: null, skipped: 'path_missing' };
  }

  // 网络盘上的仓库可能把 rev-parse 挂住，探测给超时，超时按「不是仓库」跳过
  const probe = await git.isRepo(project.path, { timeout: PROBE_TIMEOUT });
  if (probe.unavailable) return { ...base, behind: 0, upstream: null, unavailable: true };
  if (!probe.repo) {
    cache.delete(project.id);
    return { ...base, behind: 0, upstream: null, skipped: 'not_repo' };
  }

  const fetched = await git.fetchRemote(project.path);
  // 抓取失败也要继续算：本地引用虽然陈旧，但「落后 3 个」这种结论通常仍然成立，
  // 只是需要在界面上标注「上次检查失败」，而不是把灯直接灭掉（那会假装一切正常）。
  const b = await git.behindCount(project.path);
  if (b.unavailable) return { ...base, behind: 0, upstream: null, unavailable: true };

  const entry = {
    behind: b.behind || 0,
    upstream: b.upstream || null,
    hasUpstream: !!b.hasUpstream,
    at: now(),
    fetched: !!fetched.ok,
    // 凭据失效：界面据此提示「Git 需要登录」，用户处理完登录后重新检查即可覆盖
    auth: !!fetched.auth,
    error: fetched.ok ? null : fetched.error
  };
  cache.set(project.id, entry);
  return { ...base, ...entry };
}

/** 限并发跑完给定项目，保持与传入顺序一致的结果列表 */
async function runAll(projects) {
  const out = new Array(projects.length);
  let cursor = 0;

  async function worker() {
    for (;;) {
      const i = cursor;
      cursor += 1;
      if (i >= projects.length) return;
      try {
        out[i] = await checkOne(projects[i]);
      } catch (e) {
        const p = projects[i];
        out[i] = { projectId: p.id, name: p.name, behind: 0, upstream: null, error: (e && e.message) || '内部错误' };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, projects.length) }, worker));
  return out;
}

function summarize(items, trigger) {
  return {
    trigger,
    finishedAt: now(),
    total: items.length,
    /** 有未拉取提交的项目数：界面上的提示点依据 */
    behind: items.filter((x) => x.behind > 0).length,
    unavailable: items.some((x) => x.unavailable),
    items
  };
}

/** 缓存 → 列表：名字以 db 为准（项目可能改过名，缓存里的是上一轮的旧名） */
function cacheList() {
  const projects = store.get().projects.filter((p) => !p.archived);
  const items = [];
  for (const p of projects) {
    const c = cache.get(p.id);
    if (!c) continue;
    items.push({ projectId: p.id, name: p.name, ...c });
  }
  return items;
}

function createRemoteCheck() {
  return {
    /**
     * 跑一轮远程检查（主进程定时触发，或界面点「立即检查」）。
     * 总开关关闭时直接返回 skipped，不碰 git、不联网；
     * force 是给手动入口用的：手动点下去就说明此刻想联网，不受总开关拦截。
     */
    remoteCheckNow: ({ trigger, force } = {}) => {
      if (inflight) return inflight;

      const db = store.get();
      if (!force && !readGitSettings(db).remoteCheck) {
        return Promise.resolve({ trigger: trigger || 'timer', skipped: 'disabled', items: [] });
      }

      const projects = db.projects.filter((p) => !p.archived);
      inflight = runAll(projects)
        .then((items) => {
          lastRun = summarize(items, trigger || 'timer');
          return lastRun;
        })
        .finally(() => {
          inflight = null;
        });
      return inflight;
    },

    /** 巡检状态：间隔、是否在跑、上一轮结果、当前缓存里每个项目的落后数 */
    remoteCheckStatus: () => ({
      intervalMs: CHECK_INTERVAL,
      enabled: readGitSettings(store.get()).remoteCheck,
      checking: !!inflight,
      last: lastRun,
      items: cacheList()
    })
  };
}

/** gitSummary 用：只读缓存，绝不触发网络 */
function readRemoteCache(projectId) {
  return cache.get(projectId);
}

/**
 * 进修改记录页时还要不要再联网抓一次。
 *
 * 判据与巡检间隔同口径：缓存里的数字最多滞后一个 CHECK_INTERVAL，这个前提界面上
 * （tooltip）已经交代过，页面就不该为同一个数字再付一次网络代价 —— 否则巡检跑着、
 * 每个页面又各自 fetch 一遍，一次弱网就能让进页多等好几秒。
 *
 * 只认「上一轮抓取成功」的条目：上次失败说明数字确实可能过期，该重试。
 * 手动点刷新走 force，不吃这条捷径。
 */
function isRemoteFresh(projectId) {
  const c = cache.get(projectId);
  if (!c || !c.fetched) return false;
  const at = Date.parse(c.at);
  return Number.isFinite(at) && Date.now() - at < CHECK_INTERVAL;
}

/**
 * 别处已经抓过一次远程（修改记录页进页时的静默 fetch），把它的结果直接落缓存，
 * 免得下一轮巡检再为同一个数字联网一次。
 * 没有上游的项目也照样落条目：这样 gitSummary 的 checked 才如实反映「检查过了」，
 * 而不是让人以为是没检查。
 */
function noteRemote(projectId, data) {
  if (!data) return;
  cache.set(projectId, {
    behind: data.behind || 0,
    upstream: data.upstream || null,
    hasUpstream: !!data.hasUpstream,
    at: now(),
    fetched: true,
    error: null
  });
}

/**
 * 修改记录页的静默 fetch 撞上凭据失效时调用：把「需要登录」落进缓存，
 * 侧栏与总览的轮询（gitSummary）就能在下一拍把提示条亮出来，
 * 不必等下一轮后台巡检。条目按未成功抓取记录（fetched=false），重新进页仍会再试一次。
 */
function noteAuthError(projectId, message) {
  const prev = cache.get(projectId);
  cache.set(projectId, {
    behind: prev ? prev.behind || 0 : 0,
    upstream: prev ? prev.upstream || null : null,
    hasUpstream: prev ? !!prev.hasUpstream : false,
    at: now(),
    fetched: false,
    auth: true,
    error: message || '需要登录远程仓库'
  });
}

/**
 * 刚做完一次快进拉取：behind 必为 0，直接落缓存。
 * 不能等下一轮巡检 —— 否则灯会亮满一个间隔，看着像没拉成功。
 */
function notePulled(projectId) {
  const prev = cache.get(projectId);
  if (!prev) return;
  cache.set(projectId, { ...prev, behind: 0, at: now() });
}

/** 推送 / 提交后远程位置可能变了（别人也推了）：重查这一个项目，失败静默 */
function recheck(project) {
  return checkOne(project).catch(() => null);
}

module.exports = {
  createRemoteCheck,
  readRemoteCache,
  isRemoteFresh,
  noteRemote,
  noteAuthError,
  notePulled,
  recheck,
  CHECK_INTERVAL
};

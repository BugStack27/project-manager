'use strict';

const fs = require('fs');
const store = require('../store');
const git = require('../git');
const { STATS_MAX_DAYS, PROBE_TIMEOUT } = require('./constants');
const { fail } = require('./errors');
const { assertDay } = require('./validators');
const { localDay, listDays } = require('./dates');
const { readRemoteCache } = require('./remote-check');

function createStats() {
  return {
    /** 全项目工作区状态汇总（侧栏角标，并发 4）；远程落后数只读缓存，不联网 */
    gitSummary: async () => {
      const list = store.get().projects.filter((p) => !p.archived);
      const out = new Array(list.length);
      let unavailable = false;
      let cursor = 0;
      const CONCURRENCY = 4;

      async function worker() {
        for (;;) {
          const i = cursor;
          cursor += 1;
          if (i >= list.length) return;
          const p = list[i];
          const r = await git.statusCount(p.path);
          if (r.unavailable) unavailable = true;
          // 远程位置来自后台巡检的缓存（remote-check），为空表示这一轮还没检查过：
          // 此时 behind 一律报 0，并由 checked 为 false 让界面「不知道」而不是「已是最新」。
          const rc = readRemoteCache(p.id);
          out[i] = {
            id: p.id,
            name: p.name,
            isRepo: !!r.isRepo,
            /** 目录被移动 / 删除：界面要显示「路径失效」并给改路径入口，而不是「非 git 仓库」 */
            pathMissing: !!r.pathMissing,
            dirty: !!r.dirty,
            files: r.files || 0,
            sample: r.sample || [],
            behind: rc ? rc.behind || 0 : 0,
            upstream: rc ? rc.upstream || null : null,
            checked: !!rc,
            remoteAt: rc ? rc.at : null,
            /** 抓取失败但仍用陈旧引用算出的数字：界面要标明可能过期 */
            remoteError: rc ? rc.error || null : null,
            /** 远程凭据失效：界面据此提示「Git 需要登录」并给用户处理入口 */
            remoteAuth: !!(rc && rc.auth)
          };
        }
      }

      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, list.length) }, () => worker()));
      if (unavailable) fail('未检测到 git 可执行程序', 'git_unavailable', 501);

      const projects = out.filter(Boolean);
      return {
        total: projects.length,
        repoCount: projects.filter((p) => p.isRepo).length,
        dirtyCount: projects.filter((p) => p.dirty).length,
        /** 有未拉取提交的项目数与提交总数：左下角 / 总览的提示点用 */
        behindCount: projects.filter((p) => p.behind > 0).length,
        behindCommits: projects.reduce((n, p) => n + (p.behind || 0), 0),
        projects
      };
    },

    /**
     * 跨项目统计：git 日活动 + 需求收尾计数（按 updatedAt 近似归日），排除归档项目。
     * 单个项目读不到 git（超时 / 报错）只标记 error，不拖垮其他项目。
     */
    gitActivity: async ({ since, until }) => {
      const from = assertDay(since, 'since');
      const to = assertDay(until, 'until');
      if (from > to) fail('起始日期不能晚于结束日期', 'bad_range', 400);
      const span =
        Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000) + 1;
      if (span > STATS_MAX_DAYS) fail('统计跨度不能超过 ' + STATS_MAX_DAYS + ' 天', 'range_too_large', 400);

      const dates = listDays(from, to);
      const db = store.get();
      const list = db.projects.filter((p) => !p.archived);
      const ids = new Set(list.map((p) => p.id));

      const reqByProject = new Map();
      for (const r of db.requirements) {
        if (!ids.has(r.projectId) || (r.status !== 'done' && r.status !== 'rejected')) continue;
        const day = localDay(r.updatedAt || r.createdAt);
        if (day < from || day > to) continue;
        let byDay = reqByProject.get(r.projectId);
        if (!byDay) reqByProject.set(r.projectId, (byDay = new Map()));
        const bucket = byDay.get(day) || { done: 0, rejected: 0 };
        bucket[r.status] += 1;
        byDay.set(day, bucket);
      }

      const out = new Array(list.length);
      let unavailable = false;
      let cursor = 0;
      const CONCURRENCY = 4;

      async function worker() {
        for (;;) {
          const i = cursor;
          cursor += 1;
          if (i >= list.length) return;
          const p = list[i];
          const reqs = reqByProject.get(p.id);
          const buildDays = (code) =>
            dates.map((date) => {
              const c = code && code.get(date);
              const q = reqs && reqs.get(date);
              return {
                date,
                commits: c ? c.commits : 0,
                added: c ? c.added : 0,
                removed: c ? c.removed : 0,
                done: q ? q.done : 0,
                rejected: q ? q.rejected : 0
              };
            });

          let branch = null;
          let isRepo = false;
          let error = false;
          let truncated = false;
          let code = null;
          try {
            // 目录不存在时 spawn 报 ENOENT，会被 runGit 当成「没装 git」；先判存在，只降级该项目
            // 用 probe 而不是 isRepo：它顺带把路径前缀带回来，activity 就不必再跑一次 rev-parse
            const probe = fs.existsSync(p.path) ? await git.probe(p.path, { timeout: PROBE_TIMEOUT }) : null;
            if (!probe || probe.timedOut) {
              error = true;
            } else if (probe.unavailable) {
              unavailable = true;
            } else if (probe.repo) {
              isRepo = true;
              const [act, br] = await Promise.all([
                git.activity(p.path, { since: from, until: to, prefix: probe.prefix }),
                git.branch(p.path, { timeout: PROBE_TIMEOUT })
              ]);
              branch = br;
              truncated = act.truncated;
              code = new Map(act.days.map((d) => [d.date, d]));
            }
          } catch (e) {
            if (e && e.code === 'git_unavailable') unavailable = true;
            error = true;
          }
          out[i] = { id: p.id, name: p.name, branch, isRepo, error, truncated, days: buildDays(code) };
        }
      }

      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, list.length) }, () => worker()));
      if (unavailable) fail('未检测到 git 可执行程序', 'git_unavailable', 501);
      return { since: from, until: to, projects: out.filter(Boolean) };
    }
  };
}

module.exports = { createStats };

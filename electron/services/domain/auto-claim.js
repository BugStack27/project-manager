'use strict';

/**
 * 自动派发：给定时运行的执行 agent 一个「下一件该做什么」的入口（GET /next）。
 *
 * 语义是「取即认领」：一次调用完成选取 + 认领。两段异步夹一段同步：
 *   1. planDispatch（同步读库）→ 候选 / 阻断 / 自己名下在做的
 *   2. git status（异步，只跑候选项）→ 未提交改动
 *   3. 同步临界区：重新读库判定一次，然后写库认领
 * 第 3 段从判定到写库之间没有 await，Node 单线程下两个请求不可能同时通过校验，
 * 所以这里不需要额外的互斥锁，也不会出现两个 agent 认领同一条。
 *
 * 为什么只看「候选项目」的工作区：`/next` 一轮只查一次候选，长等待期间也只按
 * 30 秒兜底重查；全量扫所有项目的 git status（gitSummary 那套每 30s 跑一次已经很贵）没必要 ——
 * doing / review / 没有 todo 的项目本来就派不出去，不必为它们起 git 进程。
 */

const store = require('../store');
const git = require('../git');
const { PROBE_TIMEOUT } = require('./constants');
const { fail } = require('./errors');
const { assertAgent } = require('./validators');
const { findReq } = require('./lookups');
const { reqView, projectExtras } = require('./views');
const { planDispatch, resolveDispatch } = require('./claim-gate');
const { claimLocked, expireStaleQuestions } = require('./requirements');
const {
  NEXT_TIMEOUT,
  NEXT_MAX,
  NEXT_POLL,
  waitForChange
} = require('./next-waiter');

/** 同时检查的仓库数：与 gitSummary 一致，别把磁盘与 git 进程打满 */
const CONCURRENCY = 4;

/** 单个项目的 git status 超时：网络盘上不能让一次长等待里的重查无限挂住 */
const STATUS_TIMEOUT = PROBE_TIMEOUT;

/** 超时视为「无法证明干净」，由闸门记 git_timeout 阻断，而不是放行 */
function withTimeout(promise, ms) {
  let timer = null;
  const guard = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), ms);
  });
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
}

/** 并发检查给定项目的工作区；返回 Map(projectId → statusCount 结果) 与「git 不可用」标记 */
async function checkDirty(projectIds) {
  const checks = new Map();
  const projects = store.get().projects;
  let unavailable = false;
  let cursor = 0;

  async function worker() {
    for (;;) {
      const i = cursor++;
      if (i >= projectIds.length) return;
      const p = projects.find((x) => x.id === projectIds[i]);
      if (!p) continue;
      let r;
      try {
        r = await withTimeout(git.statusCount(p.path), STATUS_TIMEOUT);
      } catch (_) {
        r = { timedOut: true };
      }
      if (r.unavailable) unavailable = true;
      else checks.set(p.id, r);
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, projectIds.length) }, worker));
  return { checks, unavailable };
}

function viewOf(project, r, resumed) {
  const extras = projectExtras(project);
  return {
    agent: r.claim.agent,
    requirement: reqView(r),
    // 扩展信息平铺在 project 里，agent 直接读 project.rules / project.env / project.links；
    // 规则只下发启用的，禁用项留给界面，不干扰 agent
    project: {
      id: project.id,
      name: project.name,
      path: project.path,
      ...extras,
      rules: extras.rules.filter((x) => x.enabled)
    },
    claim: { agent: r.claim.agent, at: r.claim.at },
    resumed: !!resumed
  };
}

/**
 * 续做响应。顺手把「没有等待者的老提问」清掉（TTL 自愈）：否则应用重启 / 客户端断开后
 * 这条需求会永远停在「待回答」，agent 按手册也只能一直结束本轮。
 */
function resumeView(project, r, blocked, scanned) {
  if (expireStaleQuestions(r)) {
    return { ...viewOf(project, r, true), blocked, scanned, expiredQuestion: true };
  }
  return { ...viewOf(project, r, true), blocked, scanned };
}

/**
 * 消费「解锁」通行证：一次授权只放行一轮。
 *
 * 只能在 planDispatch 之后、任何 await 之前调用 —— 两个并发请求读到的 unlock 若都还在，
 * 它们会同时把同一条任务领走，那是解锁机制唯一能失效的方式。当前两个调用点
 * （takeNext 的入口分支、同步临界区里）都满足这一点，别把判断挪到异步之后。
 */
function consumeUnlock(r) {
  if (!r.unlock) return r;
  delete r.unlock;
  store.save();
  return r;
}

/**
 * 取一次：planDispatch → git 检查 → 同步临界区认领。
 * `who` 由调用方校验过，这里不再判一次，避免两处规则漂移。
 */
async function takeNext(who) {
  const plan = planDispatch(store.get(), who);
  if (plan.resume) {
    // 自己名下已有在做任务、且用户签过解锁：还给它续做而不是再抢一条（通行证当场销掉）
    return resumeView(plan.resume.project, consumeUnlock(plan.resume.requirement), plan.blocked, 0);
  }
  if (!plan.candidates.length) {
    return { agent: who, requirement: null, reason: 'no_task', blocked: plan.blocked, scanned: 0 };
  }

  const { checks, unavailable } = await checkDirty(plan.candidates.map((c) => c.project.id));
  // 与 gitSummary 同口径：git 不可用是环境问题，不能当成「都干净」
  if (unavailable) fail('未检测到 git 可执行程序', 'git_unavailable', 501);

  // 同步临界区（到写库之间没有 await）
  const fresh = planDispatch(store.get(), who);
  if (fresh.resume) {
    return resumeView(fresh.resume.project, consumeUnlock(fresh.resume.requirement), fresh.blocked, checks.size);
  }
  const { pick, blocked } = resolveDispatch(fresh, checks);
  if (!pick) return { agent: who, requirement: null, reason: 'no_task', blocked, scanned: checks.size };

  const r = claimLocked(findReq(pick.requirement.id), who, 'next');
  return { ...viewOf(pick.project, r, false), blocked, scanned: checks.size };
}

/**
 * `wait` 参数：秒为单位，缺省 5 分钟；0 表示只查一次（等价于旧的 `/next` 行为）。
 * 非法值回落默认，避免因为调度器写错单位就把请求挂死。
 */
function waitOf(raw) {
  if (raw === undefined || raw === null || raw === '') return NEXT_TIMEOUT;
  const sec = Number(raw);
  if (!Number.isFinite(sec)) return NEXT_TIMEOUT;
  return Math.min(Math.max(0, sec * 1000), NEXT_MAX);
}

function createAutoClaim() {
  return {
    /**
     * 取下一个可认领需求并直接认领（一次性）。
     * 返回 requirement: null 表示这一轮没有活（原因在 blocked 里）。
     */
    claimNextRequirement: ({ agent }) => takeNext(assertAgent(agent)),

    /**
     * 长轮询版取活：没有活时在服务端最多等 `wait` 秒（默认 5 分钟）。
     * 任何可能让项目重新可派发的写操作都会唤醒它；超时返回最后一次的 no_task。
     * 多个 agent 同时被唤醒时，只有同步临界区里的第一个能认领，其余继续等下一件。
     */
    nextRequirement: async ({ agent, wait }) => {
      const who = assertAgent(agent);
      const limit = waitOf(wait);
      const startedAt = Date.now();
      const deadline = startedAt + limit;
      let last = null;
      for (;;) {
        last = await takeNext(who);
        if (last.requirement) return last;
        const remain = deadline - Date.now();
        if (remain <= 0) return { ...last, waitedMs: Date.now() - startedAt };
        await waitForChange(Math.min(remain, NEXT_POLL));
      }
    }
  };
}

module.exports = { createAutoClaim };
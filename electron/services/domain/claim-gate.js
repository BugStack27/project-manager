'use strict';

/**
 * 派发闸门：决定「这一轮该把哪条需求交给 agent」。
 *
 * 同步、不写库，只做一次 statSync —— git 检查由调用方（auto-claim）在两段之间补上：
 * 那一段是异步的，也是最贵的，只有「可能被选中」的项目才值得跑。
 *
 * 三条阻断只作用于自动派发入口（GET /next），不约束按 taskId 的 GET /claim：
 *   doing  项目里有进行中的任务 —— 多 agent 不同时改同一个项目
 *   review 项目里有待审核交付 —— 用户还没验收，先别开新活
 *   dirty  项目目录内有未提交改动 —— agent 的改动无法与用户的改动区分
 *
 * 判据只认状态与工作区，不看需求条数：一个项目可以挂多条未完成需求（名额限制已取消），
 * 但同一时刻只派一条。
 */

const fs = require('fs');
const { RELEASE_COOLDOWN } = require('./constants');

/**
 * 阻断原因码（/next 的 blocked[].reasons 是对外契约，发布后不要改名）：
 *   doing / review / dirty / path_missing / git_timeout / cooldown / locked
 * `locked` 只对认领人自己出现：项目被他自己那条 doing 锁着，等他点「解锁」才能继续。
 * 中文说明在 doc/auto-dispatch.md 与 prompts/worker.md 里，代码里不带文案，避免两处措辞漂移。
 */

/** 需求顺序：创建早的先做（FIFO），同一时刻按序号兜底 */
function byCreatedAt(a, b) {
  return String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || (a.seq || 0) - (b.seq || 0);
}

/** 阻断条目里只带定位信息：agent 的日志与用户的排查都只需要「哪个项目、哪条需求、为什么」 */
function entryOf(project, requirement, reasons, files) {
  return {
    projectId: project.id,
    name: project.name,
    reasons,
    files: files || 0,
    requirement: { id: requirement.id, seq: requirement.seq, title: requirement.title }
  };
}

/** 目录可用才派得出去：路径是文件、被删、被移都算 path_missing，不试图修 */
function usableDir(project) {
  try {
    return fs.statSync(project.path).isDirectory();
  } catch (_) {
    return false;
  }
}

/**
 * 刚被这个 agent 释放过的任务先别还给它：
 * 释放意味着「做不下去」，立刻再取到就是同一轮原地打转（每分钟烧一次）。
 * 冷却期内换给别的 agent 或等用户处理；到期后仍可重试。
 */
function releasedRecently(r, agent, nowMs) {
  const rel = r.release;
  if (!rel || rel.agent !== agent) return false;
  const at = Date.parse(rel.at || '');
  return Number.isFinite(at) && nowMs - at < RELEASE_COOLDOWN;
}

/**
 * 第一段：只看库，算出「自己名下在做的」「可派的候选」「已被阻断的」。
 *
 * @param {{projects: object[], requirements: object[]}} db
 * @param {string} agent
 * @param {number} [nowMs]
 * @returns {{resume: {project, requirement}|null, candidates: {project, requirement}[], blocked: object[]}}
 */
function planDispatch(db, agent, nowMs) {
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const projects = (db.projects || []).filter((p) => !p.archived);
  const grouped = new Map();
  for (const r of db.requirements || []) {
    const list = grouped.get(r.projectId);
    if (list) list.push(r);
    else grouped.set(r.projectId, [r]);
  }

  // 定时任务每轮都是新会话、不共享记忆：只有把「自己认领过还没交付的」还给它，中断后才能续做。
  //
  // 但这条「续做」与「另一个进程还在改同一条」在库里长得完全一样（都是 doing + claim.agent = 我），
  // 服务端没有「它是否还活着」的证据，所以续做改成由用户授权：项目里有 doing 就等于锁着，
  // 谁都不派（含认领人自己）；用户点「解锁」才对这条需求签一张一次性通行证（r.unlock），
  // 下一轮按 resume 还给本人，取出即销（见 auto-claim 的消费点）。
  // 锁的粒度是项目，所以被锁的项目停摆，agent 还能去别的项目 —— 一条坏任务不该饿死整台 agent。
  let resume = null;
  for (const p of projects) {
    for (const r of grouped.get(p.id) || []) {
      if (r.status !== 'doing' || !r.claim || r.claim.agent !== agent) continue;
      if (!resume || byCreatedAt(r, resume.requirement) < 0) resume = { project: p, requirement: r };
    }
  }
  if (resume && resume.requirement.unlock) return { resume, candidates: [], blocked: [] };
  // 锁着不等于没活：这里只记下来，后面继续算别的项目的候选（短路会让整台 agent 卡在这一条上）
  const locked = resume ? entryOf(resume.project, resume.requirement, ['locked'], 0) : null;

  const candidates = [];
  const blocked = [];
  for (const p of projects) {
    const reqs = grouped.get(p.id) || [];
    // 只取 status === 'todo'：候选池（candidate）是「人还没确认」的想法，天然不在派发口径里，
    // 也不会进 blocked —— 对 agent 来说它根本不存在，不该解释「为什么没派给我」
    const todos = reqs.filter((r) => r.status === 'todo' && !r.claim).sort(byCreatedAt);
    // 没有 todo 的项目即使被阻断也不报：blocked 只用来解释「为什么有活却不派」
    if (!todos.length) continue;

    const open = todos.filter((r) => !releasedRecently(r, agent, now));
    const reasons = [];
    if (reqs.some((r) => r.status === 'doing')) reasons.push('doing');
    if (reqs.some((r) => r.status === 'review')) reasons.push('review');
    if (!usableDir(p)) reasons.push('path_missing');
    if (!open.length) reasons.push('cooldown');

    if (reasons.length) blocked.push(entryOf(p, open[0] || todos[0], reasons, 0));
    else candidates.push({ project: p, requirement: open[0] });
  }

  // 被锁的项目必须出现在 blocked 里，而且不能靠上面那圈 todo 循环兜底：锁的来源是那条 doing，
  // 项目里往往没有 todo 可列，循环会 continue 过去，agent 就只能看到「没活」而不知道原因。
  if (locked) {
    const hit = blocked.find((b) => b.projectId === locked.projectId);
    if (hit) {
      if (!hit.reasons.includes('locked')) hit.reasons.push('locked');
    } else blocked.push(locked);
  }

  candidates.sort((a, b) => byCreatedAt(a.requirement, b.requirement));
  return { resume: null, candidates, blocked };
}

/**
 * 第二段：把 git 检查结果并进闸门，给出最终该派哪一条。
 *
 * 没有检查结果的候选（await 期间新出现的需求 / 新项目）一律跳过：宁可不派，
 * 也不拿没检查过工作区的项目开工 —— 下一轮自然会带上它。
 *
 * @param {object} plan planDispatch() 的返回值（必须是没有 resume 的那一版）
 * @param {Map<string, {dirty?: boolean, pathMissing?: boolean, files?: number, timedOut?: boolean}>} checks
 */
function resolveDispatch(plan, checks) {
  const blocked = plan.blocked.slice();
  let pick = null;
  // 走完全部候选：命中第一个干净的就定下来，但 blocked 仍要完整 —— 它同时是给人和 agent
  // 的解释，「为什么没派给我」不能取决于排在前面哪个项目先被选中。
  for (const c of plan.candidates) {
    const chk = checks.get(c.project.id);
    if (!chk) continue;
    // 目录在 await 期间没了 / 路径其实是文件：statusCount 会给出 pathMissing，按阻断处理
    if (chk.pathMissing) {
      blocked.push(entryOf(c.project, c.requirement, ['path_missing'], 0));
      continue;
    }
    if (chk.timedOut) {
      blocked.push(entryOf(c.project, c.requirement, ['git_timeout'], 0));
      continue;
    }
    // 非 git 仓库没有「未提交」这个概念，按干净处理；脏就是脏，不看是不是本项目的子目录
    if (chk.dirty) {
      blocked.push(entryOf(c.project, c.requirement, ['dirty'], chk.files));
      continue;
    }
    if (!pick) pick = { project: c.project, requirement: c.requirement };
  }
  return { pick, blocked };
}

module.exports = { planDispatch, resolveDispatch };

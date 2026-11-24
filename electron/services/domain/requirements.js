'use strict';

const store = require('../store');
const archive = require('../archive');
const eventLog = require('../event-log');
const { actor } = eventLog;
const { CANDIDATE, STATUSES, UNFINISHED } = require('./constants');
const { fail, claimConflict } = require('./errors');
const { nowIso } = require('./dates');
const { assertTaskId, assertAgent, assertEncoded } = require('./validators');
const { findProject, findReq, unfinishedOf } = require('./lookups');
const { reqView } = require('./views');
const { ASK_TIMEOUT, ASK_TTL, waitFor, settle, settleAll } = require('./ask-waiter');
const {
  MAX_QUESTIONS,
  listQuestions,
  countQuestions,
  addQuestion,
  takeQuestion,
  clearQuestions
} = require('./questions');
const {
  REVIEW_TIMEOUT,
  waitFor: waitForReview,
  settle: settleReview
} = require('./review-waiter');
const { bump: notifyTaskAvailable } = require('./next-waiter');

function snapshot(r) {
  const p = findProject(r.projectId);
  return { projectName: p.name, seq: r.seq, title: r.title };
}

/**
 * 认领的唯一写入点：写 claim、todo → doing、记事件。
 * 调用方负责先做校验（终态、他人已认领）；这里不再判一次，避免两处规则漂移。
 * via 只进事件数据：事件流要能区分「手动认领」与「自动派发」。
 */
function claimLocked(r, who, via) {
  const at = nowIso();
  // 先取项目再写库：项目记录缺失时不能留下「claim 已落盘、事件没写」的半截状态
  const p = findProject(r.projectId);
  r.claim = { agent: who, at };
  // 新认领即新的授权：上一轮遗留的解锁通行证不能顺延到这一次（/claim 手动认领也算授权）
  delete r.unlock;
  if (r.status === 'todo') r.status = 'doing';
  r.updatedAt = at;
  store.save();
  eventLog.append({
    type: 'requirement.claimed',
    projectId: r.projectId,
    requirementId: r.id,
    actor: actor.agent(who),
    data: { projectName: p.name, seq: r.seq, title: r.title, agent: who, ...(via ? { via } : {}) }
  });
  return r;
}

/** 往返消息最多保留的条数：超出丢最早的，避免长生命周期需求把 db.json 与 /next 的回传撑大 */
const THREAD_MAX = 50;

/** 需求上保留的关联提交条数：同一需求可能多轮交付，留最近 20 条足够回看 */
const COMMITS_MAX = 20;

/**
 * 提问可以带候选（agent 说「这几个方案选一个」），用户在界面上点一下就填进回答框。
 * 只做形状约束：字符串数组、去空去重、最多 5 条、单条 120 字符——候选是给眼睛看的短句，
 * 长文应该写在 question 正文里。
 */
const MAX_OPTIONS = 5;
const OPTION_MAX = 120;

function normalizeOptions(input) {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) fail('候选必须是字符串数组', 'bad_question', 400);
  const out = [];
  for (const raw of input) {
    if (typeof raw !== 'string') fail('候选必须是字符串数组', 'bad_question', 400);
    const s = assertEncoded(raw.trim(), '候选');
    if (!s) continue;
    if (s.length > OPTION_MAX) fail('单个候选过长（上限 ' + OPTION_MAX + ' 字符）', 'bad_question', 400);
    if (!out.includes(s)) out.push(s);
  }
  if (out.length > MAX_OPTIONS) fail('候选最多 ' + MAX_OPTIONS + ' 条', 'bad_question', 400);
  return out;
}

/**
 * 追加一条往返消息（需求上的对话记录）。
 * 只记「有来有回」的节点：交付、打回、通过、拒绝、提问、回答、释放。
 * 文本长度由各自入口校验；这里只管顺序与上限。
 * `qid` 只出现在提问 / 回答 / 兜底 / 作废四类消息上：同一条需求可以有多条提问，
 * 界面靠它把「哪条回答对应哪条提问」对上，而不是靠时间戳猜。
 */
function pushMessage(r, msg) {
  const list = Array.isArray(r.thread) ? r.thread : (r.thread = []);
  list.push({
    id: store.uid('m'),
    at: msg.at || nowIso(),
    role: msg.role,
    kind: msg.kind,
    agent: msg.agent || null,
    text: String(msg.text || ''),
    ...(msg.qid ? { qid: msg.qid } : {})
  });
  if (list.length > THREAD_MAX) list.splice(0, list.length - THREAD_MAX);
}

/**
 * 提问的兜底寿命：客户端断开 / 应用重启后没有等待者，提问会一直挂在进行中的任务上。
 * 下一次 `/next` 把任务还给原 agent 之前先清掉，免得它永远停在「等回答」。
 * 多条提问各自算各自的寿命，清掉的每条都补一条「作废」消息并唤醒可能还在等的 /ask。
 * 返回是否真的清掉了至少一条。
 */
function expireStaleQuestions(r) {
  const list = listQuestions(r);
  if (!list.length) return false;

  const now = Date.now();
  const stale = list.filter((q) => {
    const at = Date.parse(q.at || '');
    return !Number.isFinite(at) || now - at >= ASK_TTL;
  });
  if (!stale.length) return false;

  const ts = nowIso();
  for (const q of stale) {
    takeQuestion(r, q.id);
    pushMessage(r, {
      at: ts,
      role: 'agent',
      kind: 'timeout',
      agent: q.agent || null,
      text: '（长时间无人回答，提问作废）',
      qid: q.id
    });
  }
  r.updatedAt = ts;
  store.save();
  // 先落库再唤醒：还在等的 /ask 醒来会重新读库，必须读到「提问已清」
  for (const q of stale) settle(q.id, { cancelled: true });
  eventLog.append({
    type: 'requirement.timeout',
    projectId: r.projectId,
    requirementId: r.id,
    actor: actor.system('提问超时'),
    data: { ...snapshot(r), agent: stale[0].agent || null, count: stale.length }
  });
  return true;
}

function createRequirements() {
  return {
    requirements: ({ id }) => {
      const p = findProject(id);
      const list = store.get().requirements.filter((r) => r.projectId === p.id);
      list.sort((a, b) => b.seq - a.seq);
      return { requirements: list.map(reqView) };
    },

    pendingRequirements: ({ id }) => {
      const p = findProject(id);
      const list = unfinishedOf(p.id).sort((a, b) => b.seq - a.seq);
      return { requirements: list.map(reqView) };
    },

    createRequirement: ({ id, data }) => {
      const p = findProject(id);
      const body = data || {};
      const title = String(body.title || '').trim();
      if (!title) fail('需求标题不能为空');

      const db = store.get();
      const kept = db.requirements
        .filter((r) => r.projectId === p.id)
        .reduce((max, r) => Math.max(max, r.seq || 0), 0);
      // 归档把已完成的需求搬出了 db.json，编号要连归档文件一起算，否则会退回用过的编号
      const seq = Math.max(kept, archive.maxSeq(p.id)) + 1;
      const source = String(body.source || 'manual').toLowerCase() === 'ai' ? 'ai' : 'manual';
      /**
       * 候选池：没经过人确认的想法不能直接开工，所以两条来源都先进池子 ——
       * AI 巡检提的一律进（没人确认过要不要做），用户手动勾了「候选」的也进；
       * 用户正常新建的需求仍直接是未开始。入池不算「有活」，不唤醒正在等任务的 agent。
       */
      const asCandidate = source === 'ai' || body.candidate === true;

      const requirement = {
        id: store.uid('r'),
        projectId: p.id,
        seq,
        title,
        body: String(body.body || ''),
        note: String(body.note || ''),
        source,
        status: asCandidate ? CANDIDATE : 'todo',
        createdAt: nowIso(),
        updatedAt: nowIso()
      };
      db.requirements.push(requirement);
      store.save();
      // 候选需求派不出去，叫醒 /next 只会让它空转一次
      if (!asCandidate) notifyTaskAvailable();
      eventLog.append({
        type: 'requirement.created',
        projectId: p.id,
        requirementId: requirement.id,
        actor: source === 'ai' ? actor.agent('AI') : actor.user(),
        data: {
          projectName: p.name,
          seq: requirement.seq,
          title: requirement.title,
          source,
          status: requirement.status
        }
      });
      return { requirement: reqView(requirement) };
    },

    updateRequirement: ({ rid, patch }) => {
      const r = findReq(rid);
      const body = patch || {};
      const before = { title: r.title, body: r.body, note: r.note };
      if (body.title !== undefined) {
        const title = String(body.title).trim();
        if (!title) fail('需求标题不能为空');
        r.title = title;
      }
      if (body.body !== undefined) r.body = String(body.body);
      if (body.note !== undefined) r.note = String(body.note);
      r.updatedAt = nowIso();
      store.save();
      const fields = [];
      if (before.title !== r.title) fields.push('title');
      if (before.body !== r.body) fields.push('body');
      if (before.note !== r.note) fields.push('note');
      eventLog.append({
        type: 'requirement.updated',
        projectId: r.projectId,
        requirementId: r.id,
        actor: actor.user(),
        data: { ...snapshot(r), fields }
      });
      return { requirement: reqView(r) };
    },

    /** 执行 agent 认领任务：记录认领者并把未开始的任务置为进行中，不改标题/正文/备注 */
    claimRequirement: ({ rid, agent }) => {
      const id = assertTaskId(rid);
      const who = assertAgent(agent);

      const r = findReq(id);
      const project = findProject(r.projectId);
      const view = () => ({
        requirement: reqView(r),
        project: { id: project.id, name: project.name, path: project.path }
      });
      // 候选池是「人还没确认」的想法：认领入口也要挡住，不能靠「派发没选它」这一处兜底
      if (r.status === CANDIDATE) {
        fail('这条需求还在候选池，等用户采纳后才能认领', 'not_claimable', 409);
      }
      if (r.status === 'done' || r.status === 'rejected') {
        fail('任务已结束，不能再认领', 'not_claimable', 409);
      }
      if (r.claim) {
        if (r.claim.agent === who) return view();
        claimConflict(r.claim, '该任务已由「' + r.claim.agent + '」认领');
      }

      claimLocked(r, who);
      return view();
    },

    /**
     * 释放认领：把进行中的任务放回未开始并清掉认领，做不下去的 agent 用这条退出，
     * 免得一条坏任务永久卡住整个项目（自动派发以项目为单位，doing 会挡住新活）。
     * 只有当前认领者、只有 doing 可以释放；待审核已经交到用户手上，不该被 agent 撤回。
     */
    releaseRequirement: ({ rid, agent, note }) => {
      const id = assertTaskId(rid);
      const who = assertAgent(agent);
      const r = findReq(id);

      if (!r.claim) fail('任务尚未认领，无需释放', 'not_claimed', 409);
      if (r.claim.agent !== who) claimConflict(r.claim, '该任务由「' + r.claim.agent + '」认领，不能代为释放');
      if (r.status !== 'doing') fail('只有进行中的任务可以释放，当前状态：' + r.status, 'not_releasable', 409);

      const text = assertEncoded(String(note ?? '').trim(), 'note');
      // 事件流的 note 只保留 200 字符：这里跟着截断超限直接拒收，不留下「存进去却被悄悄截掉」的原因
      if (text.length > 200) fail('释放原因过长（上限 200 字符）', 'bad_note', 400);

      const at = nowIso();
      delete r.claim;
      delete r.completion;
      // 释放即放弃：锁与解锁通行证一起作废，否则下一位 agent 认领时会被上一轮的授权放行
      delete r.unlock;
      // 释放即放弃：待回答的提问跟着认领作废，别让下一位 agent 以为自己在等一个不会来的回答
      const dropped = clearQuestions(r);
      // 释放原因留在需求上：下一位 agent 认领时能读到「上一次为什么放弃」，派发闸门用 release.at 做冷却
      r.release = { agent: who, at, note: text };
      r.status = 'todo';
      r.updatedAt = at;
      pushMessage(r, { at, role: 'agent', kind: 'release', agent: who, text });
      store.save();
      // 先落库再唤醒：还在等回答的 /ask 立刻拿到「这次提问随释放作废」，不必干等到超时
      for (const q of dropped) settle(q.id, { cancelled: true });
      notifyTaskAvailable();
      eventLog.append({
        type: 'requirement.released',
        projectId: r.projectId,
        requirementId: r.id,
        actor: actor.agent(who),
        data: { ...snapshot(r), agent: who, note: text }
      });
      return { requirement: reqView(r) };
    },

    /**
     * 解锁项目：给「进行中」的需求签一张一次性通行证（`unlock`），让 `/next` 下一轮
     * 把这条任务还给它的认领人。
     *
     * 为什么需要人工点：项目里有 doing 就等于锁着，任何 agent（含认领人自己）都派不出去。
     * 服务端无法区分「上一个进程还活着」与「它已经断了」（两者在库里都是 doing + claim = 我），
     * 所以把「这条中断的活还要不要继续」这个不可逆的决定交给人 —— 不点，agent 就去干别的项目。
     *
     * 通行证是一次性的：`/next` 还给本人时当场销掉（见 auto-claim 的 consumeUnlock）。
     * 只有当前认领者名下的 doing 才有意义：没有 claim 的 doing 解锁不会放行任何人，直接拒。
     */
    unlockRequirement: ({ rid }) => {
      const r = findReq(assertTaskId(rid));
      if (r.status !== 'doing') fail('只有进行中的需求需要解锁，当前状态：' + r.status, 'not_locked', 409);
      if (!r.claim) fail('这条需求没有认领人，解锁不会放行任何人；请先撤销或直接改状态', 'not_claimed', 409);

      const at = nowIso();
      r.unlock = { at };
      r.updatedAt = at;
      store.save();
      notifyTaskAvailable();
      eventLog.append({
        type: 'requirement.unlocked',
        projectId: r.projectId,
        requirementId: r.id,
        actor: actor.user(),
        data: { ...snapshot(r), agent: r.claim.agent }
      });
      return { requirement: reqView(r) };
    },

    /**
     * 撤销解锁：把还没被取走的通行证收回（误点 / 想让 agent 先别动这个项目）。
     * 不报错：本来就没解锁也算成功，界面点两下不会互斥报错。
     */
    relockRequirement: ({ rid }) => {
      const r = findReq(assertTaskId(rid));
      if (r.unlock) {
        delete r.unlock;
        r.updatedAt = nowIso();
        store.save();
        eventLog.append({
          type: 'requirement.relocked',
          projectId: r.projectId,
          requirementId: r.id,
          actor: actor.user(),
          data: snapshot(r)
        });
      }
      return { requirement: reqView(r) };
    },

    /**
     * 执行 agent 交付任务：置为「待审核」并记录 completion，然后在服务端**等用户验收**
     * （默认 30 分钟）。必须是当前认领者本人提交。
     *
     * 交付带两段互不混用的文本：
     * - `note`：回复用户的会话说明（做了什么、怎么验证的、哪些没验证），进往返记录与详情；
     * - `commitMessage`：独立的 git 提交信息，只放在 completion 里供一键提交预填，
     *   绝不写进 thread / 事件流——打回时 completion 被清掉，交谈历史里不留提交信息。
     *
     * 三种收尾：
     * - 用户点「通过」：`approved = true`，任务进入已完成，agent 本轮结束；
     * - 用户点「继续回复」：`feedback` 带回修改意见，需求回到进行中，agent 接着改并再次交付；
     * - 超时无人处理：`timedOut = true`，交付留在待审核，agent 本轮结束（用户之后仍可验收）。
     */
    completeRequirement: async ({ rid, agent, note, commitMessage }) => {
      const id = assertTaskId(rid);
      const who = assertAgent(agent);
      const r = findReq(id);

      if (!r.claim) fail('任务尚未认领，请先调用 /claim', 'not_claimed', 409);
      if (r.claim.agent !== who) claimConflict(r.claim, '该任务由「' + r.claim.agent + '」认领，不能代为完成');
      if (r.status === 'done' || r.status === 'rejected') {
        fail('任务已结束，不能再提交完成', 'not_completable', 409);
      }
      // 重复提交按幂等处理：不改完成记录与时间，避免重试把审核中的信息冲掉
      if (r.status === 'review') return { requirement: reqView(r) };

      const text = assertEncoded(String(note ?? '').trim(), 'note');
      if (text.length > 2000) fail('完成说明过长（上限 2000 字符）', 'bad_note', 400);
      const commitText = assertEncoded(String(commitMessage ?? '').trim(), '提交信息');
      if (commitText.length > 2000) {
        fail('提交信息过长（上限 2000 字符）', 'bad_commit_message', 400);
      }

      const at = nowIso();
      // 提交信息与会话回复并列存放，但只有 note 会往下流进交谈记录
      r.completion = { agent: who, at, note: text, commitMessage: commitText };
      r.status = 'review';
      // 交付即离开 doing：待回答随认领一起作废（原文仍留在 thread），否则待审核需求会带着回复框
      const dropped = clearQuestions(r);
      r.updatedAt = at;
      // 交付进往返记录：只放会话回复。多轮打回后「上一次交付说了什么」仍查得到，
      // 而 commitMessage 只活在 completion 里，打回（delete completion）后连历史都不留
      pushMessage(r, { at, role: 'agent', kind: 'delivery', agent: who, text });
      store.save();
      // 交付后不会再有人回答：把可能还挂着的 /ask 立刻结算掉，别让它们等到超时才结束
      for (const q of dropped) settle(q.id, { cancelled: true });
      eventLog.append({
        type: 'requirement.completed',
        projectId: r.projectId,
        requirementId: r.id,
        actor: actor.agent(who),
        data: { ...snapshot(r), agent: who, note: text }
      });

      const res = await waitForReview(id, REVIEW_TIMEOUT);

      // 等待期间用户可能撤销、删除需求，或被别的操作改了状态：重新取一次，别拿旧引用写
      const cur = store.get().requirements.find((x) => x.id === id);
      if (!cur) return { requirement: null, approved: false, timedOut: true, reason: 'requirement_gone' };
      if (res.approved) return { requirement: reqView(cur), approved: true, timedOut: false };
      if (res.feedback !== undefined) {
        return { requirement: reqView(cur), approved: false, feedback: res.feedback, timedOut: false };
      }
      if (res.rejected) return { requirement: reqView(cur), approved: false, rejected: true, timedOut: false };
      if (res.cancelled) return { requirement: reqView(cur), approved: false, cancelled: true, timedOut: false };
      if (res.replaced) return { requirement: reqView(cur), approved: false, timedOut: false, reason: 'replaced' };
      return { requirement: reqView(cur), approved: false, timedOut: true };
    },

    /**
     * agent 提问：追加一条待回答提问 + 一条往返消息，然后在服务端**等用户回答**（固定 1 小时，
     * 不接受 agent 传参缩短等待）。
     *
     * 一条需求可以同时挂多条提问（上限 `MAX_QUESTIONS`）：每条有独立的 questionId、独立的等待与
     * 超时、独立的回答，互不顶掉。这样 agent 并行问两三件互不依赖的事时，用户能一次答完，
     * 不必来回等一轮。
     *
     * 不改状态 —— 需求仍是进行中、认领还在它名下，项目继续被「有进行中任务」挡住。
     * 收尾：
     * - 用户回答：`answer.source = 'user'`，agent 拿到就直接接着做；
     * - 超时且带了 default：把 default 当回答写进往返记录（`kind=fallback`），`source='default'`；
     * - 超时且没带 default：这条提问作废（`kind=timeout`），`answer = null`；
     * - 需求被交付 / 释放 / 删除：`reason='cancelled'`，不必等超时。
     * 超时即关闭提问，之后不能再补答 —— 想改就让用户打完交付再打回。
     */
    askRequirement: async ({ rid, agent, text, options, fallback }) => {
      const id = assertTaskId(rid);
      const who = assertAgent(agent);
      const r = findReq(id);

      if (!r.claim) fail('任务尚未认领，请先调用 /claim 或 /next', 'not_claimed', 409);
      if (r.claim.agent !== who) claimConflict(r.claim, '该任务由「' + r.claim.agent + '」认领，不能代为提问');
      // 待审核已经交到用户手上：这时候再提问会把「验收」和「问答」搅在一起
      if (r.status !== 'doing') fail('只有进行中的任务可以提问，当前状态：' + r.status, 'not_askable', 409);
      // 多条提问是并列的，只挡条数上限：再问下去该整理成一段说明，而不是更多问号
      const asking = countQuestions(r);
      if (asking >= MAX_QUESTIONS) {
        fail(
          '这条需求已有 ' + asking + ' 条待回答的提问（上限 ' + MAX_QUESTIONS + ' 条），先等用户回答再继续问',
          'too_many_questions',
          409
        );
      }

      const t = assertEncoded(String(text ?? '').trim(), 'question');
      if (!t) fail('提问内容不能为空', 'bad_question', 400);
      if (t.length > 1000) fail('提问过长（上限 1000 字符）', 'bad_question', 400);
      const opts = normalizeOptions(options);
      const fb = assertEncoded(String(fallback ?? '').trim(), 'default');
      if (fb.length > 2000) fail('默认回答过长（上限 2000 字符）', 'bad_question', 400);

      // 等待时长固定为上限，不接受 agent 传参缩短：提问只能等到用户回答或服务端超时
      const at = nowIso();
      const qid = store.uid('q');
      addQuestion(r, {
        id: qid,
        at,
        agent: who,
        text: t,
        options: opts,
        default: fb,
        expiresAt: new Date(Date.parse(at) + ASK_TIMEOUT).toISOString()
      });
      r.updatedAt = at;
      pushMessage(r, { at, role: 'agent', kind: 'question', agent: who, text: t, qid });
      store.save();
      eventLog.append({
        type: 'requirement.asked',
        projectId: r.projectId,
        requirementId: r.id,
        actor: actor.agent(who),
        // 事件流只留短预览，完整提问在 thread 里
        data: { ...snapshot(r), agent: who, note: t, questionId: qid }
      });

      const res = await waitFor(qid, ASK_TIMEOUT, id);

      // 等待期间用户可能撤销、删除需求，或被别的操作改了状态：重新取一次，别拿旧引用写
      const cur = store.get().requirements.find((x) => x.id === id);
      if (!cur) return { requirement: null, answer: null, timedOut: true, reason: 'requirement_gone' };
      if (res.answered) {
        // answerRequirement 已经写好了 thread 与该条提问的清理，这里只负责把答案带回去
        return {
          requirement: reqView(cur),
          answer: { text: res.text, source: 'user', questionId: qid },
          timedOut: false
        };
      }
      if (res.cancelled) {
        return { requirement: reqView(cur), answer: null, timedOut: false, reason: 'cancelled' };
      }
      if (res.replaced) return { requirement: reqView(cur), answer: null, timedOut: false, reason: 'replaced' };

      // 超时：这条提问已经不在（被 TTL 清掉 / 已被回答）就只回状态，让 agent 自己读 thread
      const mine = takeQuestion(cur, qid);
      if (!mine) return { requirement: reqView(cur), answer: null, timedOut: true };

      const ts = nowIso();
      const defaultText = String(mine.default || '');
      if (defaultText) {
        pushMessage(cur, {
          at: ts,
          role: 'agent',
          kind: 'fallback',
          agent: who,
          text: defaultText,
          qid
        });
        cur.updatedAt = ts;
        store.save();
        eventLog.append({
          type: 'requirement.answered',
          projectId: cur.projectId,
          requirementId: cur.id,
          actor: actor.system('超时默认'),
          data: { ...snapshot(cur), agent: who, source: 'default', note: defaultText, questionId: qid }
        });
        return {
          requirement: reqView(cur),
          answer: { text: defaultText, source: 'default', questionId: qid },
          timedOut: true
        };
      }

      pushMessage(cur, {
        at: ts,
        role: 'agent',
        kind: 'timeout',
        agent: who,
        text: '（无人回答，提问作废）',
        qid
      });
      cur.updatedAt = ts;
      store.save();
      eventLog.append({
        type: 'requirement.timeout',
        projectId: cur.projectId,
        requirementId: cur.id,
        actor: actor.system('提问超时'),
        data: { ...snapshot(cur), agent: who, questionId: qid }
      });
      return { requirement: reqView(cur), answer: null, timedOut: true };
    },

    /**
     * 用户回答「待回答」的提问：取走这一条、追加一条消息，并唤醒对应的 /ask。
     * `qid` 指定答哪一条；只有一条待回答时可以省略（老界面 / 老脚本仍按单条调用）。
     * 多条并存时省略 `qid` 直接拒收：猜一条答错，比让调用方带个 id 贵得多。
     */
    answerRequirement: ({ rid, qid, text }) => {
      const r = findReq(assertTaskId(rid));
      const list = listQuestions(r);
      if (!list.length) fail('这条需求没有待回答的提问', 'no_question', 409);

      let target = null;
      if (qid) {
        target = list.find((q) => q.id === qid) || null;
        if (!target) fail('这条需求没有这个提问（可能已被回答或已作废）', 'no_question', 409);
      } else if (list.length === 1) {
        target = list[0];
      } else {
        fail('这条需求有 ' + list.length + ' 条待回答的提问，请指定 questionId', 'need_question_id', 409);
      }

      const t = assertEncoded(String(text ?? '').trim(), 'answer');
      if (!t) fail('回答不能为空', 'bad_answer', 400);
      if (t.length > 2000) fail('回答过长（上限 2000 字符）', 'bad_answer', 400);

      const at = nowIso();
      const askedBy = target.agent;
      takeQuestion(r, target.id);
      r.updatedAt = at;
      pushMessage(r, { at, role: 'user', kind: 'answer', text: t, qid: target.id });
      store.save();
      // 先落库再唤醒：等待中的 /ask 醒来会重新读库，必须读到「提问已取走、回答已写」
      settle(target.id, { answered: true, text: t });
      eventLog.append({
        type: 'requirement.answered',
        projectId: r.projectId,
        requirementId: r.id,
        actor: actor.user(),
        data: { ...snapshot(r), agent: askedBy, source: 'user', note: t, questionId: target.id }
      });
      return { requirement: reqView(r) };
    },

    /**
     * 把一次真实产生的提交挂到需求上：只认提交真正落盘后拿到的 sha，
     * 「没有新改动、只推送了已有提交」时不调用（用户 2026-11-23 确认）。
     * 不移动 updatedAt —— 提交是需求之外的副作用，不该把需求在列表里的更新时间往前推；
     * 关联失败由调用方兜底（提交已经成功，不能反过来报成提交失败）。
     */
    linkRequirementCommit: ({ rid, projectId, sha, subject }) => {
      const r = findReq(assertTaskId(rid));
      const s = String(sha || '').trim();
      if (!/^[0-9a-f]{7,40}$/i.test(s)) fail('提交 hash 格式不正确：' + (s || '(空)'), 'bad_sha', 400);
      if (projectId && r.projectId !== projectId) fail('需求不属于该项目，不能关联这次提交', 'bad_project', 400);
      const commits = Array.isArray(r.commits) ? r.commits : [];
      if (commits.some((c) => c && c.sha === s)) return { ok: true, duplicate: true, commits };

      const entry = {
        sha: s,
        shortSha: s.slice(0, 7),
        subject: String(subject || '').trim().slice(0, 200),
        at: nowIso()
      };
      r.commits = [entry, ...commits].slice(0, COMMITS_MAX);
      store.save();
      eventLog.append({
        type: 'requirement.commit_linked',
        projectId: r.projectId,
        requirementId: r.id,
        actor: actor.user(),
        data: { ...snapshot(r), sha: entry.sha, shortSha: entry.shortSha, subject: entry.subject }
      });
      return { ok: true, duplicate: false, commit: entry, commits: r.commits };
    },

    deleteRequirement: ({ rid }) => {
      const r = findReq(rid);
      const db = store.get();
      db.requirements = db.requirements.filter((x) => x.id !== r.id);
      store.save();
      // 删除待审核需求时唤醒挂起的 /complete：它醒来发现记录已没了，会直接结束本轮
      if (r.status === 'review') settleReview(r.id, { cancelled: true });
      // 挂着的 /ask 同理：记录都没了，等下去也不会有答案
      settleAll(r.id, { cancelled: true });
      notifyTaskAvailable();
      eventLog.append({
        type: 'requirement.deleted',
        projectId: r.projectId,
        requirementId: r.id,
        actor: actor.user(),
        data: { ...snapshot(r), status: r.status }
      });
      return { ok: true, id: r.id };
    },

    /**
     * 归档已完成的需求：整条记录写进数据目录的 archive/<项目id>/（一条一个 JSON，文件名带编号），
     * 再从 db.json 里移除——列表、页签计数、侧栏与总览的数字随之不再包含它。
     * 只有 done 可归档：未完成 / 已拒绝还在流程里，归档等于绕过流程把它们藏起来。
     */
    archiveRequirement: ({ rid }) => {
      const r = findReq(assertTaskId(rid));
      if (r.status !== 'done') {
        fail('只有已完成的需求可以归档，当前状态：' + r.status, 'not_archivable', 409);
      }
      const p = findProject(r.projectId);
      // 先落盘再改库：写文件失败就整体失败，不能出现「库里删了、文件没写」的丢数据
      const file = archive.write(r, p);

      const db = store.get();
      db.requirements = db.requirements.filter((x) => x.id !== r.id);
      store.save();
      eventLog.append({
        type: 'requirement.archived',
        projectId: r.projectId,
        requirementId: r.id,
        actor: actor.user(),
        data: { ...snapshot(r), file }
      });
      return { ok: true, id: r.id, file };
    },

    /**
     * 已归档需求清单：直接读数据目录的 archive/，跨项目一起给（归档文件里冗余存了项目名，
     * 项目被删后仍知道它原来属于谁）。恢复入口只在这里取数据，列表与计数不掺归档。
     */
    archivedRequirements: () => {
      const projects = new Map(store.get().projects.map((p) => [p.id, p]));
      const list = archive.list().map((item) => {
        const r = item.requirement;
        const p = projects.get(r.projectId) || null;
        return {
          id: r.id,
          /** 项目删除后归档仍能读，但恢复无处可落；界面据此禁用按钮并说明 */
          projectName: (p && p.name) || (item.project && item.project.name) || '',
          projectExists: !!p,
          seq: r.seq,
          title: r.title || '',
          archivedAt: item.archivedAt || null
        };
      });
      list.sort(
        (a, b) =>
          String(b.archivedAt || '').localeCompare(String(a.archivedAt || '')) ||
          (b.seq || 0) - (a.seq || 0)
      );
      return { requirements: list };
    },

    /**
     * 恢复一条已归档需求：把它放回 db.json，再删掉归档文件。
     * 顺序不能反：先写库再删文件，写库失败时归档还在，可以重试；反过来则可能两边都没有。
     * 原项目已被彻底删除时不恢复——没有项目可落，宁可留在归档里。
     */
    restoreRequirement: ({ rid }) => {
      const item = archive.findEntry(assertTaskId(rid));
      if (!item) fail('没有找到这条归档需求（可能已恢复，或归档文件已被删除）', 'not_archived', 404);
      const r = item.requirement;
      const db = store.get();
      if (db.requirements.some((x) => x.id === r.id)) {
        fail('这条需求已经在需求列表里，无需恢复', 'already_restored', 409);
      }
      if (!db.projects.some((x) => x.id === r.projectId)) {
        fail('原项目已移除，无法恢复这条需求（归档文件仍在数据目录 archive/ 下）', 'project_missing', 409);
      }
      db.requirements.push(r);
      store.save();
      try {
        archive.removeEntry(item);
      } catch (e) {
        // 库已经写回、功能可用；残留的归档文件下次恢复会被 already_restored 拦住，不会重复入列
        process.stderr.write('[archive] 删除归档文件失败（' + item.name + '）：' + e.message + '\n');
      }
      eventLog.append({
        type: 'requirement.restored',
        projectId: r.projectId,
        requirementId: r.id,
        actor: actor.user(),
        data: { ...snapshot(r) }
      });
      return { ok: true, id: r.id };
    },

    /**
     * 改状态。note 传了就整体替换备注（传空串即清空），不传则保留原备注。
     * 收尾状态（done / rejected）下原备注多为 AI 提需求时的判断，通常已过时，由调用方决定是否重写。
     * feedback 是给 agent 的回传原因：打回时说明改什么，撤销重开时说明为什么重开。
     */
    setRequirementStatus: ({ rid, status, note, feedback }) => {
      const r = findReq(rid);
      const prevStatus = r.status;
      const next = String(status || '');
      if (!STATUSES.includes(next)) fail('未知状态：' + (next || '(空)') + '，可选 ' + STATUSES.join(' / '));
      // 待审核是 agent 交付的产物，只走 /complete，避免绕过认领校验直接进审核队列
      if (next === 'review') fail('待审核只能由 agent 完成接口进入', 'use_complete_api', 409);
      /**
       * 候选池是流程之前的入口，不是流程里的一站：只允许 未开始 ↔ 候选、候选 → 已拒绝。
       * 放开的话，一条已认领的 doing 能被改成候选：认领悬空、项目锁失效，而候选又不参与派发。
       */
      if (next === CANDIDATE) {
        if (prevStatus !== 'todo' && prevStatus !== CANDIDATE) {
          fail('只有未开始的需求可以退回候选池，当前状态：' + prevStatus, 'bad_status_transition', 409);
        }
      } else if (prevStatus === CANDIDATE && next !== 'todo' && next !== 'rejected') {
        fail('候选需求只能采纳为未开始或直接拒绝，目标状态：' + next, 'bad_status_transition', 409);
      }
      const hasNote = note !== undefined && note !== null;
      const hasFeedback = feedback !== undefined && feedback !== null;
      const feedbackText = hasFeedback
        ? assertEncoded(String(feedback).trim(), '打回 / 撤销原因')
        : '';
      // 打回（待审核 → 进行中）与撤销重开（→ 未开始）都要把原因回传给 agent：
      // 前者说下一轮改什么，后者解释为什么之前的交付 / 通过不再算数
      const canFeedback = (prevStatus === 'review' && next === 'doing') || next === 'todo';
      if (hasFeedback && !canFeedback) {
        fail('只有打回（待审核 → 进行中）或撤销（→ 未开始）才能填写原因', 'bad_feedback', 400);
      }
      if (feedbackText.length > 2000) fail('原因过长（上限 2000 字符）', 'bad_feedback', 400);
      const feedbackKind = next === 'todo' ? 'reopen' : 'rejection';
      if (next === r.status) {
        if (hasNote && String(note) !== r.note) {
          r.note = String(note);
          r.updatedAt = nowIso();
          store.save();
          eventLog.append({
            type: 'requirement.updated',
            projectId: r.projectId,
            requirementId: r.id,
            actor: actor.user(),
            data: { ...snapshot(r), fields: ['note'] }
          });
        }
        return { requirement: reqView(r) };
      }

      r.status = next;
      // 交付记录的寿命与状态同步：重开（todo）连认领一起清，打回（doing）只清这次交付。
      // 进候选池不必额外清理：上面的状态机只允许从 todo 进，而 todo 本来就没有认领与交付记录。
      if (next === 'doing' || next === 'todo') delete r.completion;
      if (next === 'todo') delete r.claim;
      // 待回答只在「进行中」有意义：一旦离开这个状态，提问随认领一起作废（原文仍留在 thread 里）
      const dropped = next !== 'doing' ? clearQuestions(r) : [];
      // 解锁通行证同理：离开进行中即作废（重开/拒绝/交付都不该留下放行凭据）
      if (next !== 'doing') delete r.unlock;
      if (hasNote) r.note = String(note);
      const at = nowIso();
      // 打回是用户明确的「继续改」指令，本身就算一次授权：直接把通行证签好，
      // 否则打回后的任务同样是 doing、同样锁着项目，agent 再也拿不回来 —— 续改闭环会断在这里
      if (prevStatus === 'review' && next === 'doing') r.unlock = { at, by: 'feedback' };
      // 回传原因独立存：不污染需求备注，agent 下次认领即可读到最新一条；kind 区分打回与撤销
      if (hasFeedback) r.feedback = { at, note: feedbackText, kind: feedbackKind };
      // 审核的三个出口都进往返记录：多轮打回后，前几轮说了什么仍然查得到。
      // 打回文本优先取打回原因；agent 经 MCP 改状态时没有 feedback，退回备注，别留一条空消息
      if (prevStatus === 'review' && next === 'doing') {
        pushMessage(r, { at, role: 'user', kind: 'rejection', text: feedbackText || (hasNote ? String(note) : '') });
      } else if (prevStatus === 'review' && next === 'done') {
        pushMessage(r, { at, role: 'user', kind: 'approval', text: hasNote ? String(note) : '' });
      } else if (next === 'rejected') {
        pushMessage(r, { at, role: 'user', kind: 'rejected', text: hasNote ? String(note) : '' });
      } else if (next === 'todo' && hasFeedback) {
        // 撤销重开必须留痕：agent 下一轮读到 thread 末尾这条「撤销」，才知道之前的完成 / 通过已作废
        pushMessage(r, { at, role: 'user', kind: 'reopen', text: feedbackText });
      }
      r.updatedAt = at;
      store.save();
      // 离开进行中后这些提问不会再被回答：立刻结算挂着的 /ask，别让它们干等到超时
      for (const q of dropped) settle(q.id, { cancelled: true });
      notifyTaskAvailable();
      const data = { ...snapshot(r), from: prevStatus, to: next };
      if (hasNote) data.note = String(note);
      if (hasFeedback) {
        data.feedback = feedbackText;
        data.feedbackKind = feedbackKind;
      }
      eventLog.append({
        type: 'requirement.status_changed',
        projectId: r.projectId,
        requirementId: r.id,
        actor: actor.user(),
        data
      });
      // 验收的三个出口都唤醒挂起的 /complete：先落库再唤醒，醒来会重新读库
      if (prevStatus === 'review') {
        if (next === 'done') settleReview(r.id, { approved: true });
        else if (next === 'doing') settleReview(r.id, { feedback: feedbackText });
        else if (next === 'rejected') settleReview(r.id, { rejected: true });
        else if (next === 'todo') settleReview(r.id, { cancelled: true });
      }
      return { requirement: reqView(r) };
    },

    /** 跨项目需求查询（供外部 agent 使用） */
    allRequirements: (params) => {
      const q = params || {};
      let list = store.get().requirements.slice();

      if (q.projectId) {
        const p = findProject(String(q.projectId));
        list = list.filter((r) => r.projectId === p.id);
      }
      if (q.pending) list = list.filter((r) => UNFINISHED.includes(r.status));
      if (q.status) {
        const wanted = String(q.status).split(',').filter(Boolean);
        const invalid = wanted.filter((s) => !STATUSES.includes(s));
        if (invalid.length) fail('未知状态：' + invalid.join(','));
        list = list.filter((r) => wanted.includes(r.status));
      } else {
        // 不指定状态时默认不含候选池：那是人还没确认的想法，混进 agent 的清单会被当成待办
        list = list.filter((r) => r.status !== CANDIDATE);
      }
      if (q.source) list = list.filter((r) => r.source === String(q.source));

      list.sort(
        (a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || (b.seq || 0) - (a.seq || 0)
      );
      return { requirements: list.map(reqView) };
    }
  };
}

module.exports = { createRequirements, claimLocked, expireStaleQuestions };

'use strict';

/**
 * 等待回答的挂起请求：`/ask` 在服务端最多等 1 小时，用户回答或超时才返回。
 *
 * 设计取舍：
 * - 一条需求可以同时挂多条提问（每条有独立的 questionId），所以等待者按 questionId 建表，
 *   而不是按需求 id —— 否则第二条提问会把还活着的那次等待顶掉。
 * - `settleAll(rid)` 用于「整条需求不再需要回答」的场景（交付、释放、改状态、删除）：
 *   把这些问题的等待者一次结算掉，agent 的 /ask 立刻拿到结论，不必干等到超时。
 * - 进程内状态，应用重启即清空。没有等待者的提问靠 TTL 自愈（`expireStaleQuestions`），
 *   否则一次客户端断开就会让这条需求永远停在「待回答」。
 * - 定时器 unref：等回答不该拖住应用退出；退出后提问留在库里，下一次 `/next` 走 TTL 清理。
 */

/** 服务端最长等待：1 小时。到点按 agent 给的 default 收尾，或宣告无人回答。 */
const ASK_TIMEOUT = 60 * 60 * 1000;

/**
 * 提问的兜底寿命：比最长等待再多留 10 分钟。
 * 超过这个时间既没有等待者也没有回答，就当作废（断开 / 重启后的自愈）。
 */
const ASK_TTL = ASK_TIMEOUT + 10 * 60 * 1000;

/** qid → { rid, finish(payload), at } */
const waiters = new Map();

/**
 * 注册一个等待，返回 Promise。
 * 同一 questionId 上若已有等待者，先把它结算成 `{ replaced: true }`（它的响应会说明被新提问替换）。
 * @returns {Promise<{answered?: boolean, text?: string, timedOut?: boolean, replaced?: boolean, cancelled?: boolean}>}
 */
function waitFor(qid, ms, rid) {
  settle(qid, { replaced: true });

  return new Promise((resolve) => {
    let timer = null;
    let done = false;
    const finish = (payload) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      const cur = waiters.get(qid);
      if (cur && cur.finish === finish) waiters.delete(qid);
      resolve(payload);
    };
    timer = setTimeout(() => finish({ timedOut: true }), Math.max(0, ms));
    if (timer.unref) timer.unref();
    waiters.set(qid, { rid, finish, at: Date.now() });
  });
}

/** 唤醒某个提问的等待者；没有等待者返回 false（用户回答时可能没人在等） */
function settle(qid, payload) {
  const w = waiters.get(qid);
  if (!w) return false;
  w.finish(payload);
  return true;
}

/** 结算某条需求下所有提问的等待者，返回被唤醒的条数 */
function settleAll(rid, payload) {
  let n = 0;
  for (const [qid, w] of Array.from(waiters)) {
    if (w.rid !== rid) continue;
    w.finish(payload);
    // finish 内部会把自己从表里删掉；防御一下被并发改动过的表
    if (waiters.get(qid) === w) waiters.delete(qid);
    n++;
  }
  return n;
}

/** 是否有请求正挂在等这条需求的某个回答：排障与状态展示用 */
function pending(rid) {
  for (const w of waiters.values()) if (w.rid === rid) return true;
  return false;
}

module.exports = { ASK_TIMEOUT, ASK_TTL, waitFor, settle, settleAll, pending };

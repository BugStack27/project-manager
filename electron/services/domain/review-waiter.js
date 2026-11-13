'use strict';

/**
 * 交付验收的挂起请求：`/complete` 把需求置为待审核后，在服务端最多等 2 小时。
 * 用户点「通过」或「继续回复」时立刻唤醒并带回结果；超时就按「无人处理」返回，
 * 交付继续留在待审核，用户之后仍可以验收。
 *
 * 设计取舍：
 * - 一条需求同一时刻只允许一个等待：重复 `/complete` 在领域层按幂等直接返回，
 *   不会走到这里，所以不用考虑覆盖。
 * - 进程内状态，应用重启即清空；等待状态本身不落库——「待审核」是需求自己的状态，
 *   没有等待者时用户照样能通过 / 打回，只是 agent 那一轮已经结束。
 * - 定时器 unref：等验收不该拖住应用退出。
 */

/** 服务端最长等待：2 小时。到点返回 timedOut，交付留在待审核。 */
const REVIEW_TIMEOUT = 2 * 60 * 60 * 1000;

/** rid → { finish(payload), at } */
const waiters = new Map();

/**
 * 注册一个等待，返回 Promise。
 * 同一 rid 上若已有等待者，先把它结算成 `{ replaced: true }`。
 * @returns {Promise<{approved?: boolean, feedback?: string, rejected?: boolean, cancelled?: boolean, timedOut?: boolean, replaced?: boolean}>}
 */
function waitFor(rid, ms) {
  settle(rid, { replaced: true });

  return new Promise((resolve) => {
    let timer = null;
    let done = false;
    const finish = (payload) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      if (waiters.get(rid) && waiters.get(rid).finish === finish) waiters.delete(rid);
      resolve(payload);
    };
    timer = setTimeout(() => finish({ timedOut: true }), Math.max(0, ms));
    if (timer.unref) timer.unref();
    waiters.set(rid, { finish, at: Date.now() });
  });
}

/** 唤醒某个需求的等待者；没有等待者返回 false（用户验收时可能没人在等） */
function settle(rid, payload) {
  const w = waiters.get(rid);
  if (!w) return false;
  w.finish(payload);
  return true;
}

/** 是否有请求正挂在等这条需求的验收：排障与状态展示用 */
function pending(rid) {
  return waiters.has(rid);
}

module.exports = { REVIEW_TIMEOUT, waitFor, settle, pending };

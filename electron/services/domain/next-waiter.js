'use strict';

/**
 * `/next` 的长等待：没有可派任务时挂住请求，直到有变更信号或超时，避免 agent 定时器
 * 以很短的间隔反复空转。
 *
 * 设计取舍：
 * - 这里是「广播信号」，不是按需求的等待表：任何一个可能让项目变得可派发的写操作
 *   都会唤醒所有等待者，由它们各自重新走一遍派发闸门；真正的互斥仍由 `claimLocked`
 *   那段同步临界区保证，多个 agent 同时醒来也只有一个能认领。
 * - 除了事件唤醒，还保留一个低频轮询兜底：外部 git 提交、网络盘恢复、释放冷却到期
 *   不会经过应用写库，光靠 bump 等不到。
 * - 等待器只在进程内，定时器 unref；应用退出不该被挂起的 `/next` 拖住。
 */

/** 默认最长等待：5 分钟。没有变更就返回 no_task，由调度器下一轮重连。 */
const NEXT_TIMEOUT = 5 * 60 * 1000;

/** 调用方显式指定 wait 时的上限：再长也只是多占一个连接，不改变派发规则。 */
const NEXT_MAX = 30 * 60 * 1000;

/** 低频兜底重查间隔：外部 git 提交 / 冷却到期不会触发 bump。 */
const NEXT_POLL = 30 * 1000;

/** 当前挂着的等待者；finish 自己会把自己从集合里删掉 */
const waiters = new Set();

/**
 * 等一次变更信号或超时。返回即表示「可以重新检查一遍派发闸门」。
 * @param {number} ms
 */
function waitForChange(ms) {
  return new Promise((resolve) => {
    let done = false;
    let timer = null;
    const entry = {
      finish() {
        if (done) return;
        done = true;
        if (timer) clearTimeout(timer);
        waiters.delete(entry);
        resolve();
      }
    };
    timer = setTimeout(entry.finish, Math.max(0, ms));
    if (timer.unref) timer.unref();
    waiters.add(entry);
  });
}

/** 有「可能影响派发」的写操作发生：唤醒所有等待者重新检查 */
function bump() {
  for (const w of Array.from(waiters)) w.finish();
}

/** 是否有 `/next` 正挂在等活：排障与状态展示用 */
function pending() {
  return waiters.size;
}

module.exports = { NEXT_TIMEOUT, NEXT_MAX, NEXT_POLL, waitForChange, bump, pending };

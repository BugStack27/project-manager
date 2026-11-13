/* 启动台日志目标选择：优先第一个运行中的命令；否则取最近一次运行过的命令。 */

import { isCommandActive } from '../format.js';

export function defaultLogCmd(commands) {
  // 分离出去但进程还在跑的也算「在写日志」，优先给它
  const running = commands.find(isCommandActive);
  if (running) return running.id;
  let pick = null;
  for (const c of commands) {
    const at = c.lastRun && c.lastRun.startedAt;
    if (at && (!pick || at > pick.at)) pick = { id: c.id, at };
  }
  return pick ? pick.id : null;
}

/* Ctrl+P 命令面板的纯函数：把跨项目命令压成一行一条，排序与筛选都不依赖 React。
   数据来自 projects[].commands —— projectView 已经带了 status 与 lastRun，
   面板不需要额外接口，也不会比侧栏轮询拿到更旧的状态。 */
import { isCommandActive } from '../format.js';
import { matchesText } from './pinyin.js';

/** 上次使用时间：从未启动过的命令给 0，排序时统一沉底 */
function usedAt(c) {
  const at = c && c.lastRun ? Date.parse(c.lastRun.startedAt) : NaN;
  return Number.isNaN(at) ? 0 : at;
}

/**
 * 跨项目命令清单。
 * 运行中置顶（想关服务时不用先翻列表），组内按最近一次启动时间倒序；
 * 从未启动过的按项目顺序、项目内配置顺序排在最后 —— 与启动台看到的顺序一致。
 */
export function collectRuns(projects) {
  const rows = [];
  (projects || []).forEach((p, pi) => {
    (p.commands || []).forEach((c, ci) => {
      rows.push({
        c,
        projectId: p.id,
        projectName: p.name,
        // 口径与启动台共用一处：面板托管的进程，或已分离但宿主进程还活着
        on: isCommandActive(c),
        at: usedAt(c),
        pi,
        ci
      });
    });
  });
  rows.sort((a, b) => {
    if (a.on !== b.on) return a.on ? -1 : 1;
    if (a.at !== b.at) return b.at - a.at;
    if (a.pi !== b.pi) return a.pi - b.pi;
    return a.ci - b.ci;
  });
  return rows;
}

/** 关键字匹配命令名 / 命令文本 / 项目名，任一命中即保留；文字与拼音（含首字母）都算 */
export function matchRuns(rows, q) {
  const needle = String(q || '').trim();
  if (!needle) return rows || [];
  return (rows || []).filter((r) => [r.c.name, r.c.text, r.projectName].some((s) => matchesText(s, needle)));
}

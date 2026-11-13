/* 修改记录的派生数据：项目角标数量、改动视图是否可用、远程落后数。 */

/** 项目行角标：修改记录页用每个项目的未提交文件数 */
export function buildDirtyFiles(gitSummary) {
  const out = {};
  if (gitSummary && gitSummary.projects) {
    for (const g of gitSummary.projects) out[g.id] = g.files || 0;
  }
  return out;
}

/**
 * 每个项目落后上游多少个提交，只收录 behind > 0 的。
 * 数字来自后台巡检的缓存（gitSummary 不联网），所以「没出现」= 没有未拉取的提交，
 * 或者是这一轮还没来得及检查 —— 后者不该被当成「已是最新」，文案上区分开。
 */
export function buildBehindMap(gitSummary) {
  const out = {};
  if (gitSummary && Array.isArray(gitSummary.projects)) {
    for (const g of gitSummary.projects) if (g.behind > 0) out[g.id] = g.behind;
  }
  return out;
}

/** 差量徽标：与改动/推送按钮同一套箭头口径（↓ 表示「在远程、还没到本地」） */
export function behindBadge(n) {
  return '↓' + n;
}

/** 一句话解释：tooltip 里用，别让用户猜 ↓ 是拉还是推 */
export function behindTip(n) {
  return '远程领先 ' + n + ' 个提交，可快进拉取';
}

/** 右面板改动视图的空态文案依据：git 不可用 / 读失败 / 非仓库都算「看不到改动」 */
export function isDiffUnavailable({ gitUnavailable, gitError, gitChanges }) {
  return gitUnavailable || !!gitError || (!!gitChanges && !gitChanges.isRepo);
}

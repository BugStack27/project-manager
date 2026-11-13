/* 全局搜索面板的纯函数：分组顺序、扁平化、键盘循环步进、分组展开。
   与 React 无关，供组件与 node:test 共用。 */

export const SEARCH_GROUPS = [
  { key: 'projects', label: '项目' },
  { key: 'requirements', label: '需求' },
  { key: 'logs', label: '日志' },
  { key: 'commits', label: '提交' }
];

/** 每组默认展示条数，与接口默认 limit 一致 */
export const GROUP_SHOWN = 5;
/** 点过「查看更多」后展示到接口上限 */
export const GROUP_SHOWN_EXPANDED = 10;

/** 该组当前展示条数：默认 5，展开后放到 10 */
export function shownLimitOf(key, expanded) {
  return expanded && expanded[key] ? GROUP_SHOWN_EXPANDED : GROUP_SHOWN;
}

/** 该组实际渲染的结果：后端可能按 10 条返回，未展开的组仍要截回 5 条 */
export function visibleItems(data, key, expanded) {
  return ((data && data[key]) || []).slice(0, shownLimitOf(key, expanded));
}

/** 把四组结果按固定顺序拉平，键盘上下移动只认这一条序列 */
export function flattenResults(data, expanded) {
  if (!data) return [];
  const rows = [];
  for (const g of SEARCH_GROUPS) {
    for (const item of visibleItems(data, g.key, expanded)) rows.push({ group: g.key, item });
  }
  return rows;
}

/** 循环步进：到头回到开头，总数 0 时固定为 0 */
export function stepIndex(current, total, delta) {
  if (!total) return 0;
  return ((current + delta) % total + total) % total;
}

/** 各组当前展示的条数：既用于分组标题右侧的数量，也用于判断是否完全没有结果 */
export function countByGroup(data, expanded) {
  const counts = {};
  for (const g of SEARCH_GROUPS) counts[g.key] = visibleItems(data, g.key, expanded).length;
  return counts;
}

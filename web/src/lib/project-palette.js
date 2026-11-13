/* Ctrl / ⌘ + O 项目切换面板的纯函数：模糊匹配、命中位置与排序。
   与 React 无关。

   匹配规则只有一处真源：`lib/pinyin.js` 的三级口径（连续命中 > 子序列命中 > 拼音命中）。
   查询按空白拆成多个词元，每个词元都要在项目名里命中。
   拼音（全拼 / 首字母）已在内核里作为第三档计入得分，这里不再单独降权。 */

import { matchText } from './pinyin.js';

function lower(v) {
  return String(v == null ? '' : v).toLowerCase();
}

/**
 * 项目模糊匹配。
 * 空查询返回全部项目（保持用户拖拽排序），否则按得分降序、同分保持原顺序。
 * 每一行：{ p, score, namePos }
 *   namePos —— 项目名里的命中下标集合（用于高亮；拼音命中时是所覆盖汉字的原文下标）
 */
export function matchProjects(projects, query) {
  const list = Array.isArray(projects) ? projects : [];
  const tokens = lower(query).trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return list.map((p) => ({ p, score: 0, namePos: null }));

  const rows = [];
  list.forEach((p, i) => {
    const name = String(p.name == null ? '' : p.name);
    let score = 0;
    const namePos = new Set();

    for (const token of tokens) {
      const inName = matchText(name, token);
      if (!inName) return;
      score += inName.score;
      inName.positions.forEach((n) => namePos.add(n));
    }

    rows.push({ p, score, namePos: namePos.size ? namePos : null, i });
  });

  rows.sort((a, b) => b.score - a.score || a.i - b.i);
  return rows.map(({ i, ...row }) => row);
}

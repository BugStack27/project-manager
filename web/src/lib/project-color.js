/* 项目 → 颜色：纯函数，供侧栏头像、顶栏、总览与命令面板共用。
   颜色必须跟着项目 id 走，不能跟着列表位置走 —— 否则侧栏拖拽排序一次，
   整片头像的颜色会集体错位，"靠颜色认项目"就失效了。 */
import { PROJECT_COLORS } from '../constants.js';

/** 上一次的分配结果：同一批项目会在一次渲染里被问很多次（每行头像一次） */
let cachedKey = null;
let cachedMap = new Map();

/**
 * 按 id 排序后取色板序号。
 * - 与传入顺序无关 ⇒ 拖拽排序不换色。
 * - 项目数不超过色板长度时一定互不相同；超了才从第一个色开始复用。
 * - id 是 `p_<base36 时间戳><随机>`，字典序≈创建顺序，新建项目排在末尾，
 *   已有项目的序号不变，所以加项目不会让老项目换色（删项目会前移一位，这是已知取舍）。
 */
export function projectColorMap(projects) {
  const ids = [];
  const seen = new Set();
  for (const p of projects || []) {
    if (!p || !p.id || seen.has(p.id)) continue;
    seen.add(p.id);
    ids.push(p.id);
  }
  ids.sort();

  const key = ids.join('\u0000');
  if (key === cachedKey) return cachedMap;

  const map = new Map();
  ids.forEach((id, i) => map.set(id, PROJECT_COLORS[i % PROJECT_COLORS.length]));
  cachedKey = key;
  cachedMap = map;
  return map;
}

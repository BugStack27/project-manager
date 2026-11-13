/**
 * 搜索用的中文拼音匹配内核（渲染进程唯一实现）。
 *
 * 口径：一次匹配按三档打分，高分档优先
 *   1. 连续命中（原文子串）—— 输入「项管」不会命中，输入「项目」会
 *   2. 子序列命中（原文按顺序不连续）—— 输入「项管」命中「项目管理器」
 *   3. 拼音命中（全拼 / 首字母 / 汉字与拼音混输）—— 输入 xiangmu、xmgl、项mu 都命中「项目管理器」
 *
 * 为什么不用 pinyin-pro 自带的 `match()`：它的 precision / continuous 组合是模糊子序列语义，
 * 无法表达「文字命中优先于拼音命中」的分档，也拿不到稳定的原文下标做高亮。
 * 这里只用它做「逐字取拼音」，对齐与打分自己做 —— 规则集中在 matchText 一处，
 * 六处搜索入口读的都是同一个函数。
 *
 * 拼音数据来自系统之外的固定词表（pinyin-pro）：多音字取该库默认读音（重庆 → chong），
 * 不做上下文消歧 —— 搜索场景下按常用读音命中即可。
 */

import { pinyin } from 'pinyin-pro';

/** 汉字区间：基本区 + 扩展 A + 兼容区 */
const HAN_RE = /[\u3400-\u9fff\uf900-\ufaff]/;
/** 可单独参与匹配的字母 / 数字（含拉丁扩展与全角） */
const WORD_RE = /[\p{L}\p{N}]/u;
/** 词首分隔符：命中落在这些字符之后时视为边界，排序上更靠前 */
const BOUNDARY = /[\s\-_/\\·.（）()【】[\]]/;

const CACHE_MAX = 400;

/** 原文 -> { lower, units }；同一段文字在一次输入里会被反复比较，必须缓存 */
const shapes = new Map();

/** 汉字判定：基本区 + 扩展 A + 兼容区；与 electron/services/domain/pinyin.js 保持同口径 */
function isHan(ch) {
  return !!ch && HAN_RE.test(ch);
}

/**
 * 一段文字的匹配形态：
 * - `lower`：原文小写，连续命中与子序列命中都用它，下标即原文下标
 * - `units`：可参与拼音对齐的单位 —— 汉字一个音节一个，字母/数字一个字一个，
 *   `at` 是该单位在原文里的下标（高亮用）
 *
 * 空白与标点不进 `units`：拼音查询不该被逼着把空格、括号也打出来；
 * 但它们在 `lower` 里保留，文字命中仍按原文原样比较。
 */
function shapeOf(text) {
  const raw = String(text == null ? '' : text);
  const hit = shapes.get(raw);
  if (hit) return hit;

  const chars = [...raw];
  // 纯拉丁 / 数字串没有拼音可算，省掉一次词表调用
  const py = chars.some(isHan) ? pinyin(raw, { toneType: 'none', type: 'array' }) : null;

  const units = [];
  let at = 0;
  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i];
    if (isHan(ch)) {
      const syl = py && py[i] ? String(py[i]).toLowerCase() : '';
      if (syl) units.push({ ch, at, py: syl });
    } else if (WORD_RE.test(ch)) {
      units.push({ ch, at, py: '', lit: ch.toLowerCase() });
    }
    at += ch.length;
  }

  const out = { lower: raw.toLowerCase(), units };
  if (shapes.size >= CACHE_MAX) shapes.clear();
  shapes.set(raw, out);
  return out;
}

function range(start, len) {
  const out = [];
  for (let i = 0; i < len; i += 1) out.push(start + i);
  return out;
}

/** 第 1 档：原文子串，命中越靠前、落在词首越好 */
function literalHit(lower, q) {
  const at = lower.indexOf(q);
  if (at < 0) return null;
  const boundary = at === 0 || BOUNDARY.test(lower[at - 1]);
  return { score: 800 + (boundary ? 160 : 0) + Math.max(0, 80 - at * 5), positions: range(at, q.length) };
}

/** 第 2 档：原文子序列，连续段越多、间隔越小、越靠前越好 */
function sequenceHit(lower, q) {
  const positions = [];
  let ti = 0;
  let prev = -2;
  let runs = 0;
  for (let qi = 0; qi < q.length; qi += 1) {
    const ch = q[qi];
    let found = -1;
    while (ti < lower.length) {
      if (lower[ti] === ch) {
        found = ti;
        break;
      }
      ti += 1;
    }
    if (found < 0) return null;
    if (found === prev + 1) runs += 1;
    positions.push(found);
    prev = found;
    ti = found + 1;
  }
  const gap = positions[positions.length - 1] - positions[0] + 1 - q.length;
  const score = 260 + runs * 26 + Math.max(0, 50 - positions[0] * 4) - gap * 3;
  return { score: Math.max(1, score), positions };
}

/**
 * 第 3 档：拼音顺序对齐。查询按字逐个消费单位：
 * - 查询里是汉字 → 必须对上原文的同一个汉字，跳过的单位不再回头
 * - 查询里是字母/数字 → 从当前拼音音节（或拉丁字符）的剩余部分开始找，找不到就换下一个单位
 *
 * 这一条规则同时覆盖三种输入：全拼（xiangmu）、首字母（xmgl）、混输（项mu、项目gl）。
 * 贪心而非回溯：命中与否的判定比「最优对齐」更值钱，回溯在最坏情况下会把每次按键变成指数级。
 */
function pinyinHit(shape, q) {
  const units = shape.units;
  if (!units.length) return null;

  let ui = 0;
  let off = 0;
  let first = -1;
  let last = -1;

  for (const qc of q) {
    if (isHan(qc)) {
      // 汉字不能落在音节内部：当前单位只消费了一半时，只能从下一个单位起算
      let k = off > 0 ? ui + 1 : ui;
      while (k < units.length && units[k].ch !== qc) k += 1;
      if (k >= units.length) return null;
      if (first < 0) first = k;
      last = k;
      ui = k + 1;
      off = 0;
      continue;
    }

    let k = ui;
    let o = off;
    let found = false;
    while (k < units.length) {
      const u = units[k];
      const s = u.py || u.lit;
      if (s) {
        const idx = s.indexOf(qc, o);
        if (idx >= 0) {
          found = true;
          ui = k;
          off = idx + 1;
          if (first < 0) first = k;
          last = k;
          break;
        }
      }
      k += 1;
      o = 0;
    }
    if (!found) return null;
  }

  // 覆盖的单位越少、起始越靠前越好：xiangmu 压过 xiangmuguanliqi 这类长跨度的弱命中。
  // 基数取 240 是为了让拼音命中整体落在子序列命中（260 起）之下、又不至于和 0 分混淆。
  const span = last - first + 1;
  const score = 240 - Math.min(80, (span - 1) * 6) - Math.min(60, first * 6);
  const positions = units.slice(first, last + 1).map((u) => u.at);
  return { score: Math.max(1, score), positions };
}

/**
 * 单次匹配：命中返回 `{ score, positions }`（positions 为原文下标，供高亮），否则 null。
 * 三档依次尝试，任何一档命中即返回 —— 调用方拿到的 score 已经包含档次差异。
 */
export function matchText(text, token) {
  const q = String(token == null ? '' : token).trim().toLowerCase();
  if (!q) return { score: 0, positions: [] };
  const shape = shapeOf(text);
  return literalHit(shape.lower, q) || sequenceHit(shape.lower, q) || pinyinHit(shape, q);
}

/** 只要布尔结果时的简写 */
export function matchesText(text, token) {
  return !!matchText(text, token);
}

/**
 * 把命中下标切成「普通 / 高亮」两类文本段，供组件渲染 `<mark>`。
 * 连续下标合并成一段 —— 中文逐字描边会在字与字之间留下断口，读起来是散的。
 * 下标可能来自 Set（顺序不定）或区间（含未实际命中但被覆盖的字），这里统一去重排序。
 */
export function highlightRuns(text, positions) {
  const raw = String(text == null ? '' : text);
  const list = positions ? [...new Set(positions)].sort((a, b) => a - b) : [];
  if (!list.length) return [{ text: raw, mark: false }];
  const out = [];
  let cursor = 0;
  let i = 0;
  while (i < list.length) {
    const start = list[i];
    let end = start;
    while (i + 1 < list.length && list[i + 1] === end + 1) {
      i += 1;
      end = list[i];
    }
    if (start > cursor) out.push({ text: raw.slice(cursor, start), mark: false });
    out.push({ text: raw.slice(start, end + 1), mark: true });
    cursor = end + 1;
    i += 1;
  }
  if (cursor < raw.length) out.push({ text: raw.slice(cursor), mark: false });
  return out;
}

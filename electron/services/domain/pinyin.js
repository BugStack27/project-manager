'use strict';

/**
 * 全局搜索用的拼音命中判定（主进程唯一实现）。
 *
 * 口径与渲染进程 `web/src/lib/pinyin.js` 同源：先把查询逐字对着原文的「拼音音节 / 拉丁字符」顺序消费，
 * 命中则视为匹配（全拼 xiangmu、首字母 xmgl、汉字与拼音混输 项mu 都算）。
 * 差别只有一处，且是刻意的：
 * - 渲染进程的候选面板（@ 项目、/ 技能、Ctrl+O、侧栏、Ctrl+P）走「连续命中 > 子序列 > 拼音」三档打分，
 *   因为它们要排序、要高亮；
 * - 这里只回答「是不是命中」，不做子序列模糊 —— 全局搜索扫的是正文与日志，
 *   子序列放宽到那种程度会把几乎每条都算命中，结果反而不可用。
 *
 * 为什么自己写对齐而不用 pinyin-pro 的 `match()`：那是模糊子序列语义，
 * 与上面「不做子序列」的分工冲突，行为也无法在上面的三档里表达。
 * 这里只用它做「逐字取拼音」。
 */

const { pinyin } = require('pinyin-pro');

/** 汉字判定：基本区 + 扩展 A + 兼容区；与 web/src/lib/pinyin.js 保持同口径 */
const HAN_RE = /[\u3400-\u9fff\uf900-\ufaff]/;
/** 中文查询里至少要有这些字符，拼音档才可能命中 */
const LATIN_RE = /[\p{Script=Latin}\p{Nd}]/u;
/** 可单独参与对齐的字母 / 数字（含拉丁扩展与全角） */
const WORD_RE = /[\p{L}\p{N}]/u;

const CACHE_MAX = 500;
const shapes = new Map();

/**
 * 一段文字的匹配形态：`lower` 供子串比较，`units` 是拼音对齐用的单位表
 * （汉字一个音节一个、字母/数字一个字一个，空白与标点不进表）。
 */
function shapeOf(text) {
  const raw = String(text == null ? '' : text);
  const hit = shapes.get(raw);
  if (hit) return hit;

  const chars = [...raw];
  const py = chars.some((ch) => HAN_RE.test(ch)) ? pinyin(raw, { toneType: 'none', type: 'array' }) : null;

  const units = [];
  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i];
    if (HAN_RE.test(ch)) {
      const syl = py && py[i] ? String(py[i]).toLowerCase() : '';
      if (syl) units.push({ ch, py: syl });
    } else if (WORD_RE.test(ch)) {
      units.push({ ch, py: '', lit: ch.toLowerCase() });
    }
  }

  const out = { lower: raw.toLowerCase(), units };
  if (shapes.size >= CACHE_MAX) shapes.clear();
  shapes.set(raw, out);
  return out;
}

/** 按顺序消费查询：汉字对汉字，字母对音节（或拉丁字符）的剩余部分；贪心不回溯 */
function align(units, q) {
  let ui = 0;
  let off = 0;
  for (const qc of q) {
    if (HAN_RE.test(qc)) {
      let k = off > 0 ? ui + 1 : ui;
      while (k < units.length && units[k].ch !== qc) k += 1;
      if (k >= units.length) return false;
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
          break;
        }
      }
      k += 1;
      o = 0;
    }
    if (!found) return false;
  }
  return true;
}

/**
 * text 是否命中查询：子串（不区分大小写）或拼音。
 * 两处提前退出把绝大多数调用挡在词表之外：
 * - 原文没有汉字 → 拼音档不可能提供新命中；
 * - 查询没有拉丁字母 / 数字 → 拼音档不可能提供新命中（纯汉字查询只能字面命中）。
 */
function matches(text, query) {
  const q = String(query == null ? '' : query).trim().toLowerCase();
  if (!q) return true;
  const raw = String(text == null ? '' : text);
  if (!raw) return false;
  if (raw.toLowerCase().includes(q)) return true;
  if (!HAN_RE.test(raw) || !LATIN_RE.test(q)) return false;
  return align(shapeOf(raw).units, q);
}

module.exports = { matches };

'use strict';

/**
 * 需求正文里的技能关联：`{UseSkill:技能id}`。
 *
 * 与 refs.js 同构，只换正则与数据源 —— 两个模块的纪律必须一致，否则会出现
 * 「界面说有、agent 说没有」这种两处判定打架的状态：
 * - 服务端只做解析，不存副本：需求上不存 skills 数组。技能目录会随换机器、升级客户端
 *   而移动，缓存一份绝对路径比缓存项目 id 更容易变味；解析失败就诚实地说 `exists:false`。
 * - 同一份结论随 `reqView.skills` 下发（列表 / 详情 / `/next` / `/claim`），
 *   前端与 agent 读到的永远是一次解析的结果。
 * - 名字不含花括号、不跨行、最长 60 字符；超出的不当作关联，避免把正文里的普通文本吞进去。
 * - 围栏代码块里的 `{UseSkill:x}` 是示例文本，不解析（同 refs.js 的处理）。
 * - 裸名（手打的情况）在全局唯一时命中；重名时取第一个并 `ambiguous: true`，
 *   `candidates` 列出全部 —— 和 refs 的重名策略一致。补全插入的永远是限定 id。
 */

const fs = require('fs');
const skillScan = require('../skill-scan');

/** 与前端 lib/skill-refs.js 保持同一套边界 */
const SKILL_RE = /\{UseSkill:([^{}\n]{1,60})\}/gi;
const NAME_MAX = 60;
const FENCE_RE = /^\s*(```|~~~)/;

/** 正文里出现的技能名（去重保序，保留书写顺序） */
function skillNames(text) {
  const src = String(text || '');
  if (!/useSkill:/i.test(src)) return [];
  const out = [];
  let fenced = false;
  const re = new RegExp(SKILL_RE.source, 'gi');
  for (const line of src.split('\n')) {
    if (FENCE_RE.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(line))) {
      const name = String(m[1]).trim();
      if (!name || name.length > NAME_MAX || out.includes(name)) continue;
      out.push(name);
    }
  }
  return out;
}

function entryExists(s) {
  try {
    return !!s.entry && fs.existsSync(s.entry);
  } catch (_) {
    return false;
  }
}

/**
 * 把正文里的 `{UseSkill:x}` 解析成「技能坐标 + 够用的技能信息」。
 *
 * **不按 Agent 归属过滤**：技能是一份目录，路径给到谁，谁就能读，与登记在哪个 Agent 名下无关。
 * 因此解析结果与认领人无关，任何 agent 拿到的都是同一个 `dir` / `entry`；
 * 解析不到只有「本机没有这个技能」一种情况（`skillId:null, reason:'not_found'`）。
 *
 * @param {string} text 需求正文
 * @param {{skills?: Array}=} ctx skills 缺省用扫描缓存
 */
function resolveSkills(text, ctx) {
  const names = skillNames(text);
  if (!names.length) return [];

  let list = ctx && ctx.skills;
  if (!Array.isArray(list)) list = skillScan.list();

  const byId = new Map();
  const byName = new Map();
  for (const s of list) {
    byId.set(String(s.id).toLowerCase(), s);
    const key = String(s.name).toLowerCase();
    const hit = byName.get(key);
    if (hit) hit.push(s);
    else byName.set(key, [s]);
  }

  return names.map((name) => {
    const key = name.toLowerCase();
    let hits;
    if (name.includes('/')) {
      const one = byId.get(key);
      hits = one ? [one] : [];
    } else {
      hits = byName.get(key) || [];
    }

    /** 不做归属过滤：同名重取第一个，`candidates` 列出全部 */
    const s = hits[0];

    if (!s) {
      // 解析失败时把用户写的原文带回：agent 至少知道这条任务要求的是什么技能。
      return {
        name,
        skillId: null,
        source: null,
        dir: null,
        entry: null,
        description: '',
        exists: false,
        ambiguous: false,
        candidates: [],
        reason: 'not_found'
      };
    }
    return {
      name,
      skillId: s.id,
      source: s.source,
      dir: s.dir,
      entry: s.entry,
      description: s.description || '',
      exists: entryExists(s),
      /** 同名技能分布在多个客户端目录：取的是第一个，agent 需要时可看 candidates 换个读 */
      ambiguous: hits.length > 1,
      candidates: hits.map((x) => x.id),
      reason: null
    };
  });
}

module.exports = { SKILL_RE, NAME_MAX, skillNames, resolveSkills };

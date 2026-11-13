/**
 * 需求正文里的技能关联 `{UseSkill:技能id}` —— 前端这一侧只做四件事：
 * 在输入框里给候选补全、把用户选中的技能写成固定 token、把 token 换成 chip 链接
 * （与 `@{项目名}` 同一套做法，见 req-refs.js）、把 token 截出来做展示。
 *
 * 解析（哪个 id 指向哪个目录、重名取哪一个、目录还在不在）一律以服务端返回的
 * `requirement.skills` 为准，这里不查、不猜 —— 与 refs 同一条纪律：
 * 界面上说「找到了」而 agent 那边说「没找到」是最糟的状态。
 * SKILL_RE 的边界（1–60 字符、不含花括号与换行）必须与 electron/services/domain/skill-refs.js 一致。
 */

import { api } from '../api.js';
import { matchText } from './pinyin.js';

/** `{UseSkill:id}`；id 不含花括号、不跨行 */
const SKILL_RE = /\{UseSkill:([^{}\n]{1,60})\}/gi;
const NAME_MAX = 60;

/** 围栏代码块：块内的 `{UseSkill:x}` 是示例文本，不当关联处理（与 req-refs / 服务端一致） */
const FENCE_RE = /^\s*(```|~~~)/;

/** chip 链接协议：`pm-skill:<encodeURIComponent(技能名)>` —— 只带名字，解析结果仍从 reqView.skills 查 */
const SKILL_HREF_RE = /^pm-skill:(.*)$/;

/**
 * 裸 `/` 前面必须是行首或空白。
 * 比 `@` 的触发条件更严：正文是 markdown，路径与 URL 里的斜杠远比邮箱多，
 * `web/src`、`D:/job`、`http://` 的斜杠前面是字母或冒号，这一条把它们全排掉。
 */
const TRIGGER_RE = /(^|\s)$/;

/**
 * 光标处正在输入的技能片段：返回 `{ start, query }`（start 是 `/` 的下标），没有则 null。
 * - 只认「行首或空白后的第一个 `/`」：`web/src`、`D:/job`、`http://` 的斜杠前面都不是空白，天然排除；
 * - 已经在成形的 `{UseSkill:…}` 里时不再弹候选，避免把 token 拆坏。
 */
export function activeSkillQuery(text, caret) {
  const src = String(text || '');
  const end = Math.max(0, Math.min(caret === undefined || caret === null ? src.length : caret, src.length));
  const before = src.slice(0, end);
  const at = before.lastIndexOf('/');
  if (at < 0) return null;

  const seg = before.slice(at + 1);
  if (seg.includes('\n') || /[\s{}]/.test(seg) || seg.length > NAME_MAX) return null;
  if (!TRIGGER_RE.test(before.slice(0, at))) return null;

  const open = before.lastIndexOf('{UseSkill:');
  if (open >= 0 && before.indexOf('}', open) < 0) return null;

  return { start: at, query: seg };
}

/**
 * 用 `{UseSkill:id}` 替换光标所在的那段输入。
 * 光标落在已成形的 token 中间时整块替换；只吃紧挨着的一个 `}`，多余的括号留给用户自己删。
 */
export function applySkill(text, start, caret, id) {
  const src = String(text || '');
  const from = Math.max(0, Math.min(start, src.length));
  const to = Math.max(from, Math.min(caret === undefined || caret === null ? src.length : caret, src.length));

  let tail = to;
  const close = src.indexOf('}', from);
  if (src.startsWith('{UseSkill:', from) && close > from && separate(src, from, close)) {
    tail = close + 1;
  } else if (src[to] === '}') {
    tail = to + 1;
  }

  const token = '{UseSkill:' + String(id || '').trim() + '}';
  return { text: src.slice(0, from) + token + src.slice(tail), caret: from + token.length };
}

function separate(src, from, close) {
  const inner = src.slice(from, close);
  return !inner.includes('\n') && inner.length <= NAME_MAX + 11;
}

/**
 * 把正文里的 `{UseSkill:x}` 换成 markdown 链接，供 MarkdownText 渲染成 chip。
 * 不做这层替换时正文里就是一串原始字符 —— 正文能引用项目却不能引用技能，读起来也对不上。
 * 代码块原样跳过：那里的 token 是给人看的示例。名字里带方括号时退化成固定 label
 * （`[` `]` 会截断 markdown 链接语法），chip 的显示名本来也不读 label。
 */
export function linkifySkills(text, skills) {
  const src = String(text || '');
  if (!/useSkill:/i.test(src)) return src;

  let fenced = false;
  return src
    .split('\n')
    .map((line) => {
      if (FENCE_RE.test(line)) {
        fenced = !fenced;
        return line;
      }
      if (fenced) return line;
      return line.replace(SKILL_RE, (raw, name) => {
        const clean = String(name).trim();
        if (!clean) return raw;
        const label = /[[\]]/.test(clean) ? '/skill' : '/' + clean;
        return '[' + label + '](pm-skill:' + encodeURIComponent(clean) + ')';
      });
    })
    .join('\n');
}

/** 从 chip 的 href 里取回正文里写的技能名 */
export function readSkillHref(href) {
  const m = SKILL_HREF_RE.exec(String(href || ''));
  if (!m) return null;
  let name = m[1];
  try {
    name = decodeURIComponent(m[1]);
  } catch (_) {
    /* 编码坏了就按原文显示 */
  }
  return { name };
}

/** 正文 token 对应的服务端解析结果：先精确匹配，再忽略大小写（SKILL_RE 本身不区分大小写） */
export function findSkill(skills, name) {
  const key = String(name || '').trim();
  if (!key) return null;
  const list = Array.isArray(skills) ? skills : [];
  const hit = list.find((s) => s && String(s.name).trim() === key);
  if (hit) return hit;
  const lower = key.toLowerCase();
  return list.find((s) => s && String(s.name).trim().toLowerCase() === lower) || null;
}

/**
 * 失效态：只有「本机没有这个技能」与「目录已不在」才标红。
 * 技能不按 Agent 归属过滤，目录属于谁都一样能读，所以不存在「归别人」的失效态。
 */
export function skillMissing(sk) {
  return !(sk && sk.skillId && sk.exists);
}

/**
 * chip 与「使用技能」清单共用的悬浮说明：两处都说同一句话，
 * 否则同一个技能在正文和清单里给出两种解释。
 */
export function skillTip(sk) {
  if (!sk) return '没有找到这个技能：检查名字是否写错，或重新输入 / 选一个';
  if (sk.skillId) {
    return [
      sk.dir,
      sk.description,
      sk.exists ? '' : '技能目录已不存在：换机器或删了客户端，agent 会因此向你提问',
      sk.ambiguous ? '有同名技能，这里取第一个：' + (sk.candidates || []).join('、') : '',
    ]
      .filter(Boolean)
      .join(' · ');
  }
  return '没有找到这个技能：检查名字是否写错，或重新输入 / 选一个';
}

/** 正文里出现的技能 id（去重保序）：只在需要提示「有几个技能」时用，解析仍以服务端为准 */
export function skillNames(text) {
  const src = String(text || '');
  if (!/useSkill:/i.test(src)) return [];
  const out = [];
  SKILL_RE.lastIndex = 0;
  let m;
  while ((m = SKILL_RE.exec(src))) {
    const name = String(m[1]).trim();
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

/**
 * 候选技能：id / 名字 / 描述三处都参与匹配（文字 → 子序列 → 拼音，口径见 `lib/pinyin.js`），
 * 权重按「id ≥ 名字 > 描述」排；失效技能（目录已不在）整体沉底但不过滤掉。
 * 同名技能分布在多个客户端目录时两条都会出现，靠 `source/` 前缀区分 —— 这类重名在本机很常见。
 */
export function skillCandidates(skills, query) {
  const q = String(query || '').trim();
  const list = (Array.isArray(skills) ? skills : []).filter((s) => s && s.id);
  if (!q) return list.slice().sort((a, b) => (a.exists === false ? 1 : 0) - (b.exists === false ? 1 : 0)).slice(0, 8);

  const rows = [];
  for (const s of list) {
    const byId = matchText(s.id, q);
    const byName = matchText(s.name, q);
    // 描述是一整句话，拼音容易散命中：整体折半，保证排在任何 id / 名字命中之后
    const byDesc = matchText(s.description, q);
    const best = Math.max(byId ? byId.score + 40 : 0, byName ? byName.score : 0, byDesc ? byDesc.score * 0.5 : 0);
    if (!best) continue;
    // 失效技能（目录已不在）沉底但保留，用户还得看得见「它没了」
    rows.push({ s, score: best - (s.exists === false ? 30 : 0) });
  }
  rows.sort((a, b) => b.score - a.score);
  return rows.slice(0, 8).map((r) => r.s);
}

/** 进程内只取一次清单：两个弹窗同时开着也只发一次 IPC */
let cache = null;

export function loadSkills() {
  if (!cache) {
    cache = api
      .skills()
      .then((data) => (data && Array.isArray(data.skills) ? data.skills : []))
      .catch(() => []);
  }
  return cache;
}

/** 重扫后让下一次 loadSkills 重新取：只有界面上的「重新扫描」按钮会用到 */
export function invalidateSkills() {
  cache = null;
}

/**
 * Agent 注册表缓存：技能清单里的 `agents` 只有 id，悬浮窗要说得出名字。
 * 与 loadSkills 同一套做法；注册表变了由接入弹窗显式失效，否则改名后要刷新页面才见效。
 */
let agentCache = null;

export function loadAgentList() {
  if (!agentCache) {
    agentCache = api
      .agents()
      .then((res) => (res && Array.isArray(res.agents) ? res.agents : []))
      .catch(() => {
        // 读失败不缓存空表：下次悬浮还要能重新取，否则这一次误判会一直留着
        agentCache = null;
        return [];
      });
  }
  return agentCache;
}

export function invalidateAgentList() {
  agentCache = null;
}

/** 路径比较口径：分隔符与末尾斜杠不敏感，Windows 下大小写不敏感（与服务端 skill-scan 一致） */
function normDir(p) {
  const s = String(p || '')
    .trim()
    .replace(/[\\/]+/g, '/')
    .replace(/\/+$/, '');
  return /^[A-Za-z]:/.test(s) ? s.toLowerCase() : s;
}

/**
 * `dir` 是否就是 `parent` 或在它下面。技能目录的归属一律按这个口径判断，
 * 与服务端 `agentsForDir` / `skillsUnder` 保持一致。
 */
export function sameOrUnder(dir, parent) {
  const d = normDir(dir);
  const p = normDir(parent);
  return !!d && !!p && (d === p || d.startsWith(p + '/'));
}

/**
 * 某个目录下的技能（含子目录里的）：Agent 卡片上「这个目录有几个技能」用它。
 * 归属以目录前缀为准，同一目录挂在多个 Agent 名下会各算一次 —— 与共享目录的语义一致。
 */
export function skillsUnder(skills, dir) {
  const d = normDir(dir);
  if (!d) return [];
  return (Array.isArray(skills) ? skills : []).filter((s) => {
    const x = normDir(s && s.dir);
    return !!x && (x === d || x.startsWith(d + '/'));
  });
}

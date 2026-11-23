/**
 * 需求正文里的跨项目引用 `@{项目名}` —— 前端这一侧只做三件事：
 * 把正文切成「文本 / 引用」并转成 markdown 链接、渲染成 chip、在输入框里给候选补全。
 *
 * 解析（重名怎么取、项目已归档、名字大小写）一律以服务端返回的 `requirement.refs` 为准，
 * 这里不再自己查项目名 —— 同一份数据两处判定，界面上说「找到了」而 agent 那边说「没找到」是最糟的状态。
 * REF_RE 的边界（1–60 字符、不含花括号与换行）必须与 electron/services/domain/refs.js 一致。
 */

import { matchText } from './pinyin.js';

/** `@` + `{名称}`；名称不含花括号、不跨行 */
const REF_RE = /@\{([^{}\n]{1,60})\}/g;
const NAME_MAX = 60;

/** 需求引用 `@{#序号}`、文件引用 `@{file:相对路径}`：边界与服务端 domain/refs.js 一致 */
const REQ_REF_RE = /@\{#(\d{1,7})\}/g;
const FILE_REF_RE = /@\{file:([^{}\n]{1,235})\}/gi;
const FILE_MAX = 235;

/** chip 链接协议：需求 `pm-req:<seq>`、文件 `pm-file:<encodeURIComponent(路径)>` */
const REQ_HREF_RE = /^pm-req:(\d{1,7})$/;
const FILE_HREF_RE = /^pm-file:(.*)$/;

/** 围栏代码块：块内的 `@{x}` 是示例文本，不当引用处理 */
const FENCE_RE = /^\s*(```|~~~)/;

/** 裸 `@` 前面必须是行首或分隔符，否则邮箱、路径里的 @ 会被当成引用开头 */
const REF_TRIGGER_RE = /(^|[\s，。、；：！？,.;:!?（(【[「])$/;

/** chip 链接协议：`pm-ref:<encodeURIComponent(名字)>:<项目id 或空>` */
const REF_HREF_RE = /^pm-ref:([^:]*):(.*)$/;

/**
 * 需求 / 文件引用 token 不算项目名：与服务端 `domain/refs.js` 的 refNames 同口径。
 * 少了这一步，`@{#34}` / `@{file:a.js}` 会被项目引用的宽匹配先吃掉，
 * 正文里就只会剩一个 projectId 为空的「没有找到项目」红 chip —— 需求和文件引用同时消失。
 */
function isSpecialRef(name) {
  return /^#\d/.test(name) || /^file:/i.test(name);
}

/** 正文里引用的名字（去重保序） */
export function refNames(text) {
  const src = String(text || '');
  if (src.indexOf('@{') < 0) return [];
  const out = [];
  REF_RE.lastIndex = 0;
  let m;
  while ((m = REF_RE.exec(src))) {
    const name = String(m[1]).trim();
    if (!name || isSpecialRef(name) || out.includes(name)) continue;
    out.push(name);
  }
  return out;
}

/**
 * 把正文里的引用换成 markdown 链接，供 MarkdownText 渲染成 chip。
 * 代码块原样跳过：那里的 `@{x}` 是给人看的示例，点它会跳走反而碍事。
 * 名字里带方括号时退化成固定 label（`[` `]` 会截断 markdown 链接语法），chip 的名字本来也不读 label。
 * 需求 / 文件 token 原样留着，让后面的 linkifyReqRefs / linkifyFileRefs 接管 ——
 * REF_RE 是通用词法，不跳过它们就会先把 `@{#34}` 变成 `pm-ref:` 链接，解析成「没找到项目」。
 */
export function linkifyRefs(text, refs) {
  const src = String(text || '');
  if (src.indexOf('@{') < 0) return src;

  const byName = new Map();
  for (const r of refs || []) {
    if (r && r.name) byName.set(String(r.name).trim().toLowerCase(), r);
  }

  let fenced = false;
  return src
    .split('\n')
    .map((line) => {
      if (FENCE_RE.test(line)) {
        fenced = !fenced;
        return line;
      }
      if (fenced) return line;
      return line.replace(REF_RE, (raw, name) => {
        const clean = String(name).trim();
        if (isSpecialRef(clean)) return raw;
        const ref = byName.get(clean.toLowerCase());
        const id = ref && ref.projectId ? ref.projectId : '';
        const label = /[[\]]/.test(clean) ? '@ref' : '@' + clean;
        return '[' + label + '](pm-ref:' + encodeURIComponent(clean) + ':' + id + ')';
      });
    })
    .join('\n');
}

/** 从 chip 的 href 里取回名字与项目 id（id 为空串表示没解析到项目） */
export function readRefHref(href) {
  const m = REF_HREF_RE.exec(String(href || ''));
  if (!m) return null;
  let name = m[1];
  try {
    name = decodeURIComponent(m[1]);
  } catch (_) {
    /* 编码坏了就按原文显示，不影响点击 */
  }
  return { name, projectId: m[2] || '' };
}

/**
 * 光标处正在输入的引用片段：返回 `{ start, query }`（start 是 `@` 的下标），没有则 null。
 * 已有 `{` 时把括号内的内容当 query，这样 `@{管理` 也会继续给候选。
 */
export function activeRefQuery(text, caret) {
  const src = String(text || '');
  const end = Math.max(0, Math.min(caret === undefined || caret === null ? src.length : caret, src.length));
  const before = src.slice(0, end);
  const at = before.lastIndexOf('@');
  if (at < 0) return null;

  const seg = before.slice(at + 1);
  if (seg.includes('\n') || seg.includes('}')) return null;
  const braced = seg.startsWith('{');
  const inner = braced ? seg.slice(1) : seg;
  // 文件路径可以比项目名长得多：按是否 file: 前缀放宽上限，项目名边界保持不变
  const cap = /^file:/i.test(inner) ? FILE_MAX + 6 : NAME_MAX + 1;
  if (inner.length > cap) return null;

  if (braced) {
    if (inner.includes('{') || /\s/.test(inner)) return null;
    return { start: at, query: inner };
  }

  if (/\s/.test(seg)) return null;
  if (!REF_TRIGGER_RE.test(before.slice(0, at))) return null;
  return { start: at, query: seg };
}

/**
 * 用 `@{inner}` 替换光标所在的那段引用输入。
 * 光标落在已成形的 `@{...}` 中间时整块替换 —— 否则会拼出 `@{项目管理器}理}` 这种东西。
 * 只吃紧挨着的一个 `}`，多余的括号留给用户自己删。cap 是「成形块」的最大长度（文件路径比项目名长）。
 */
function applyToken(text, start, caret, inner, cap) {
  const src = String(text || '');
  const from = Math.max(0, Math.min(start, src.length));
  const to = Math.max(from, Math.min(caret === undefined || caret === null ? src.length : caret, src.length));

  let tail = to;
  const close = src.indexOf('}', from);
  if (
    src.startsWith('@{', from) &&
    close > from &&
    close - from <= cap &&
    !src.slice(from, close).includes('\n')
  ) {
    tail = close + 1;
  } else if (src[to] === '}') {
    tail = to + 1;
  }

  const token = '@{' + String(inner || '').trim() + '}';
  return { text: src.slice(0, from) + token + src.slice(tail), caret: from + token.length };
}

/** 插入项目引用 `@{项目名}` */
export function applyRef(text, start, caret, name) {
  return applyToken(text, start, caret, name, NAME_MAX + 2);
}

/** 插入需求引用 `@{#序号}` */
export function applyReqRef(text, start, caret, seq) {
  return applyToken(text, start, caret, '#' + seq, NAME_MAX + 2);
}

/** 插入文件引用 `@{file:相对路径}` */
export function applyFileRef(text, start, caret, path) {
  return applyToken(text, start, caret, 'file:' + path, FILE_MAX + 7);
}

/**
 * 候选项目：名称匹配（文字 → 子序列 → 拼音，口径见 `lib/pinyin.js`），
 * 已归档与当前项目排后面，因为引用大多是想让 agent 去看「别的项目」；
 * 同一档里按匹配得分降序，上限 8 条，够选就行。
 */
export function refCandidates(projects, query, currentProjectId) {
  const q = String(query || '').trim();
  const list = (Array.isArray(projects) ? projects : []).filter((p) => p && p.name);
  const rank = (p) => (p.archived ? 2 : 0) + (p.id === currentProjectId ? 1 : 0);
  if (!q) return list.slice().sort((a, b) => rank(a) - rank(b)).slice(0, 8);

  const rows = [];
  for (const p of list) {
    const hit = matchText(p.name, q);
    if (!hit) continue;
    rows.push({ p, rank: rank(p), score: hit.score });
  }
  rows.sort((a, b) => a.rank - b.rank || b.score - a.score);
  return rows.slice(0, 8).map((r) => r.p);
}

/**
 * 光标处的 @ 查询属于哪一类：`#…` 选需求、`file:…` 选文件、其余统一列「项目 / 需求 / 文件」三组。
 * 返回 { mode: 'req'|'file'|'all', q }（q 是去掉类型前缀后的匹配词）。
 */
export function classifyRefQuery(query) {
  const q = String(query || '');
  if (q.startsWith('#')) return { mode: 'req', q: q.slice(1) };
  if (/^file:/i.test(q)) return { mode: 'file', q: q.slice(5) };
  return { mode: 'all', q };
}

/** 需求候选：按 seq（数字前缀）或标题匹配，排除当前需求自身；空查询按编号倒序取最近 8 条 */
export function reqCandidates(requirements, query, currentSeq) {
  const q = String(query || '').trim();
  const list = (Array.isArray(requirements) ? requirements : []).filter(
    (r) => r && typeof r.seq === 'number' && r.seq !== currentSeq
  );
  if (!q) return list.slice().sort((a, b) => b.seq - a.seq).slice(0, 8);

  const rows = [];
  for (const r of list) {
    const seqStr = String(r.seq);
    let score = 0;
    if (/^\d+$/.test(q)) {
      if (seqStr === q) score = 200;
      else if (seqStr.startsWith(q)) score = 120;
    }
    const byTitle = matchText(r.title || '', q);
    if (byTitle) score = Math.max(score, byTitle.score);
    if (!score) continue;
    rows.push({ r, score });
  }
  rows.sort((a, b) => b.score - a.score || b.r.seq - a.r.seq);
  return rows.slice(0, 8).map((x) => x.r);
}

/** 文件 / 目录候选：全路径与末尾名字都参与匹配（名字命中加权）；同分时目录在前，空查询同理 */
export function fileCandidates(files, query) {
  const q = String(query || '').trim();
  const list = (Array.isArray(files) ? files : []).filter((f) => f && f.path);
  /** 目录排在同分文件前：引用文件夹是本次扩展的主用途 */
  const dirRank = (f) => (f.directory ? 0 : 1);
  if (!q) {
    return list
      .slice()
      .sort((a, b) => dirRank(a) - dirRank(b) || a.path.localeCompare(b.path))
      .slice(0, 8);
  }

  const rows = [];
  for (const f of list) {
    const hit = matchText(f.path, q);
    const base = f.path.split('/').pop();
    const baseHit = matchText(base, q);
    const score = Math.max(hit ? hit.score : 0, baseHit ? baseHit.score + 20 : 0);
    if (!score) continue;
    rows.push({ f, score });
  }
  rows.sort((a, b) => b.score - a.score || dirRank(a.f) - dirRank(b.f) || a.f.path.localeCompare(b.f.path));
  return rows.slice(0, 8).map((x) => x.f);
}

/** 把 `@{#序号}` 换成 pm-req: 链接（chip 显示名由 MarkdownText 按 reqRefs 补全），代码块跳过 */
export function linkifyReqRefs(text) {
  const src = String(text || '');
  if (src.indexOf('@{#') < 0) return src;
  let fenced = false;
  return src
    .split('\n')
    .map((line) => {
      if (FENCE_RE.test(line)) {
        fenced = !fenced;
        return line;
      }
      if (fenced) return line;
      return line.replace(REQ_REF_RE, (raw, seq) => '[#' + seq + '](pm-req:' + seq + ')');
    })
    .join('\n');
}

/** 把 `@{file:路径}` 换成 pm-file: 链接，代码块跳过；路径带方括号时退化成固定 label */
export function linkifyFileRefs(text) {
  const src = String(text || '');
  if (!/@\{file:/i.test(src)) return src;
  let fenced = false;
  return src
    .split('\n')
    .map((line) => {
      if (FENCE_RE.test(line)) {
        fenced = !fenced;
        return line;
      }
      if (fenced) return line;
      return line.replace(FILE_REF_RE, (raw, p) => {
        const clean = String(p).trim();
        if (!clean) return raw;
        const label = /[[\]]/.test(clean) ? '@file' : clean;
        return '[' + label + '](pm-file:' + encodeURIComponent(clean) + ')';
      });
    })
    .join('\n');
}

/** 从 chip href 取回需求 seq */
export function readReqHref(href) {
  const m = REQ_HREF_RE.exec(String(href || ''));
  return m ? { seq: parseInt(m[1], 10) } : null;
}

/** 从 chip href 取回文件相对路径 */
export function readFileHref(href) {
  const m = FILE_HREF_RE.exec(String(href || ''));
  if (!m) return null;
  let p = m[1];
  try {
    p = decodeURIComponent(m[1]);
  } catch (_) {
    /* 编码坏了就按原文显示 */
  }
  return { path: p };
}

/** 正文 token 对应的服务端解析结果（需求按 seq、文件按相对路径） */
export function findReqRef(reqRefs, seq) {
  return (Array.isArray(reqRefs) ? reqRefs : []).find((r) => r && r.seq === seq) || null;
}

export function findFileRef(fileRefs, path) {
  const key = String(path || '');
  return (Array.isArray(fileRefs) ? fileRefs : []).find((f) => f && f.path === key) || null;
}

'use strict';

/**
 * 需求正文里的引用，统一用 `@{…}` 触发，按花括号内的前缀分三类：
 * - `@{项目名}`：跨项目引用（无前缀，沿用旧语法）。
 * - `@{#序号}`：引用本项目的一条需求，按稳定 seq 定位（如 `@{#30}`）。
 * - `@{file:相对路径}`：引用本项目的一个文件（如 `@{file:web/src/App.jsx}`）。
 *
 * 设计要点：
 * - 语法只认 `@{名称}`：花括号让「项目名里有空格」也能一眼看出边界，比裸 @ 提及更不容易误判。
 *   名称不含花括号、不跨行；项目名最长 60 字符，文件路径最长 235 字符 —— 超出的不当作引用。
 * - 服务端只做解析，不存副本：项目名改了 / 需求归档了 / 文件删了，正文里的旧写法会解析失败，
 *   前端据此显示失效态，比在库里缓存一份 id 更诚实（缓存会悄悄指向旧对象）。
 * - 同名项目取「未归档优先、库里靠前」的那一个，并用 ambiguous 标出有重名。
 * - 需求引用只认本项目：seq 在项目内唯一且稳定，比标题更适合做锚点（标题会改、会超长）。
 * - 文件引用只给坐标（绝对路径 + 是否存在），不预读内容：与项目引用同一条纪律，
 *   理解文件是 agent 按路径自己做的事，预读会让 /next 变慢且长度不可控。
 * - 解析结果随 `reqView.refs` / `reqRefs` / `fileRefs` 下发（列表 / 详情 / `/next` / `/claim` 同一份）。
 */

const fs = require('fs');
const { UNFINISHED } = require('./constants');
const { DENY_RE, assertRelPath, resolveInside } = require('../snippet');

/** 与前端 lib/req-refs.js 保持同一套边界：`@` + `{名称}`，名称 1–60 字符、不含花括号与换行 */
const REF_RE = /@\{([^{}\n]{1,60})\}/g;
const NAME_MAX = 60;
/** 每个被引用项目带几条未完成需求：够看出「它在做什么」，又不至于把 /next 的载荷撑大 */
const PENDING_MAX = 5;

/** 需求引用 `@{#序号}`：seq 是 1–7 位数字（项目内唯一、稳定） */
const REQ_REF_RE = /@\{#(\d{1,7})\}/g;
/** 文件引用 `@{file:相对路径}`：路径不含花括号与换行，最长 235 字符 */
const FILE_REF_RE = /@\{file:([^{}\n]{1,235})\}/gi;
const FILE_MAX = 235;

/** 正文里出现的引用名（去重保序，保留用户书写顺序）；需求 / 文件 token 另有解析，这里跳过 */
function refNames(text) {
  const src = String(text || '');
  if (src.indexOf('@{') < 0) return [];
  const out = [];
  REF_RE.lastIndex = 0;
  let m;
  while ((m = REF_RE.exec(src))) {
    const name = String(m[1]).trim();
    if (!name || name.length > NAME_MAX || out.includes(name)) continue;
    if (/^#\d/.test(name) || /^file:/i.test(name)) continue;
    out.push(name);
  }
  return out;
}

/** 正文里引用的需求 seq（去重保序） */
function reqRefSeqs(text) {
  const src = String(text || '');
  if (src.indexOf('@{#') < 0) return [];
  const out = [];
  REQ_REF_RE.lastIndex = 0;
  let m;
  while ((m = REQ_REF_RE.exec(src))) {
    const seq = parseInt(m[1], 10);
    if (!Number.isFinite(seq) || out.includes(seq)) continue;
    out.push(seq);
  }
  return out;
}

/** 正文里引用的文件相对路径（去重保序） */
function fileRefPaths(text) {
  const src = String(text || '');
  if (!/@\{file:/i.test(src)) return [];
  const out = [];
  const re = new RegExp(FILE_REF_RE.source, 'gi');
  let m;
  while ((m = re.exec(src))) {
    const p = String(m[1]).trim();
    if (!p || p.length > FILE_MAX || out.includes(p)) continue;
    out.push(p);
  }
  return out;
}

/**
 * 把正文里的引用解析成「项目坐标 + 够用的项目信息」。
 * @param {string} text 需求正文
 * @param {{projects?: Array, requirements?: Array}=} ctx 数据源（缺省读库）
 */
function resolveRefs(text, ctx) {
  const names = refNames(text);
  if (!names.length) return [];

  let list = ctx && ctx.projects;
  let reqs = ctx && ctx.requirements;
  if (!Array.isArray(list) || !Array.isArray(reqs)) {
    const db = require('../store').get();
    if (!Array.isArray(list)) list = db.projects || [];
    if (!Array.isArray(reqs)) reqs = db.requirements || [];
  }

  /** 小写名 → 项目数组：名字比对不区分大小写，用户手写时常忽略大小写 */
  const byName = new Map();
  for (const p of list) {
    const key = String((p && p.name) || '').trim().toLowerCase();
    if (!key) continue;
    const hit = byName.get(key);
    if (hit) hit.push(p);
    else byName.set(key, [p]);
  }

  return names.map((name) => {
    const hits = byName.get(name.toLowerCase()) || [];
    const p = hits.find((x) => !x.archived) || hits[0] || null;
    if (!p) {
      return {
        /** 正文里写的名字，原样带回：解析失败时 agent 至少知道用户指的是谁 */
        name,
        projectId: null,
        projectName: null,
        path: null,
        archived: false,
        ambiguous: hits.length > 1,
        requirementCount: 0,
        pendingCount: 0,
        pending: []
      };
    }

    const mine = reqs.filter((r) => r.projectId === p.id);
    const open = mine
      .filter((r) => UNFINISHED.includes(r.status))
      .sort((a, b) => (b.seq || 0) - (a.seq || 0));
    const pending = open
      .slice(0, PENDING_MAX)
      .map((r) => ({ seq: r.seq, title: r.title, status: r.status }));

    return {
      name,
      projectId: p.id,
      projectName: p.name,
      path: p.path,
      archived: !!p.archived,
      /** 同名项目不止一个：取的是第一个，agent 需要时可再用 /mcp 的 pm_list_projects 核对 */
      ambiguous: hits.length > 1,
      requirementCount: mine.length,
      pendingCount: open.length,
      /** 最多 PENDING_MAX 条未完成需求，按编号倒序：先看最近的，才知道那个项目现在在做什么 */
      pending
    };
  });
}

/**
 * 把正文里的 `@{#序号}` 解析成「本项目的那条需求」。
 * 只认本项目：跨项目引用需求没有意义（seq 只在项目内唯一），别的项目的 seq 在这里一律失效。
 * 带上正文：agent 引用一条需求多半是要读它的内容，直接给省一次 MCP 往返；正文本就在库里，不读磁盘。
 * @param {string} text 需求正文
 * @param {string} projectId 当前需求所属项目
 * @param {{requirements?: Array}=} ctx 数据源（缺省读库）
 */
function resolveReqRefs(text, projectId, ctx) {
  const seqs = reqRefSeqs(text);
  if (!seqs.length) return [];

  let reqs = ctx && ctx.requirements;
  if (!Array.isArray(reqs)) reqs = require('../store').get().requirements || [];
  const mine = reqs.filter((r) => r.projectId === projectId);

  return seqs.map((seq) => {
    const r = mine.find((x) => (x.seq || 0) === seq) || null;
    if (!r) {
      // 解析失败把用户写的序号带回：agent 至少知道指向哪一条（已归档 / 删除 / 写错都会到这里）
      return {
        name: '#' + seq,
        seq,
        requirementId: null,
        projectId,
        title: null,
        status: null,
        body: '',
        exists: false
      };
    }
    return {
      name: '#' + seq,
      seq,
      requirementId: r.id,
      projectId,
      title: r.title || '',
      status: r.status,
      body: String(r.body || ''),
      exists: true
    };
  });
}

/**
 * 把正文里的 `@{file:相对路径}` 解析成「本项目里的文件坐标」。
 * 只给绝对路径 + 是否存在，不读内容（同项目引用不预读 README 的纪律）。
 * 安全边界与 snippet.js 一致：相对路径、不含 `..`、解析符号链接后仍在项目根内；密钥类文件标 restricted。
 * @param {string} text 需求正文
 * @param {{path?: string}|null} project 当前项目记录（取 path 作根）
 */
function resolveFileRefs(text, project) {
  const paths = fileRefPaths(text);
  if (!paths.length) return [];
  const root = project && project.path ? String(project.path) : '';

  return paths.map((rel) => {
    const base = {
      name: 'file:' + rel,
      path: rel,
      absPath: null,
      exists: false,
      directory: false,
      restricted: false,
      reason: null
    };
    if (!root) return { ...base, reason: 'path_missing' };

    let p;
    try {
      p = assertRelPath(rel);
    } catch (_) {
      return { ...base, reason: 'bad_path' };
    }
    if (DENY_RE.test(p)) return { ...base, restricted: true, exists: null, reason: 'restricted' };

    let abs;
    try {
      abs = resolveInside(root, p);
    } catch (e) {
      return { ...base, reason: e && e.code === 'bad_path' ? 'bad_path' : 'not_found' };
    }
    let stat;
    try {
      stat = fs.statSync(abs);
    } catch (_) {
      return { ...base, reason: 'not_found' };
    }
    return { ...base, absPath: abs, exists: true, directory: stat.isDirectory() };
  });
}

module.exports = {
  REF_RE,
  REQ_REF_RE,
  FILE_REF_RE,
  NAME_MAX,
  FILE_MAX,
  PENDING_MAX,
  refNames,
  reqRefSeqs,
  fileRefPaths,
  resolveRefs,
  resolveReqRefs,
  resolveFileRefs
};

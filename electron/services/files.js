'use strict';

/**
 * 列出项目内的文件与目录：给需求正文「@ 引用文件」的候选补全用。
 *
 * 只读、只在项目根内，与 snippet.js 同一条安全纪律：
 * - 优先 `git ls-files`（尊重 .gitignore，node_modules / 产物天然不出现）；
 *   非仓库或 git 不可用时回退到有上限的目录遍历，跳过依赖 / 产物 / 版本库目录。
 * - 密钥 / 凭据类文件一律不列（复用 snippet 的 DENY_RE），不让候选框变成第二个泄露口。
 * - 结果限量：大仓库几万个条目全塞进候选框既慢又没用，截断并如实标 truncated。
 * - git 模式只拿得到文件，目录由文件路径反推父目录：空目录不出现，但也不会带出被
 *   .gitignore 排除的目录；遍历回退模式直接把目录一起收下。
 */

const fs = require('fs');
const path = require('path');
const git = require('./git');
const { DENY_RE } = require('./snippet');

/** 候选文件上限：够选就行，超出截断（前端按拼音 / 子序列再筛） */
const MAX_FILES = 4000;
/** 目录悬停卡的一级条目上限：再多也看不过来 */
const DIR_MAX = 200;
/** 遍历回退时整棵跳过的目录：依赖、产物、版本库内部 */
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'release', 'out', 'target',
  '.next', '.nuxt', '__pycache__', '.venv', 'venv', '.idea', '.gradle'
]);

/** 有上限的广度遍历：非仓库项目的兜底，跳过重型目录，不跟随符号链接 */
function walk(root, max) {
  const out = [];
  const queue = [''];
  while (queue.length && out.length < max) {
    const rel = queue.shift();
    let entries;
    try {
      entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
    } catch (_) {
      continue;
    }
    for (const ent of entries) {
      const childRel = rel ? rel + '/' + ent.name : ent.name;
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(ent.name)) continue;
        out.push({ path: childRel, directory: true });
        queue.push(childRel);
      } else if (ent.isFile()) {
        out.push({ path: childRel, directory: false });
      }
      if (out.length >= max) break;
    }
  }
  return out;
}

/** `web/src/App.jsx` → `web`、`web/src`：git 只给文件，目录要自己从路径还原 */
function ancestorsOf(rel) {
  const parts = String(rel).split('/');
  const out = [];
  for (let i = 1; i < parts.length; i++) out.push(parts.slice(0, i).join('/'));
  return out;
}

/**
 * @param {string} root 项目根目录（绝对路径，调用方已校验存在）
 * @returns {Promise<{files: {path: string, directory: boolean}[], truncated: boolean, source: 'git'|'walk'}>}
 */
async function list(root) {
  let paths = await git.lsFiles(root, { timeout: 8000 });
  let source = 'git';
  let entries;
  if (Array.isArray(paths)) {
    const map = new Map();
    for (const raw of paths) {
      const rel = String(raw).replace(/\\/g, '/');
      if (!rel) continue;
      map.set(rel, false);
      for (const dir of ancestorsOf(rel)) {
        if (!map.has(dir)) map.set(dir, true);
      }
    }
    entries = Array.from(map, ([p, directory]) => ({ path: p, directory }));
  } else {
    entries = walk(root, MAX_FILES);
    source = 'walk';
  }

  const files = [];
  const seen = new Set();
  let truncated = false;
  for (const ent of entries) {
    const rel = String(ent.path || '').replace(/\\/g, '/');
    if (!rel || seen.has(rel) || DENY_RE.test(rel)) continue;
    seen.add(rel);
    if (files.length >= MAX_FILES) {
      truncated = true;
      break;
    }
    files.push({ path: rel, directory: !!ent.directory });
  }
  return { files, truncated, source };
}

/**
 * 读取目录的一级条目：文件引用悬停卡用。
 * 排序固定为「目录在前、名称升序」，跳过依赖 / 版本库目录与密钥类条目；
 * 超出 DIR_MAX 截断并如实标 total / truncated。调用方须先完成项目根校验与 DENY_RE 拦截。
 * @param {string} abs 目录绝对路径（已确认是目录）
 */
function readDir(abs) {
  const raw = fs.readdirSync(abs, { withFileTypes: true });
  const entries = [];
  for (const ent of raw) {
    if (DENY_RE.test(ent.name)) continue;
    let st;
    try {
      // 用 stat 而不是 dirent：软链目录也要认出来，大小也要拿
      st = fs.statSync(path.join(abs, ent.name));
    } catch (_) {
      continue;
    }
    const directory = st.isDirectory();
    if (directory && SKIP_DIRS.has(ent.name)) continue;
    entries.push({ name: ent.name, directory, size: directory ? null : st.size });
  }
  entries.sort((a, b) =>
    a.directory === b.directory ? a.name.localeCompare(b.name) : a.directory ? -1 : 1
  );
  return {
    entries: entries.slice(0, DIR_MAX),
    total: entries.length,
    truncated: entries.length > DIR_MAX
  };
}

module.exports = { list, readDir, MAX_FILES, DIR_MAX };
'use strict';

/**
 * 列出项目内的文件：给需求正文「@ 引用文件」的候选补全用。
 *
 * 只读、只在项目根内，与 snippet.js 同一条安全纪律：
 * - 优先 `git ls-files`（尊重 .gitignore，node_modules / 产物天然不出现）；
 *   非仓库或 git 不可用时回退到有上限的目录遍历，跳过依赖 / 产物 / 版本库目录。
 * - 密钥 / 凭据类文件一律不列（复用 snippet 的 DENY_RE），不让候选框变成第二个泄露口。
 * - 结果限量：大仓库几万个文件全塞进候选框既慢又没用，截断并如实标 truncated。
 */

const fs = require('fs');
const path = require('path');
const git = require('./git');
const { DENY_RE } = require('./snippet');

/** 候选文件上限：够选就行，超出截断（前端按拼音 / 子序列再筛） */
const MAX_FILES = 4000;
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
        if (!SKIP_DIRS.has(ent.name)) queue.push(childRel);
      } else if (ent.isFile()) {
        out.push(childRel);
        if (out.length >= max) break;
      }
    }
  }
  return out;
}

/**
 * @param {string} root 项目根目录（绝对路径，调用方已校验存在）
 * @returns {Promise<{files: {path: string}[], truncated: boolean, source: 'git'|'walk'}>}
 */
async function list(root) {
  let paths = await git.lsFiles(root, { timeout: 8000 });
  let source = 'git';
  if (!Array.isArray(paths)) {
    paths = walk(root, MAX_FILES);
    source = 'walk';
  }

  const files = [];
  const seen = new Set();
  let truncated = false;
  for (const raw of paths) {
    const rel = String(raw).replace(/\\/g, '/');
    if (!rel || seen.has(rel) || DENY_RE.test(rel)) continue;
    seen.add(rel);
    if (files.length >= MAX_FILES) {
      truncated = true;
      break;
    }
    files.push({ path: rel });
  }
  return { files, truncated, source };
}

module.exports = { list, MAX_FILES };
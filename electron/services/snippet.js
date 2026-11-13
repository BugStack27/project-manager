'use strict';

/**
 * 按需读取项目内的文件片段：给「需求备注里的证据坐标」做悬停预览用。
 *
 * 安全边界（这是渲染进程唯一能拿到项目源码的口子，宁可多拦）：
 * - 路径必须是非空相对路径，不含 `..`、不是绝对路径；
 * - 解析符号链接后必须仍在项目根内，防止项目里的软链指向外部；
 * - 密钥类文件直接拒，不让界面变成第二个泄露口；
 * - 二进制、超限文件只回标记不回内容。
 */

const fs = require('fs');
const path = require('path');

/** 单文件上限：超过只报大小，不读内容 */
const MAX_BYTES = 2 * 1024 * 1024;
/** 整文件模式的行数上限：前端要逐行渲染成 DOM，4000 行会明显卡顿 */
const MAX_FULL_LINES = 600;
/** 默认上下文行数（命中行上下各取这么多） */
const DEFAULT_CONTEXT = 8;
/** 二进制探测窗口 */
const BINARY_PROBE = 8000;

/** 不给预览的文件：密钥 / 凭据 / git 内部 / 依赖目录 */
const DENY_RE =
  /(^|[\\/])(\.env[^\\/]*|[^\\/]*\.(pem|key|p12|pfx|keystore))$|(^|[\\/])(id_rsa[^\\/]*|\.git|node_modules)([\\/]|$)/i;

function fail(message, code, status) {
  const e = new Error(message);
  e.code = code || 'bad_request';
  e.status = status || 400;
  throw e;
}

/** 与 git.js 的 assertRelPath 同口径：非空、非绝对、不含 `..` */
function assertRelPath(relPath) {
  const p = String(relPath || '').trim();
  if (!p) fail('缺少文件路径', 'bad_path', 400);
  if (path.isAbsolute(p) || p.split(/[\\/]/).includes('..')) {
    fail('非法的文件路径', 'bad_path', 400);
  }
  return p;
}

/** 解析到绝对路径，并确认仍在项目根内（符号链接也算） */
function resolveInside(root, relPath) {
  const rootReal = fs.realpathSync(root);
  let real;
  try {
    real = fs.realpathSync(path.resolve(rootReal, relPath));
  } catch (_) {
    fail('文件不存在：' + relPath, 'not_found', 404);
  }
  // Windows 盘符/目录名大小写不敏感，比对时统一小写
  const a = real.toLowerCase();
  const b = rootReal.toLowerCase();
  if (a !== b && !a.startsWith(b + path.sep)) fail('非法的文件路径', 'bad_path', 400);
  return real;
}

/** 返回值骨架：默认「有内容」，各分支用 extra 覆盖自己那部分 */
function result(p, extra) {
  return {
    path: p,
    exists: true,
    binary: false,
    directory: false,
    restricted: false,
    tooLarge: false,
    totalLines: 0,
    lines: [],
    hit: null,
    lineOutOfRange: false,
    ...extra
  };
}

/** 只回标记不回内容。restricted 的 exists 留空：不确认这类文件是否存在 */
function skip(p, flag, extra) {
  return result(p, { exists: flag === 'restricted' ? null : flag !== 'not_found', [flag]: true, ...extra });
}

/**
 * 读一段文件内容。
 * @param {string} root     项目根目录（绝对路径，调用方已校验存在）
 * @param {string} relPath  项目内相对路径
 * @param {{line?: number, end?: number, full?: boolean}} opts
 */
function read(root, relPath, opts) {
  const o = opts || {};
  const rel = assertRelPath(relPath);

  if (DENY_RE.test(rel)) return skip(rel, 'restricted');

  // 文件不存在是「悬停时的正常情况」（代码改名/删除），不该抛错：
  // 抛错会让浮层进错误态，而这里应该只是一句「文件不存在」的说明。
  let abs;
  try {
    abs = resolveInside(root, rel);
  } catch (e) {
    if (e && e.code === 'not_found') return skip(rel, 'not_found');
    throw e;
  }

  let stat;
  try {
    stat = fs.statSync(abs);
  } catch (_) {
    return skip(rel, 'not_found');
  }
  if (stat.isDirectory()) return skip(rel, 'directory');
  if (stat.size > MAX_BYTES) return skip(rel, 'tooLarge', { bytes: stat.size });

  let buf;
  try {
    buf = fs.readFileSync(abs);
  } catch (e) {
    fail('读取文件失败：' + e.message, 'read_failed', 500);
  }
  if (buf.subarray(0, BINARY_PROBE).includes(0)) return skip(rel, 'binary', { bytes: stat.size });

  const all = buf.toString('utf8').split('\n').map((l) => l.replace(/\r$/, ''));
  // `a\n` 会 split 出末尾空串，那是「换行符」不是「第 2 行」
  if (all.length > 1 && all[all.length - 1] === '') all.pop();
  if (all.length === 1 && all[0] === '') all.length = 0; // 空文件

  const total = all.length;
  const wantLine = Number(o.line) > 0 ? Math.floor(Number(o.line)) : 1;
  const wantEnd = Number(o.end) >= wantLine ? Math.floor(Number(o.end)) : wantLine;

  // 行号漂移：需求是几天前提的，文件可能已经短了。照实说，别假装精确。
  const outOfRange = wantLine > total;

  let from, to;
  if (o.full) {
    from = 1;
    to = Math.min(total, MAX_FULL_LINES);
  } else {
    from = Math.max(1, wantLine - DEFAULT_CONTEXT);
    to = Math.min(total, wantEnd + DEFAULT_CONTEXT);
  }

  const lines = [];
  for (let n = from; n <= to; n++) lines.push({ n, text: all[n - 1] });

  return result(rel, {
    totalLines: total,
    lines,
    hit: outOfRange ? null : { from: wantLine, to: Math.min(wantEnd, total) },
    lineOutOfRange: outOfRange
  });
}

module.exports = { read, DENY_RE, assertRelPath, resolveInside };

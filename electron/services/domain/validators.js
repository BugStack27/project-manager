'use strict';

const fs = require('fs');
const { DATE_RE } = require('./constants');
const { fail } = require('./errors');

function assertDay(value, name) {
  const s = String(value || '');
  if (!DATE_RE.test(s)) fail('日期格式应为 YYYY-MM-DD：' + name, 'bad_date', 400);
  const [y, m, d] = s.split('-').map(Number);
  const at = new Date(y, m - 1, d);
  // JS 会把 2024-02-30 滚成 3 月 1 日，必须回读校验
  if (at.getFullYear() !== y || at.getMonth() !== m - 1 || at.getDate() !== d) {
    fail('日期不存在：' + s, 'bad_date', 400);
  }
  return s;
}

function assertSha(sha) {
  const s = String(sha || '').trim();
  if (!s) fail('缺少 sha 参数', 'bad_sha', 400);
  return s;
}

function assertRelPath(relPath) {
  const p = String(relPath || '').trim();
  if (!p) fail('缺少 path 参数', 'bad_path', 400);
  return p;
}

/**
 * query 参数乱码拦截：GBK 等非 UTF-8 编码做完 percent-encode 后，服务端按 UTF-8 解码会留下
 * U+FFFD 替换符，而原始字节已经丢失、无法还原。这类内容一律拒收，让调用方立刻改用 UTF-8。
 */
function assertEncoded(text, label) {
  if (text.includes('\ufffd')) {
    fail(
      label + '含无法解码的字符，请先按 UTF-8 编码再做 percent-encode（不要用 GBK / 系统默认编码）',
      'bad_encoding',
      400
    );
  }
  return text;
}

/** 给执行 agent 的动作接口（/claim、/complete）共用同一套入参校验 */
function assertTaskId(rid) {
  const id = String(rid || '').trim();
  if (!id) fail('缺少 taskId 参数', 'missing_task_id', 400);
  return id;
}

function assertAgent(agent) {
  if (agent === undefined || agent === null) fail('缺少 agent 参数', 'missing_agent', 400);
  const who = assertEncoded(String(agent).trim(), 'agent 名称');
  if (!who || who.length > 64 || /[\u0000-\u001f\u007f]/.test(who)) {
    fail('agent 名称无效（1-64 个字符）', 'bad_agent', 400);
  }
  return who;
}

/** 项目目录可用性校验（revealProject / openInIde 共用），返回规范化后的绝对路径 */
function assertProjectDir(p) {
  const target = String(p.path || '').trim();
  if (!target) fail('项目路径为空', 'bad_path', 400);

  let stat;
  try {
    stat = fs.statSync(target);
  } catch (_) {
    fail('项目路径不存在：' + target, 'path_missing', 404);
  }
  if (!stat.isDirectory()) fail('项目路径不是文件夹：' + target, 'bad_path', 400);
  return target;
}

module.exports = {
  assertDay,
  assertSha,
  assertRelPath,
  assertEncoded,
  assertTaskId,
  assertAgent,
  assertProjectDir
};

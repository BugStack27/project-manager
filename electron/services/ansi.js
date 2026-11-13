'use strict';

/** 剥离终端转义序列与除制表符外的 C0 控制字符：供 MCP 等纯文本出口使用。 */
const STRING_RE = /\u001b[\]PX^_][\s\S]*?(?:\u0007|\u001b\\|$)/g;
const CSI_RE = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const ESC_RE = /\u001b[@-Z\\-_]/g;
const CTRL_RE = /[\u0000-\u0008\u000B-\u001F\u007F]/g;

function stripAnsi(text) {
  return String(text == null ? '' : text)
    .replace(STRING_RE, '')
    .replace(CSI_RE, '')
    .replace(ESC_RE, '')
    .replace(CTRL_RE, '');
}

module.exports = { stripAnsi };

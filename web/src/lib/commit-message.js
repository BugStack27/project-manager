/**
 * Conventional Commits 的常用类型：值是提交前缀，desc 用于选中时的说明。
 * 只收标准类型，不把用户自定义前缀混进来，切换类型时才能安全地替换旧前缀。
 */
export const COMMIT_TYPES = [
  { value: 'feat', desc: '新增功能（feature）' },
  { value: 'fix', desc: '修复缺陷' },
  { value: 'docs', desc: '仅文档改动（README、注释等）' },
  { value: 'style', desc: '代码格式调整（空格 / 缩进 / 分号，不影响逻辑）' },
  { value: 'refactor', desc: '重构（既不新增功能也不修复缺陷）' },
  { value: 'perf', desc: '性能优化' },
  { value: 'test', desc: '新增或修改测试' },
  { value: 'build', desc: '构建系统或依赖变更' },
  { value: 'ci', desc: 'CI 配置或脚本变更' },
  { value: 'chore', desc: '杂项维护（工具、配置等）' },
  { value: 'revert', desc: '回滚之前的提交' }
];

const TYPE_PREFIX_RE = new RegExp('^(' + COMMIT_TYPES.map((t) => t.value).join('|') + '):\\s*');

/** 去掉已有的标准类型前缀，切换类型时避免叠加成 `feat: fix: ...` */
export function stripCommitPrefix(message) {
  return String(message || '').replace(TYPE_PREFIX_RE, '');
}

/**
 * 提交信息拆成标题行与正文：类型前缀只作用于标题，正文保持原样。
 * 顺带认出 agent 写的标准类型前缀（如 `feat: `）并返回 type，让提交弹窗预选同一个类型、
 * 提交时补回去——否则拆成标题后前缀会丢，一键提交就不是 agent 给的那条信息了。
 */
export function splitCommitMessage(message) {
  const raw = String(message || '');
  const m = TYPE_PREFIX_RE.exec(raw);
  const type = m ? m[1] : '';
  const text = stripCommitPrefix(raw);
  const idx = text.indexOf('\n');
  if (idx === -1) return { subject: text, body: '', type };
  return { subject: text.slice(0, idx), body: text.slice(idx + 1).replace(/^\n+/, ''), type };
}

/**
 * 待审核需求的交付结果 → 提交信息。
 *
 * 只认 agent 单独提供的 `completion.commitMessage`：它已是一条完整的标准提交信息
 * （标题 + 空行 + 汇总本次改动的正文），用户一键批准就能直接提交。
 * 会话回复 `note` 绝不回落到提交正文——那是给用户看的回复，写进 git 就是污染。
 * 老交付没有这个字段时只留 `#序号 标题`，需要正文由用户自己补。
 */
export function buildCommitMessage(req) {
  if (!req) return '';
  const supplied = String((req.completion && req.completion.commitMessage) || '').trim();
  if (supplied) return supplied;
  return '#' + req.seq + ' ' + req.title;
}

/**
 * 让提交正文在 markdown 渲染后仍保持原有断行。
 *
 * 提交正文常写成「一行一条」却没加 `- `：按 markdown 语义这些软换行会被并成一段，
 * 原文的层次就丢了。这里给「后面还跟着非空行」的行尾补两个空格（markdown 硬换行），
 * 段落末尾与代码围栏内的行不动 —— 只影响断行，不改变任何 markdown 结构。
 */
export function keepLineBreaks(message) {
  const lines = String(message || '').split('\n');
  let inCode = false;
  return lines
    .map((line, i) => {
      if (/^\s*(```|~~~)/.test(line)) {
        inCode = !inCode;
        return line;
      }
      if (inCode || !line.trim()) return line;
      const next = lines[i + 1];
      return next === undefined || !next.trim() ? line : line + '  ';
    })
    .join('\n');
}

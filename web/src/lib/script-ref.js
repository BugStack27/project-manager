/* 启动命令里的脚本引用：把 `./deploy.sh` / `node scripts/dev.js` 这类命令还原成项目内相对路径，
 * 供启动台在命令上悬停时弹出脚本内容（复用 FileHoverCard）。
 *
 * 只认「命令位置」上的脚本：段首词本身是脚本文件，或脚本解释器后面那个脚本文件。
 * `curl -o install.sh`、`echo notes.md` 这类把文件名当参数的命令不该被当成引用。
 * 解析不出、或落在项目根外就返回 null —— 悬浮窗宁可不弹，也不显示项目外的文件。
 */

/** 能被直接执行的脚本后缀（不含 .ts：ts 一般经 runner 执行，命令里给的是 runner） */
const SCRIPT_EXT = new Set([
  'sh',
  'bash',
  'zsh',
  'fish',
  'bat',
  'cmd',
  'ps1',
  'psm1',
  'py',
  'js',
  'mjs',
  'cjs',
  'rb',
  'pl',
  'php',
  'lua'
]);

/** 后面会跟脚本文件的解释器：`bash x.sh` / `node x.js` / `powershell -File x.ps1` */
const INTERPRETERS = new Set([
  'sh',
  'bash',
  'zsh',
  'fish',
  'dash',
  'node',
  'nodejs',
  'deno',
  'bun',
  'python',
  'python2',
  'python3',
  'py',
  'ruby',
  'perl',
  'php',
  'lua',
  'pwsh',
  'powershell',
  'cmd'
]);

/** 只做转发的包装词：剥掉它们再判断真正执行的是谁 */
const WRAPPERS = new Set(['sudo', 'doas', 'env', 'exec', 'nohup', 'time', 'command', 'call']);

const ASSIGN_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;

function winPlatform(platform) {
  if (platform) return platform === 'win32';
  return !!(typeof window !== 'undefined' && window.pm && window.pm.platform === 'win32');
}

/** 按 shell 的分段符（&& || | ; 换行）切段，引号里的内容不参与切分 */
function segments(text) {
  const out = [];
  let toks = [];
  let tok = '';
  let has = false;
  let quote = '';
  const flushTok = () => {
    if (has) toks.push(tok);
    tok = '';
    has = false;
  };
  const flushSeg = () => {
    flushTok();
    if (toks.length) out.push(toks);
    toks = [];
  };
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = '';
      else tok += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\r') {
      flushTok();
      continue;
    }
    if (ch === '\n' || ch === ';') {
      flushSeg();
      continue;
    }
    if ((ch === '&' || ch === '|') && text[i + 1] === ch) {
      flushSeg();
      i += 1;
      continue;
    }
    if (ch === '|') {
      flushSeg();
      continue;
    }
    tok += ch;
    has = true;
  }
  flushSeg();
  return out;
}

function baseName(token) {
  return String(token || '')
    .split(/[\\/]/)
    .pop()
    .toLowerCase()
    .replace(/\.exe$/, '');
}

function isScriptFile(token) {
  const s = String(token || '');
  if (!s || s.startsWith('-') || s.includes('://') || /[*?<>$`]/.test(s)) return false;
  const dot = s.lastIndexOf('.');
  if (dot < 0) return false;
  return SCRIPT_EXT.has(s.slice(dot + 1).toLowerCase());
}

function isAbsolute(p) {
  return /^[a-zA-Z]:[\\/]/.test(p) || /^[\\/]/.test(p);
}

/** 统一分隔符并消掉 . / .. 段；盘符与开头的 / 原样保留 */
function normPath(p) {
  const s = String(p || '').trim().replace(/\\/g, '/');
  const drive = /^[a-zA-Z]:/.exec(s);
  const head = drive ? drive[0] : s.startsWith('/') ? '/' : '';
  const parts = [];
  for (const seg of s.slice(head.length).split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      parts.pop();
      continue;
    }
    parts.push(seg);
  }
  const tail = parts.join('/');
  if (!head) return tail;
  return head === '/' ? '/' + tail : head + '/' + tail;
}

function joinPath(base, target) {
  if (isAbsolute(target)) return normPath(target);
  return normPath(base ? base + '/' + target : target);
}

/** 绝对路径 → 项目内相对路径；出不了项目根就 null */
function toRel(root, abs, win) {
  const rootPath = normPath(root);
  const filePath = normPath(abs);
  if (!rootPath || !filePath) return null;
  const cmpRoot = win ? rootPath.toLowerCase() : rootPath;
  const cmpFile = win ? filePath.toLowerCase() : filePath;
  if (cmpFile === cmpRoot || !cmpFile.startsWith(cmpRoot + '/')) return null;
  return filePath.slice(cmpRoot.length + 1);
}

/**
 * 从一条启动命令里找出被执行的脚本。
 * @param {{text?: string, cwd?: string}} command
 * @param {{path?: string}} project
 * @param {string} [platform] 'win32' / 其他；不传就按 window.pm.platform
 * @returns {string|null} 项目内相对路径
 */
export function scriptRef(command, project, platform) {
  const text = String((command && command.text) || '');
  const root = normPath((project && project.path) || '');
  if (!text || !root) return null;

  const win = winPlatform(platform);
  let base = normPath((command && command.cwd) || root);
  if (!isAbsolute(base)) base = normPath(root + '/' + base);

  for (const toks of segments(text)) {
    let i = 0;
    while (i < toks.length && (ASSIGN_RE.test(toks[i]) || WRAPPERS.has(baseName(toks[i])))) i += 1;
    if (i >= toks.length) continue;

    const head = toks[i];
    const headBase = baseName(head);

    // cd 改变后续段的相对路径：`cd scripts && ./build.sh`
    if (headBase === 'cd' || headBase === 'chdir' || headBase === 'pushd') {
      const target = toks[i + 1];
      if (target && !target.startsWith('-')) base = joinPath(base, target);
      continue;
    }

    const candidates = isScriptFile(head)
      ? [head]
      : INTERPRETERS.has(headBase)
        ? toks.slice(i + 1).filter(isScriptFile)
        : [];

    for (const cand of candidates) {
      const rel = toRel(root, joinPath(base, cand), win);
      if (rel) return rel;
    }
  }
  return null;
}

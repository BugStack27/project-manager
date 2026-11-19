/**
 * 证据浮层的代码高亮：按需加载，不进主包。
 *
 * 为什么用 highlight.js 的 core + 手动注册语言：
 * 全量入口约 1MB，而这里只需要给「几十行代码片段」上色。core + 20 种语言
 * 压到一百多 KB，且整个模块走动态 import——首屏一个字节都不多，第一次悬停才下载。
 *
 * 为什么先整段高亮再按行切，而不是逐行高亮：
 * 块注释、多行字符串、模板字符串的语法状态是跨行的。逐行调 hljs 会把
 * `/* … *\/` 的第二行当成正常代码；整段高亮后切行（并补全被行边界切断的
 * <span>），状态才是对的。
 */

/** 扩展名 → hljs 语言名。表里有、但引擎没注册的会长成纯文本，不会花屏 */
const BY_EXT = {
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  md: 'markdown',
  markdown: 'markdown',
  py: 'python',
  html: 'xml',
  htm: 'xml',
  xml: 'xml',
  vue: 'xml',
  svg: 'xml',
  xhtml: 'xml',
  css: 'css',
  scss: 'scss',
  less: 'less',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  fish: 'bash',
  sql: 'sql',
  go: 'go',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'ini',
  ini: 'ini',
  properties: 'ini',
  gradle: 'gradle',
  groovy: 'groovy',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  rs: 'rust',
  swift: 'swift',
  diff: 'diff',
  patch: 'diff',
  /* 启动台的脚本预览：挑脚本时常见这些后缀，别让内容窗退化成纯文本 */
  ps1: 'powershell',
  psm1: 'powershell',
  bat: 'dos',
  cmd: 'dos',
  rb: 'ruby',
  pl: 'perl',
  pm: 'perl',
  php: 'php',
  lua: 'lua'
};

/** 没有扩展名但有固定语法的文件 */
const BY_NAME = {
  dockerfile: 'dockerfile',
  '.gitignore': 'ini',
  '.npmrc': 'ini',
  '.editorconfig': 'ini'
};

/** 路径 → hljs 语言名（认不出返回 null） */
export function langOf(p) {
  const path = String(p || '').replace(/\\/g, '/');
  const base = path.split('/').pop() || '';
  const byName = BY_NAME[base.toLowerCase()];
  if (byName) return byName;
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return null;
  return BY_EXT[base.slice(dot + 1).toLowerCase()] || null;
}

/**
 * 扩展名认不出时按首行 shebang 猜：无扩展名或被改名的小脚本（deploy、run）也能上色。
 * 只认确定性的解释器名，猜不准就保持纯文本。
 */
function langOfText(text) {
  const m = /^#!\s*(\S+)(?:\s+(\S+))?/.exec(String(text || '').split('\n', 1)[0].trim());
  if (!m) return null;
  // /usr/bin/env bash 取第二个词，/bin/bash 取路径最后一段
  const cmd = String(m[2] || m[1]).split('/').pop();
  if (/^(bash|sh|zsh|fish|dash|ksh)$/.test(cmd)) return 'bash';
  if (/^python[0-9.]*$/.test(cmd)) return 'python';
  if (/^(node|nodejs|deno|bun)$/.test(cmd)) return 'javascript';
  if (/^(ruby|perl|php)$/.test(cmd)) return cmd;
  if (/^(pwsh|powershell)$/.test(cmd)) return 'powershell';
  return null;
}

/** 语言包的加载器：Vite 会把每个包拆成独立 chunk，所以只在真正用到时拉一个 */
const LOADERS = {
  java: () => import('highlight.js/lib/languages/java'),
  kotlin: () => import('highlight.js/lib/languages/kotlin'),
  typescript: () => import('highlight.js/lib/languages/typescript'),
  javascript: () => import('highlight.js/lib/languages/javascript'),
  json: () => import('highlight.js/lib/languages/json'),
  markdown: () => import('highlight.js/lib/languages/markdown'),
  python: () => import('highlight.js/lib/languages/python'),
  xml: () => import('highlight.js/lib/languages/xml'),
  css: () => import('highlight.js/lib/languages/css'),
  scss: () => import('highlight.js/lib/languages/scss'),
  less: () => import('highlight.js/lib/languages/less'),
  bash: () => import('highlight.js/lib/languages/bash'),
  sql: () => import('highlight.js/lib/languages/sql'),
  go: () => import('highlight.js/lib/languages/go'),
  yaml: () => import('highlight.js/lib/languages/yaml'),
  ini: () => import('highlight.js/lib/languages/ini'),
  groovy: () => import('highlight.js/lib/languages/groovy'),
  gradle: () => import('highlight.js/lib/languages/gradle'),
  c: () => import('highlight.js/lib/languages/c'),
  cpp: () => import('highlight.js/lib/languages/cpp'),
  csharp: () => import('highlight.js/lib/languages/csharp'),
  rust: () => import('highlight.js/lib/languages/rust'),
  swift: () => import('highlight.js/lib/languages/swift'),
  diff: () => import('highlight.js/lib/languages/diff'),
  dockerfile: () => import('highlight.js/lib/languages/dockerfile'),
  powershell: () => import('highlight.js/lib/languages/powershell'),
  dos: () => import('highlight.js/lib/languages/dos'),
  ruby: () => import('highlight.js/lib/languages/ruby'),
  perl: () => import('highlight.js/lib/languages/perl'),
  php: () => import('highlight.js/lib/languages/php'),
  lua: () => import('highlight.js/lib/languages/lua')
};

let engine = null;
/** 已注册的语言名，避免重复 register */
const registered = new Set();
let coreFailed = false;

/** 拿到引擎（首次调用才加载 core），并按需注册目标语言及依赖 */
async function loadEngine(lang) {
  if (!engine && !coreFailed) {
    try {
      const core = await import('highlight.js/lib/core');
      engine = core.default || core;
    } catch (_) {
      coreFailed = true;
      return null;
    }
  }
  if (!engine) return null;

  for (const name of [lang]) {
    if (registered.has(name)) continue;
    const loader = LOADERS[name];
    if (!loader) continue;
    try {
      const mod = await loader();
      engine.registerLanguage(name, mod.default || mod);
      registered.add(name);
    } catch (_) {
      // 单个语言包加载失败只影响这个语言：后面 getLanguage 返回 undefined，走纯文本
    }
  }
  return engine;
}

/**
 * 把整段高亮后的 HTML 按行切开。
 * hljs 输出的是平铺 <span class="hljs-xxx">…</span>，跨行 token 会被行边界切断：
 * 行尾补上未闭合的 </span>，下一行开头按栈重新打开，保证每行都是独立合法的 HTML。
 */
function splitHighlighted(html) {
  const rows = [];
  const openTags = [];
  let cur = '';
  let i = 0;
  while (i < html.length) {
    const ch = html[i];
    if (ch === '\n') {
      rows.push(cur + '</span>'.repeat(openTags.length));
      cur = openTags.map((c) => '<span class="' + c + '">').join('');
      i += 1;
      continue;
    }
    if (ch === '<') {
      const end = html.indexOf('>', i);
      if (end === -1) {
        cur += html.slice(i);
        break;
      }
      const tag = html.slice(i, end + 1);
      cur += tag;
      if (tag.startsWith('<span')) {
        const m = /class="([^"]*)"/.exec(tag);
        openTags.push(m ? m[1] : '');
      } else if (tag === '</span>') {
        openTags.pop();
      }
      i = end + 1;
      continue;
    }
    cur += ch;
    i += 1;
  }
  rows.push(cur + '</span>'.repeat(openTags.length));
  return rows;
}

/**
 * 高亮一段代码，按行返回 HTML 片段数组。
 * @returns {Promise<string[]|null>} null = 认不出语言 / 引擎不可用，调用方走纯文本
 */
export async function highlightLines(text, path) {
  const lang = langOf(path) || langOfText(text);
  if (!lang) return null;
  const hljs = await loadEngine(lang);
  if (!hljs || !hljs.getLanguage(lang)) return null;
  try {
    // ignoreIllegals：片段可能从半截语法开始（比如只取了一个函数体），不要让它在非法处抛错
    return splitHighlighted(hljs.highlight(String(text || ''), { language: lang, ignoreIllegals: true }).value);
  } catch (_) {
    return null;
  }
}

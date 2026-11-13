'use strict';

const fs = require('fs');
const path = require('path');
const android = require('./android-icon');
const peIcon = require('./icon');

/**
 * 项目图标提取：按项目类型从仓库里找真实图标，找不到由前端退回品牌兜底图标。
 *
 * 目前覆盖：
 *   - Android：launcher 资源（位图 / VectorDrawable）；
 *   - IntelliJ 插件：META-INF/pluginIcon.svg；
 *   - Electron：electron-builder 配置 / 常见目录 / 已打包 exe 的 PE 图标；
 *   - JavaFX：resources 下的 icon.* / favicon.*；
 *   - Spring Boot：static 下的 favicon。
 * 全部按需调用，结果在进程内缓存；图标替换后重启应用生效。
 */

const MIME = {
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};
const MAX_BYTES = 2 * 1024 * 1024;
const cache = new Map();

function isFile(file) {
  try {
    return fs.statSync(file).isFile();
  } catch (_) {
    return false;
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return null;
  }
}

/** 文件 → dataURL；不认识的扩展名（如 .icns）返回 null */
function fileIcon(file) {
  const mime = MIME[path.extname(file).toLowerCase()];
  if (!mime) return null;
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > MAX_BYTES) return null;
    return { icon: 'data:' + mime + ';base64,' + fs.readFileSync(file).toString('base64'), mono: null };
  } catch (_) {
    return null;
  }
}

function firstFile(files) {
  for (const file of files) {
    if (!isFile(file)) continue;
    const result = fileIcon(file);
    if (result) return result;
  }
  return null;
}

/* ── IntelliJ Platform 插件 ───────────────────── */

function intellijIcon(root) {
  const base = path.join(root, 'src', 'main', 'resources', 'META-INF');
  return firstFile([
    path.join(base, 'pluginIcon.svg'),
    path.join(base, 'pluginIcon.png'),
    path.join(base, 'pluginIcon_dark.svg'),
    path.join(base, 'pluginIcon_dark.png')
  ]);
}

/* ── Electron ─────────────────────────────────── */

const ELECTRON_FILES = [
  'build/icon.ico',
  'build/icon.png',
  'build/icon.svg',
  'assets/app-icon.png',
  'assets/app-icon.ico',
  'assets/icon.png',
  'assets/icon.ico',
  'resources/icon.png',
  'resources/icon.ico',
  'icon.ico',
  'icon.png'
];

/** electron-builder 配置的图标路径；没写扩展名时按 ico / png 补 */
function configuredIcon(root, pkg) {
  const build = pkg && pkg.build;
  if (!build) return null;
  const refs = [build.icon];
  ['win', 'mac', 'linux'].forEach((key) => {
    if (build[key] && typeof build[key].icon === 'string') refs.push(build[key].icon);
  });
  for (const ref of refs) {
    if (typeof ref !== 'string' || !ref.trim()) continue;
    const base = path.resolve(root, ref);
    for (const ext of path.extname(base) ? [''] : ['.ico', '.png', '.svg']) {
      const result = fileIcon(base + ext);
      if (result) return result;
    }
  }
  return null;
}

/** 已打包 exe 的图标：win-unpacked 优先，其次是安装包 */
function packagedIcon(root) {
  const dirs = [
    ['release', 'win-unpacked'],
    ['dist', 'win-unpacked'],
    ['out', 'win-unpacked'],
    ['release'],
    ['dist'],
    ['out']
  ];
  for (const parts of dirs) {
    const dir = path.join(root, ...parts);
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      continue;
    }
    const exes = entries
      .filter((e) => e.isFile() && /\.exe$/i.test(e.name) && !/^unins/i.test(e.name))
      .map((e) => path.join(dir, e.name));
    for (const exe of exes) {
      const found = peIcon.get(exe);
      if (found && found.dataUrl) return { icon: found.dataUrl, mono: null };
    }
  }
  return null;
}

function electronIcon(root) {
  return (
    configuredIcon(root, readJson(path.join(root, 'package.json'))) ||
    firstFile(ELECTRON_FILES.map((name) => path.join(root, name))) ||
    packagedIcon(root)
  );
}

/* ── JavaFX ───────────────────────────────────── */

const FX_NAMES = [
  [/^icon\.(png|ico|svg|jpe?g)$/i, 0],
  [/^(app[-_]?icon|logo)\.(png|ico|svg|jpe?g)$/i, 1],
  [/^favicon\.(ico|png|svg)$/i, 2]
];

function rankIconName(name) {
  for (const [re, rank] of FX_NAMES) if (re.test(name)) return rank;
  return -1;
}

/** resources 下最多找 5 层：先 icon.*，再 app-icon / logo，最后 favicon */
function javafxIcon(root) {
  const start = path.join(root, 'src', 'main', 'resources');
  if (!fs.existsSync(start)) return null;

  const found = [];
  const stack = [{ dir: start, depth: 0 }];
  let visited = 0;
  while (stack.length && visited < 3000) {
    const { dir, depth } = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      continue;
    }
    for (const e of entries) {
      visited += 1;
      if (e.isDirectory()) {
        if (depth < 5 && !/^(node_modules|build|target|out|\.git|\.gradle)$/.test(e.name)) {
          stack.push({ dir: path.join(dir, e.name), depth: depth + 1 });
        }
        continue;
      }
      const rank = rankIconName(e.name);
      if (rank >= 0) found.push({ file: path.join(dir, e.name), rank, depth });
    }
  }
  found.sort((a, b) => a.rank - b.rank || a.depth - b.depth || a.file.length - b.file.length);
  return found.length ? fileIcon(found[0].file) : null;
}

/* ── Spring Boot ──────────────────────────────── */

function springIcon(root) {
  const res = path.join(root, 'src', 'main', 'resources');
  return firstFile([
    path.join(res, 'static', 'favicon.ico'),
    path.join(res, 'static', 'favicon.png'),
    path.join(res, 'static', 'favicon.svg'),
    path.join(res, 'public', 'favicon.ico'),
    path.join(res, 'public', 'favicon.png'),
    path.join(res, 'favicon.ico')
  ]);
}

const EXTRACTORS = {
  android: android.getIcon,
  'intellij-plugin': intellijIcon,
  electron: electronIcon,
  javafx: javafxIcon,
  'spring-boot': springIcon
};

/**
 * @param {string} root 项目根目录
 * @param {string|null} kind detectKind 的结果
 * @returns {{ icon: string, mono: 'dark'|'light'|null } | null}
 */
function get(root, kind) {
  const dir = String(root || '').trim();
  const extract = EXTRACTORS[kind];
  if (!dir || !extract) return null;

  const key = kind + '|' + dir;
  if (cache.has(key)) return cache.get(key);
  const result = extract(dir);
  cache.set(key, result);
  return result;
}

module.exports = { get };

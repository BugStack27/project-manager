'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const icon = require('./icon');

/**
 * IDE 发现与启动。
 * 不依赖 electron：读 Windows 快捷方式由主进程注入 native.readShortcut
 *（Electron 的 shell.readShortcutLink），其余全部是 node 原生能力。
 *
 * 发现策略（按命中率排序）：
 *   1. 开始菜单 .lnk —— 装在哪个盘都能捞到（Trae CN 在 D:\、Qoder 在 D:\software\ 都靠这条）
 *   2. 常见安装路径 + JetBrains 目录扫描 —— 兜底没有快捷方式的
 *   3. PATH 里的 exe —— 命令行注册过的
 * 同一 IDE 只保留一条（按 id 去重，先扫到的优先），避免菜单里出现两个 IntelliJ。
 */

const MAX_LNK = 800;
const MAX_LNK_DEPTH = 4;
const MAX_EXE_WALK_DEPTH = 5;
/** 快捷方式目标不是 IDE 本体时，最多向上找几层目录 */
const MAX_NEARBY_UP = 3;

/**
 * 启动器型 IDE 的识别词。
 * Qoder 这类产品的开始菜单快捷方式指向 `<App> Launcher.exe`（真正的 IDE 在
 * 快捷方式的 cwd 里，如 D:\software\Qoder\.qoder-versions\0.4.8\Qoder.exe），
 * 直接用 launcher 打开项目并不可靠，所以认出来后去 cwd 附近找本体。
 */
const LAUNCHER_TOKENS = [
  'code',
  'cursor',
  'trae',
  'qoder',
  'windsurf',
  'zed',
  'idea',
  'intellij',
  'pycharm',
  'webstorm',
  'goland',
  'clion',
  'rider',
  'phpstorm',
  'rubymine',
  'datagrip',
  'rustrover',
  'android studio',
  'sublime',
  'visual studio'
];

/**
 * exe 文件名（小写）→ IDE 定义。
 * args 是「项目路径之前」的参数；目前所有目标都直接吃目录路径，
 * 若将来某个 IDE 需要 /Command 之类的前置参数，在这里加。
 *
 */
const REGISTRY = [
  { exe: 'code.exe', id: 'vscode', name: 'VS Code' },
  { exe: 'code - insiders.exe', id: 'vscode-insiders', name: 'VS Code Insiders' },
  { exe: 'cursor.exe', id: 'cursor', name: 'Cursor' },
  { exe: 'trae cn.exe', id: 'trae-cn', name: 'Trae CN' },
  { exe: 'trae.exe', id: 'trae', name: 'Trae' },
  { exe: 'qoder.exe', id: 'qoder', name: 'Qoder' },
  { exe: 'windsurf.exe', id: 'windsurf', name: 'Windsurf' },
  { exe: 'zed.exe', id: 'zed', name: 'Zed' },
  { exe: 'idea64.exe', id: 'idea', name: 'IntelliJ IDEA' },
  { exe: 'idea.exe', id: 'idea', name: 'IntelliJ IDEA' },
  { exe: 'pycharm64.exe', id: 'pycharm', name: 'PyCharm' },
  { exe: 'pycharm.exe', id: 'pycharm', name: 'PyCharm' },
  { exe: 'webstorm64.exe', id: 'webstorm', name: 'WebStorm' },
  { exe: 'webstorm.exe', id: 'webstorm', name: 'WebStorm' },
  { exe: 'goland64.exe', id: 'goland', name: 'GoLand' },
  { exe: 'clion64.exe', id: 'clion', name: 'CLion' },
  { exe: 'rider64.exe', id: 'rider', name: 'Rider' },
  { exe: 'phpstorm64.exe', id: 'phpstorm', name: 'PhpStorm' },
  { exe: 'rubymine64.exe', id: 'rubymine', name: 'RubyMine' },
  { exe: 'datagrip64.exe', id: 'datagrip', name: 'DataGrip' },
  { exe: 'rustrover64.exe', id: 'rustrover', name: 'RustRover' },
  { exe: 'studio64.exe', id: 'android-studio', name: 'Android Studio' },
  { exe: 'subl.exe', id: 'sublime', name: 'Sublime Text' },
  { exe: 'sublime_text.exe', id: 'sublime', name: 'Sublime Text' },
  { exe: 'devenv.exe', id: 'visual-studio', name: 'Visual Studio' }
];

/** 小写 exe 名 → 定义，避免每次线性找 */
const BY_EXE = new Map(REGISTRY.map((r) => [r.exe, r]));
/** 排序权重：REGISTRY 顺序即优先级 */
const WEIGHT = new Map(REGISTRY.map((r, i) => [r.id, i]));

/** macOS：.app 包名 → IDE 定义（用 open -a 启动，不拼各家的私有命令行） */
const MAC_APPS = [
  { app: 'Visual Studio Code.app', id: 'vscode', name: 'VS Code' },
  { app: 'Visual Studio Code - Insiders.app', id: 'vscode-insiders', name: 'VS Code Insiders' },
  { app: 'Cursor.app', id: 'cursor', name: 'Cursor' },
  { app: 'Trae.app', id: 'trae', name: 'Trae' },
  { app: 'Windsurf.app', id: 'windsurf', name: 'Windsurf' },
  { app: 'Zed.app', id: 'zed', name: 'Zed' },
  { app: 'IntelliJ IDEA.app', id: 'idea', name: 'IntelliJ IDEA' },
  { app: 'IntelliJ IDEA Ultimate.app', id: 'idea', name: 'IntelliJ IDEA' },
  { app: 'IntelliJ IDEA Community Edition.app', id: 'idea', name: 'IntelliJ IDEA' },
  { app: 'PyCharm.app', id: 'pycharm', name: 'PyCharm' },
  { app: 'WebStorm.app', id: 'webstorm', name: 'WebStorm' },
  { app: 'GoLand.app', id: 'goland', name: 'GoLand' },
  { app: 'CLion.app', id: 'clion', name: 'CLion' },
  { app: 'Android Studio.app', id: 'android-studio', name: 'Android Studio' },
  { app: 'Sublime Text.app', id: 'sublime', name: 'Sublime Text' }
];

/** 缓存：IDE 列表只在启动后扫一次，refresh 才重扫（每次点按钮扫盘会卡） */
let cache = null;
let scanning = false;

function fail(message, code, status) {
  const e = new Error(message);
  e.code = code || 'bad_request';
  e.status = status || 400;
  throw e;
}

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch (_) {
    return false;
  }
}

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch (_) {
    return false;
  }
}

function readDirs(dir) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => path.join(dir, d.name));
  } catch (_) {
    return [];
  }
}

/** 广度优先收集目录下的 .lnk（限制深度与总量，开始菜单里偶有深层目录） */
function collectLinks(dir, out, depth) {
  if (!dir || depth > MAX_LNK_DEPTH || out.length >= MAX_LNK) return;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return;
  }
  for (const e of entries) {
    if (out.length >= MAX_LNK) return;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) collectLinks(full, out, depth + 1);
    else if (e.isFile() && /\.lnk$/i.test(e.name)) out.push(full);
  }
}

/** 收集目录树里的 exe（JetBrains 的 bin 目录层级不固定，用深度受限的遍历） */
function collectExes(dir, out, depth) {
  if (!dir || depth > MAX_EXE_WALK_DEPTH) return;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) collectExes(full, out, depth + 1);
    else if (e.isFile() && /\.exe$/i.test(e.name)) out.push(full);
  }
}

/**
 * 单个 exe 路径 → 规范化后的 IDE 条目；不在白名单里返回 null。
 * Sublime 特殊处理：subl.exe 才是能直接接目录的启动器，
 * 只捞到 sublime_text.exe 时优先换成同目录的 subl.exe。
 */
function normalize(exe) {
  if (!exe || typeof exe !== 'string') return null;
  const clean = exe.replace(/^"|"$/g, '').trim();
  if (!/\.exe$/i.test(clean)) return null;
  if (!isFile(clean)) return null;

  const base = path.basename(clean).toLowerCase();
  const def = BY_EXE.get(base);
  if (!def) return null;

  if (def.id === 'sublime') {
    // 启动一律用 subl.exe（能吃目录参数），图标要从 sublime_text.exe 抽：
    // subl.exe 是启动垫片，自身没有图标资源
    const dir = path.dirname(clean);
    const launcher = path.join(dir, 'subl.exe');
    const body = path.join(dir, 'sublime_text.exe');
    const exe = isFile(launcher) ? launcher : clean;
    return { id: def.id, name: def.name, exe, args: [], iconExe: isFile(body) ? body : exe };
  }
  return { id: def.id, name: def.name, exe: clean, args: [] };
}

/* ── 各扫描来源 ───────────────────────────────── */

/** 本层及最多 MAX_NEARBY_UP 层父目录里找白名单 exe（非递归，单层只查文件名） */
function findNearbyExe(startDir) {
  let dir = startDir;
  for (let up = 0; up <= MAX_NEARBY_UP && dir; up++) {
    for (const name of BY_EXE.keys()) {
      const p = path.join(dir, name);
      if (!isFile(p)) continue;
      const item = normalize(p);
      if (item) return item;
    }
    const parent = path.dirname(dir);
    if (!parent || parent === dir) break;
    dir = parent;
  }
  return null;
}

/** 这个快捷方式看起来像某个 IDE 吗（只有像才去附近找本体，避免对 200 个快捷方式全量扫盘） */
function looksLikeIde(lnkName, target) {
  const hay = (String(lnkName || '') + ' ' + String(target || '')).toLowerCase();
  return LAUNCHER_TOKENS.some((t) => hay.includes(t));
}

/** 1. Windows 开始菜单快捷方式（命中率最高：跟用户看到的一致，装哪个盘都行） */
function scanStartMenu(native, diag) {
  const dirs = [
    process.env.ProgramData && path.join(process.env.ProgramData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    process.env.APPDATA && path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs')
  ].filter(Boolean);

  const read = native && typeof native.readShortcut === 'function' ? native.readShortcut : null;
  if (!read) return [];

  const links = [];
  for (const d of dirs) collectLinks(d, links, 0);
  diag.lnkScanned = links.length;

  const out = [];
  let viaCwd = 0;
  for (const lnk of links) {
    const info = read(lnk);
    if (!info) continue;
    const target = info.target || info.path;
    const item = normalize(target);
    if (item) {
      out.push(item);
      continue;
    }
    // 目标是启动器 / 不是白名单 exe：像 IDE 的话，到快捷方式的 cwd 附近找本体
    if (info.cwd && looksLikeIde(path.basename(lnk, '.lnk'), target)) {
      const found = findNearbyExe(info.cwd);
      if (found) {
        out.push(found);
        viaCwd += 1;
      }
    }
  }
  diag.lnkViaCwd = viaCwd;
  return out;
}

/** 2. 常见安装路径（没有快捷方式的兜底） */
function scanKnownPaths(diag) {
  const env = process.env;
  const local = env.LOCALAPPDATA || '';
  const pf = env.ProgramFiles || 'C:\\Program Files';
  const pf86 = env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

  const files = [];
  if (local) {
    files.push(
      path.join(local, 'Programs', 'Microsoft VS Code', 'Code.exe'),
      path.join(local, 'Programs', 'cursor', 'Cursor.exe'),
      path.join(local, 'Programs', 'Windsurf', 'Windsurf.exe'),
      path.join(local, 'Programs', 'Trae', 'Trae.exe'),
      path.join(local, 'Programs', 'Qoder', 'Qoder.exe')
    );
  }
  files.push(
    path.join(pf, 'Microsoft VS Code', 'Code.exe'),
    path.join(pf86, 'Microsoft VS Code', 'Code.exe'),
    path.join(pf, 'Sublime Text', 'subl.exe'),
    path.join(pf, 'Sublime Text', 'sublime_text.exe'),
    path.join(pf, 'Android', 'Android Studio', 'bin', 'studio64.exe'),
    path.join(pf, 'JetBrains', 'IntelliJ IDEA', 'bin', 'idea64.exe')
  );
  diag.knownPathChecked = files.length;

  const out = [];
  for (const f of files) {
    const item = normalize(f);
    if (item) out.push(item);
  }
  return out;
}

/**
 * 3. JetBrains 安装目录 + Toolbox。
 * Toolbox 的层级是 apps/<产品>/ch-<通道>/<版本>/bin，普通安装是 JetBrains/<产品>/bin，
 * 两种都能被这段深度受限的遍历覆盖。
 */
function scanJetBrains(diag) {
  const env = process.env;
  const roots = [];
  if (env.ProgramFiles) roots.push(path.join(env.ProgramFiles, 'JetBrains'));
  if (env['ProgramFiles(x86)']) roots.push(path.join(env['ProgramFiles(x86)'], 'JetBrains'));
  if (env.LOCALAPPDATA) {
    roots.push(path.join(env.LOCALAPPDATA, 'JetBrains', 'Toolbox', 'apps'));
    roots.push(path.join(env.LOCALAPPDATA, 'Programs', 'JetBrains'));
  }

  const dirs = roots.filter(isDir);
  diag.jetbrainsRoots = dirs.length;

  const exes = [];
  for (const d of dirs) collectExes(d, exes, 0);

  const out = [];
  for (const e of exes) {
    const item = normalize(e);
    if (item) out.push(item);
  }
  return out;
}

/** 4. PATH 里的 exe（命令行安装过的那种）；已被前面来源找到的 IDE 跳过，省掉上万次 stat */
function scanPathEnv(diag, skipIds) {
  const dirs = String(process.env.PATH || '')
    .split(path.delimiter)
    .filter(Boolean);
  diag.pathDirs = dirs.length;

  const skip = skipIds || new Set();
  const names = REGISTRY.filter((r) => !skip.has(r.id)).map((r) => r.exe);
  const out = [];
  for (const d of dirs) {
    for (const n of names) {
      const p = path.join(d, n);
      if (!isFile(p)) continue;
      const item = normalize(p);
      if (item) out.push(item);
    }
  }
  return out;
}

/** macOS：/Applications 与 ~/Applications 里的 .app */
function scanMacApps(diag) {
  const roots = ['/Applications', path.join(process.env.HOME || '', 'Applications')].filter(isDir);
  const out = [];
  for (const root of roots) {
    for (const full of readDirs(root)) {
      const app = path.basename(full);
      const def = MAC_APPS.find((m) => m.app === app);
      if (!def) continue;
      // -a 接受 .app 全路径，比传应用名稳（同名的多份副本也能区分）
      out.push({ id: def.id, name: def.name, exe: 'open', app: full, args: [], kind: 'mac' });
    }
  }
  diag.macRoots = roots.length;
  return out;
}

/** Linux：解析 .desktop 的 Exec 首段，命令名对上白名单即收录 */
function scanLinuxDesktop(diag) {
  const roots = [
    '/usr/share/applications',
    '/usr/local/share/applications',
    path.join(process.env.HOME || '', '.local/share/applications'),
    '/var/lib/flatpak/exports/share/applications'
  ].filter(isDir);

  const out = [];
  for (const root of roots) {
    let entries;
    try {
      entries = fs.readdirSync(root).filter((f) => f.endsWith('.desktop'));
    } catch (_) {
      continue;
    }
    for (const f of entries) {
      let text;
      try {
        text = fs.readFileSync(path.join(root, f), 'utf8');
      } catch (_) {
        continue;
      }
      const line = text.split('\n').find((l) => /^Exec\s*=/.test(l));
      if (!line) continue;
      const cmd = line
        .replace(/^Exec\s*=\s*/, '')
        .replace(/^["']/, '')
        .split(/\s+/)[0];
      if (!cmd) continue;
      const base = path.basename(cmd).toLowerCase();
      const def = BY_EXE.get(base) || BY_EXE.get(base + '.exe');
      if (!def) continue;
      const bin = cmd.startsWith('/') ? cmd : findInPath(cmd);
      if (!bin) continue;
      out.push({ id: def.id, name: def.name, exe: bin, args: [] });
    }
  }
  diag.linuxRoots = roots.length;
  return out;
}

function findInPath(name) {
  const dirs = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const d of dirs) {
    const p = path.join(d, name);
    if (isFile(p)) return p;
  }
  return null;
}

/* ── 对外 ─────────────────────────────────────── */

/** 合并各来源 → 按 id 去重（先扫到的优先）→ 按白名单顺序排序 */
function merge(groups, diag) {
  const byId = new Map();
  for (const group of groups) {
    for (const item of group) {
      if (!item || byId.has(item.id)) continue;
      byId.set(item.id, item);
    }
  }
  const list = [...byId.values()].sort(
    (a, b) => (WEIGHT.get(a.id) ?? 999) - (WEIGHT.get(b.id) ?? 999) || a.name.localeCompare(b.name)
  );
  diag.found = list.length;
  return list;
}

/**
 * 扫描本机 IDE。
 * @param {{ refresh?: boolean, native?: { readShortcut?: (lnk: string) => any } }} opts
 * @returns {{ ides: Array, diagnostics: object }}
 */
function scan(opts) {
  const o = opts || {};
  if (cache && !o.refresh) return cache;
  if (scanning) return cache || { ides: [], diagnostics: { busy: true } };

  scanning = true;
  const started = Date.now();
  const native = o.native || {};
  const diag = { platform: process.platform };

  try {
    const groups = [];
    if (process.platform === 'win32') {
      // 快捷方式优先，拿到的是用户日常启动的那个
      groups.push(scanStartMenu(native, diag), scanKnownPaths(diag), scanJetBrains(diag));
    } else if (process.platform === 'darwin') {
      groups.push(scanMacApps(diag));
    } else {
      groups.push(scanLinuxDesktop(diag));
    }

    // PATH 兜底放最后：已经找到的 IDE 不再重复扫
    const known = new Set();
    for (const g of groups) for (const item of g) known.add(item.id);
    groups.push(scanPathEnv(diag, known));

    const ides = merge(groups, diag);

    // 图标：从 exe 的 PE 资源里抽（结果在 icon.js 内部按路径缓存，重扫几乎不耗时）
    let withIcon = 0;
    for (const item of ides) {
      const source = item.kind === 'mac' ? '' : item.iconExe || item.exe;
      const got = source ? icon.get(source) : null;
      item.icon = got ? got.dataUrl : null;
      if (item.icon) withIcon += 1;
    }
    diag.icons = withIcon;

    diag.elapsedMs = Date.now() - started;
    cache = { ides, diagnostics: diag };
    return cache;
  } finally {
    scanning = false;
  }
}

/** 丢弃缓存，下次 scan 重新扫盘 */
function reset() {
  cache = null;
}

/**
 * 用指定 IDE 打开目录。
 * ideId 必须来自扫描结果——绝不接受调用方传来的任意 exe 路径，否则等于开了任意执行的口子。
 */
function open(projectPath, ideId, opts) {
  const o = opts || {};
  const data = scan({ native: o.native });
  const id = String(ideId || '');
  const item = data.ides.find((x) => x.id === id);
  if (!item) fail('未找到 IDE：' + (id || '(空)') + '，请重新扫描', 'ide_not_found', 404);

  const target = String(projectPath || '');
  if (!isDir(target)) fail('项目路径不存在：' + target, 'path_missing', 404);
  if (item.kind !== 'mac' && !isFile(item.exe)) {
    reset(); // 装机列表可能已过时，让下次扫描重新来
    fail('IDE 可执行文件已不存在：' + item.exe, 'ide_missing', 500);
  }

  const bin = item.kind === 'mac' ? 'open' : item.exe;
  const args = item.kind === 'mac' ? ['-a', item.app, target] : [...(item.args || []), target];

  let child;
  try {
    child = spawn(bin, args, {
      cwd: isDir(target) ? target : undefined,
      detached: true,
      stdio: 'ignore',
      windowsHide: false
    });
  } catch (e) {
    fail('启动 ' + item.name + ' 失败：' + e.message, 'ide_spawn_failed', 500);
  }
  // 单实例 IDE 会立刻退出，这里只兜 ENOENT，不把 exit code 当失败
  child.on('error', (e) => console.error('[ide] 启动失败:', e.message));
  child.unref();

  return { id: item.id, name: item.name };
}

module.exports = { scan, open, reset, REGISTRY };

'use strict';

/**
 * 本机技能目录扫描：把各客户端 skills 目录里的技能汇总成一张「技能 → 目录」的表。
 *
 * 设计要点：
 * - 结果只是「本机事实」：技能 Y 在路径 P。它不表示某个 Agent 能用 Y ——
 *   同一台机器上多个 AgentID 共享同一批目录，扫描无法区分身份，也不该假装能区分。
 *   真正回答「这条任务该在哪找技能」的是需求自己的 `{UseSkill:x}` 关联（见 skill-refs.js）。
 * - 结果不进 db.json：这是可再生的环境缓存，不是用户数据。db.json 会被备份与整份拷贝，
 *   把别的机器的绝对路径写进去只会制造失效数据。落到 userData/cache/skills.json。
 * - 可重复触发：用户随时可能装 / 删技能，只在启动扫一次会让补全长期停在旧快照上。
 *   启动扫一次只是「让首次打开就有数据」，按钮与 /skills/rescan 负责之后。
 * - 解析只认两种：SKILL.md 的 YAML frontmatter（name / description），取不到就用目录名。
 *   各客户端目录结构不同，靠一张纯数据探测表兜住，加一家只需加一行。
 * - 失败一律吞掉：某个 root 不存在、权限不足、frontmatter 写坏，都不能影响其他 root，
 *   也不能阻断启动。
 * - 不扫插件市场缓存（如 ~/.workbuddy/plugins/cache）：那里是「可安装池」不是「已启用集」，
 *   几千个条目既慢又会把补全列表灌满噪声。要纳入就自己往 ROOTS 加一行。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const CACHE_FILE = 'skills.json';
const CACHE_VERSION = 1;

/**
 * 技能根下最多下探三层：`root/<名字>/SKILL.md`，也兼容 `root/<命名空间>/<名字>/SKILL.md`。
 * 一旦当前目录自己有 SKILL.md 就停止下探 —— 技能内部结构（scripts/ 等）与本工具无关。
 */
const MAX_DEPTH = 3;

/** description 截断：补全列表里只需要一眼看懂「它是干什么的」 */
const DESC_MAX = 200;

/** 这些都是构建产物或依赖目录，进去只会浪费时间 */
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  'dist',
  'build',
  'out',
  '.venv',
  'venv',
  '__pycache__',
  '.cache'
]);

/**
 * 已知客户端的默认技能目录与显示名。**这里不决定扫描范围**——真正被扫的只有用户添加过的
 * Agent 自己配的目录；这张表只负责「本机已装」候选列表里的名字与默认路径。
 * 表里没有的客户端由 discoverExtraRoots() 兜底发现，所以新增一家客户端不改代码也能被看到。
 */
const ROOTS = [
  { source: 'workbuddy', home: ['.workbuddy/skills'] },
  { source: 'claude', home: ['.claude/skills'] },
  { source: 'codex', home: ['.codex/skills'] },
  { source: 'gemini', home: ['.gemini/skills'] },
  { source: 'cursor', home: ['.cursor/skills'] },
  { source: 'windsurf', home: ['.windsurf/skills'] },
  { source: 'trae', home: ['.trae/skills'] },
  { source: 'trae-cn', home: ['.trae-cn/skills'] },
  { source: 'qoder', home: ['.qoder/skills'] },
  { source: 'qoder-cn', home: ['.qoder-cn/skills'] },
  { source: 'kiro', home: ['.kiro/skills'] },
  { source: 'opencode', home: ['.config/opencode/skills'] }
];

/** 界面上显示的名字：探测表里的 source 是内部标识，不该直接给用户看 */
const LABELS = {
  workbuddy: 'WorkBuddy',
  claude: 'Claude Code',
  codex: 'Codex',
  gemini: 'Gemini CLI',
  cursor: 'Cursor',
  windsurf: 'Windsurf',
  trae: 'Trae',
  'trae-cn': 'Trae CN',
  qoder: 'Qoder',
  'qoder-cn': 'Qoder CN',
  kiro: 'Kiro',
  opencode: 'OpenCode'
};

/** 路径比较口径：分隔符与末尾斜杠不敏感，Windows 下大小写不敏感 */
function normPath(p) {
  const s = String(p || '')
    .trim()
    .replace(/[\\/]+/g, '/')
    .replace(/\/+$/, '');
  return process.platform === 'win32' ? s.toLowerCase() : s;
}

/** 注册表里所有 Agent 自配的技能目录，展开成扫描用的扁平清单 */
function agentDirList(agents) {
  const out = [];
  for (const a of Array.isArray(agents) ? agents : []) {
    for (const p of Array.isArray(a && a.skillDirs) ? a.skillDirs : []) {
      const dir = String((p && typeof p === 'object' ? p.path : p) || '').trim();
      if (dir) out.push({ agentId: a.id, dir });
    }
  }
  return out;
}

/** 内存快照：null 表示还没从磁盘读过 */
let state = null;
/** 缓存目录（userData/cache），由 configure 注入 */
let baseDir = null;

function emptyState() {
  return { version: CACHE_VERSION, scannedAt: null, roots: [], skills: [] };
}

function cacheFile() {
  return baseDir ? path.join(baseDir, CACHE_FILE) : null;
}

/**
 * 空行 / 注释行跳过；只取顶层的 `key: value`。
 * 刻意不引 YAML 依赖：SKILL.md 的 frontmatter 实际只用到 name 与 description 两个标量。
 */
function readFrontMatter(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (_) {
    return null;
  }

  // BOM 会让第一个 `---` 匹配失败，先削掉
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const head = text.split(/\r?\n/, 80);
  if (!/^---\s*$/.test(head[0] || '')) return null;

  const out = {};
  let lastKey = null;
  for (let i = 1; i < head.length; i++) {
    const line = head[i];
    if (/^---\s*$/.test(line)) break;
    if (!line.trim() || /^\s*#/.test(line)) continue;

    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (kv) {
      lastKey = kv[1].toLowerCase();
      out[lastKey] = kv[2].trim();
      continue;
    }
    // 缩进续行（多行 description）：只在上一个键存在时追加
    if (/^\s+\S/.test(line) && lastKey) out[lastKey] = (out[lastKey] + ' ' + line.trim()).trim();
  }

  const strip = (v) =>
    String(v || '')
      .replace(/^["']|["']$/g, '')
      // `>-` / `|` 这类块标记本身不是内容
      .replace(/^[|>][+-]?\s*/, '')
      .trim();
  return { name: strip(out.name), description: strip(out.description) };
}

function clip(text, max) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

/**
 * Dirent 的类型判定必须跟随符号链接：技能管理器（skillhub 等）普遍用软链把技能挂进
 * `skills/`，而 `e.isDirectory()` 对软链返回 false —— 直接按它筛会把大部分技能漏掉（实测 18 个只剩 1 个是真目录）。
 * 断链返回 null（目标已被删），由调用方安静跳过。
 */
function kindOf(entry, at) {
  if (entry.isDirectory()) return 'dir';
  if (entry.isFile()) return 'file';
  if (entry.isSymbolicLink()) {
    try {
      const st = fs.statSync(path.join(at, entry.name));
      if (st.isDirectory()) return 'dir';
      if (st.isFile()) return 'file';
    } catch (_) {
      return null;
    }
  }
  return null;
}

/**
 * 在单个目录下找技能。
 * @returns {object[]} 技能条目（已去重由调用方做）
 */
function scanDir(dir, source, scope) {
  const found = [];
  /** 已访问的真实路径：软链可能绕回上层，靠它断环 */
  const seen = new Set();

  /** @param {string} at 当前目录 @param {number} depth 已下探层数 */
  function walk(at, depth) {
    if (depth > MAX_DEPTH) return;

    // 软链目录可能互相指向（或指回上层），按真实路径去重防止绕圈
    let real;
    try {
      real = fs.realpathSync(at);
    } catch (_) {
      return;
    }
    if (seen.has(real)) return;
    seen.add(real);

    let items;
    try {
      items = fs.readdirSync(at, { withFileTypes: true });
    } catch (_) {
      return;
    }

    // 当前目录自己就是一个技能：有 SKILL.md 就不再往里走（技能内部结构与本工具无关）
    const own = items.find((e) => kindOf(e, at) === 'file' && /^SKILL\.md$/i.test(e.name));
    if (own) {
      const entry = path.join(at, own.name);
      const meta = readFrontMatter(entry) || {};
      const name = String(meta.name || '').trim() || path.basename(at);
      let mtime = 0;
      try {
        mtime = fs.statSync(entry).mtimeMs;
      } catch (_) {}
      if (name) {
        found.push({
          id: source + '/' + name,
          source,
          name,
          scope,
          dir: at,
          entry,
          description: clip(meta.description, DESC_MAX),
          mtime
        });
      }
      return;
    }

    for (const e of items) {
      const kind = kindOf(e, at);
      if (kind === 'dir') {
        if (e.name.startsWith('.') || SKIP_DIRS.has(e.name.toLowerCase())) continue;
        walk(path.join(at, e.name), depth + 1);
        continue;
      }
      // 少数客户端允许把技能写成 skills/foo.md 单个文件
      if (kind === 'file' && /\.md$/i.test(e.name) && depth === 1) {
        const entry = path.join(at, e.name);
        const meta = readFrontMatter(entry) || {};
        const name = String(meta.name || '').trim() || e.name.replace(/\.md$/i, '');
        let mtime = 0;
        try {
          mtime = fs.statSync(entry).mtimeMs;
        } catch (_) {}
        found.push({
          id: source + '/' + name,
          source,
          name,
          scope,
          dir: at,
          entry,
          description: clip(meta.description, DESC_MAX),
          mtime
        });
      }
    }
  }

  walk(dir, 1);
  return found;
}

function readCache() {
  const file = cacheFile();
  if (!file) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!raw || !Array.isArray(raw.skills)) return null;
    return {
      version: CACHE_VERSION,
      scannedAt: raw.scannedAt || null,
      roots: Array.isArray(raw.roots) ? raw.roots : [],
      skills: raw.skills
    };
  } catch (_) {
    return null;
  }
}

function writeCache(next) {
  const file = cacheFile();
  if (!file) return;
  try {
    fs.mkdirSync(baseDir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(next), 'utf8');
  } catch (e) {
    // 缓存写不进去不影响本次运行：内存里已经有这份清单
    console.error('[skill-scan] 写缓存失败：' + e.message);
  }
}

/**
 * 目录归属哪个客户端家族：只用来拼技能 id（`workbuddy/pdf`），影响命名不影响范围。
 * 认不出来就算 `custom` —— 用户自己挂的任意目录都走这一支。
 */
function sourceForDir(dir) {
  const key = normPath(dir);
  if (!key) return 'custom';
  const home = os.homedir();
  for (const def of ROOTS) {
    for (const rel of def.home) {
      if (normPath(path.join(home, rel)) === key) return def.source;
    }
  }
  // `.../<.客户端>/skills` 这种标准布局：把点目录名当家族名（.workbuddy → workbuddy）
  const parts = key.split('/');
  if (parts.length >= 2 && parts[parts.length - 1] === 'skills') {
    const parent = parts[parts.length - 2];
    if (parent.startsWith('.')) return parent.slice(1).replace(/[^a-z0-9_-]/g, '') || 'custom';
  }
  return 'custom';
}

/**
 * 全量重扫。**只扫已登记 Agent 自己配的技能目录** —— 没被添加的客户端不扫，
 * 补全列表里也不会出现它。同步执行（调用方负责放到 setImmediate 里别堵窗口）。
 * @param {{agentDirs?: Array<{agentId?: string, dir: string}>,
 *          agents?: Array, now?: number}=} opts
 */
function rescan(opts) {
  const o = opts || {};
  const now = Number.isFinite(o.now) ? o.now : Date.now();
  const roots = [];
  const byId = new Map();

  function absorb(list) {
    for (const s of list) {
      const hit = byId.get(s.id);
      if (hit) {
        // 同一技能被两个 Agent 的目录同时扫到：保留先扫到的，只记重复次数
        hit.duplicates = (hit.duplicates || 0) + 1;
        continue;
      }
      byId.set(s.id, s);
    }
  }

  /** 同一目录被多个 Agent 挂载时只扫一次：结果共享，归属由视图按目录前缀算 */
  const seenRoots = new Set();
  for (const ad of Array.isArray(o.agentDirs) ? o.agentDirs : []) {
    const dir = String((ad && ad.dir) || '').trim();
    const key = normPath(dir);
    if (!key || seenRoots.has(key)) continue;
    seenRoots.add(key);

    const agentId = (ad && ad.agentId) || null;
    const source = sourceForDir(dir);
    if (!fs.existsSync(dir)) {
      // 记一条不存在的根：界面据此说明「这个 Agent 的目录没找到」，而不是悄悄少几项技能
      roots.push({ source, scope: 'agent', agentId, dir, exists: false, count: 0 });
      continue;
    }
    const got = scanDir(dir, source, 'agent');
    roots.push({ source, scope: 'agent', agentId, dir, exists: true, count: got.length });
    absorb(got);
  }

  const skills = Array.from(byId.values()).sort((a, b) => a.id.localeCompare(b.id));
  const next = { version: CACHE_VERSION, scannedAt: new Date(now).toISOString(), roots, skills };
  state = next;
  writeCache(next);
  return publicView(next, o.agents);
}

/** 磁盘上没有任何缓存时的兜底：空清单，但带上 scannedAt=null 让界面能说「还没扫过」 */
function load() {
  if (state) return state;
  state = readCache() || emptyState();
  return state;
}

function existsDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch (_) {
    return false;
  }
}

/**
 * 一个目录归哪些 Agent 所有：按目录前缀判断，所以同一个目录挂在多个 Agent 名下会全部列出
 * （同机多开共享目录是常态，界面据此标「共享」）。传进来的 agents 是注册表原始条目。
 */
function agentsForDir(dir, agents) {
  const d = normPath(dir);
  if (!d) return [];
  const out = [];
  for (const a of Array.isArray(agents) ? agents : []) {
    const dirs = Array.isArray(a && a.skillDirs) ? a.skillDirs : [];
    const hit = dirs.some((p) => {
      const x = normPath(p && typeof p === 'object' ? p.path : p);
      return !!x && (d === x || d.startsWith(x + '/'));
    });
    if (hit) out.push(a.id);
  }
  return out;
}

/** 对外视图：路径之外带上 entry 是否还在，前端与 agent 据此显示失效态 */
function publicOf(s, agents) {
  return {
    id: s.id,
    source: s.source,
    name: s.name,
    scope: s.scope || 'home',
    dir: s.dir,
    entry: s.entry,
    description: s.description || '',
    exists: existsDir(s.dir) && !!s.entry && fs.existsSync(s.entry),
    /** 这个技能目录归哪些 Agent（空数组 = 只来自全局扫描，没挂到任何 Agent 上） */
    agents: agentsForDir(s.dir, agents)
  };
}

function publicView(snapshot, agents) {
  return {
    scannedAt: snapshot.scannedAt,
    roots: snapshot.roots,
    skills: snapshot.skills.map((s) => publicOf(s, agents))
  };
}

function list() {
  return load().skills;
}

/** @param {Array=} agents 注册表条目，用来给每个技能标注归属 */
function view(agents) {
  return publicView(load(), agents);
}

/**
 * 目录看起来是不是「技能根」：只要有一项是 `.md` 文件或含 `SKILL.md` 的子目录就算。
 * 只读一层，成本与一次 readdir 相当。用来过滤掉同名但塞着缓存 json 的目录
 * （本机 `~/.tokentracker/skills` 里全是 usage-cache.json，不是技能）。
 */
function looksLikeSkillRoot(dir) {
  let items;
  try {
    items = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return false;
  }
  for (const e of items) {
    if (e.name.startsWith('.')) continue;
    const kind = kindOf(e, dir);
    if (kind === 'file' && /\.md$/i.test(e.name)) return true;
    if (kind === 'dir' && fs.existsSync(path.join(dir, e.name, 'SKILL.md'))) return true;
  }
  return false;
}

/**
 * 兜底发现 `~/.<客户端>/skills`：表里没有的客户端也照样能被选到。
 * 起因是 Trae CN 装在 `~/.trae-cn`、Qoder CN 在 `~/.qoder-cn`，硬编码表必然漏；
 * 与其逐家补，不如按形状找 —— 只做只读探测，不进注册表、不统计技能数。
 * @param {Set<string>} knownKeys 已由 ROOTS 覆盖的目录（normPath 后），避免重复
 */
function discoverExtraRoots(knownKeys) {
  const home = os.homedir();
  let names;
  try {
    names = fs.readdirSync(home);
  } catch (_) {
    return [];
  }
  const out = [];
  for (const name of names) {
    // 只认隐藏目录：客户端数据都放在 `.<名字>` 下，普通目录多半是别的东西
    if (!name.startsWith('.')) continue;
    const dir = path.join(home, name, 'skills');
    const key = normPath(dir);
    if (!key || knownKeys.has(key)) continue;
    if (!existsDir(dir) || !looksLikeSkillRoot(dir)) continue;
    const label = name.slice(1);
    out.push({ client: label, label, dir, exists: true });
  }
  out.sort((a, b) => a.client.localeCompare(b.client));
  return out;
}

/**
 * 本机装了哪些客户端：只认「目录存在」这一个信号。
 * 不去 `where claude`、也不看进程表 —— 前者平台差异大且慢，后者是瞬时的，扫出来的东西下一秒就可能不成立。
 * 返回的是**候选**，不自动建 Agent，也不在这里统计技能数（没被添加的客户端不扫）。
 */
function detectClients() {
  const home = os.homedir();
  const known = ROOTS.map((def) => {
    const dirs = def.home.map((rel) => path.join(home, rel));
    const hit = dirs.find(existsDir) || null;
    return {
      client: def.source,
      label: LABELS[def.source] || def.source,
      dir: hit || dirs[0] || null,
      exists: !!hit
    };
  });
  const knownKeys = new Set(known.map((c) => normPath(c.dir)).filter(Boolean));
  return known.concat(discoverExtraRoots(knownKeys));
}

/** 按 id 精确取（`source/name`），没有则 null —— 失效判断交给调用方 */
function find(id) {
  const key = String(id || '').trim();
  if (!key) return null;
  return load().skills.find((s) => s.id === key) || null;
}

/** 同名的全部条目：裸名解析时用来判断重名 */
function findByName(name) {
  const key = String(name || '').trim().toLowerCase();
  if (!key) return [];
  return load().skills.filter((s) => String(s.name).toLowerCase() === key);
}

/**
 * 单条查询。查不到也返回结构完整的对象（`exists:false, found:false`）：
 * 调用方（agent / 前端）要靠这个分支走「技能已不存在」的提示，而不是靠 HTTP 404 猜。
 */
function viewOne(id) {
  const key = String(id || '').trim();
  // 限定 id 精确命中；裸名只在全局唯一时算命中，重名时下面会把 candidates 一起给出
  const same = findByName(key);
  const s = find(key) || (key.includes('/') ? null : same[0]);
  if (!s) {
    return {
      id: key,
      source: null,
      name: key,
      scope: null,
      dir: null,
      entry: null,
      description: '',
      exists: false,
      found: false,
      ambiguous: false,
      candidates: []
    };
  }
  return Object.assign(publicOf(s), {
    found: true,
    ambiguous: same.length > 1,
    candidates: same.map((x) => x.id)
  });
}

function configure(dir) {
  baseDir = dir || null;
  state = null;
}

function cachePath() {
  return cacheFile();
}

module.exports = {
  ROOTS,
  LABELS,
  CACHE_FILE,
  configure,
  cachePath,
  rescan,
  list,
  view,
  viewOne,
  detectClients,
  agentsForDir,
  agentDirList,
  sourceForDir,
  find,
  findByName,
  readFrontMatter
};

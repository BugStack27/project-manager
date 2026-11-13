'use strict';

const fs = require('fs');
const path = require('path');

/** 数据目录在运行时注入（Electron 用 app.getPath('userData')，测试可用临时目录） */
let DATA_DIR = null;
let RUNS_DIR = null;
let EVENTS_DIR = null;
let DB_FILE = null;
let BACKUP_DIR = null;

const BACKUP_KEEP = 7;

/** 快照命名：每日 = db-YYYY-MM-DD.json；手动安全备份 = manual-YYYYMMDD-HHmmss[-n].json */
const DAILY_RE = /^db-(\d{4}-\d{2}-\d{2})\.json$/;
const MANUAL_RE = /^manual-(\d{8})-(\d{6})(?:-(\d+))?\.json$/;

const EMPTY = { version: 1, projects: [], requirements: [], commands: [], agents: [], settings: {} };

let db = null;
/** 锁写：恢复后、以及启动时发现库损坏，都不能把内存数据写回磁盘 */
let writesLocked = false;
/**
 * 启动自检发现的损坏：db.json 解析失败时保留原文件并锁写，
 * 界面据此提示「已按空库启动」并引导从快照恢复。
 */
let corruption = null;

function configure(dataDir) {
  const dir = String(dataDir || '').trim();
  if (!dir) throw new Error('数据目录不能为空');
  DATA_DIR = path.resolve(dir);
  RUNS_DIR = path.join(DATA_DIR, 'runs');
  EVENTS_DIR = path.join(DATA_DIR, 'events');
  DB_FILE = path.join(DATA_DIR, 'db.json');
  BACKUP_DIR = path.join(DATA_DIR, 'backups');
  // runner / 调用方按属性读取，这里同步刷新导出值
  module.exports.DATA_DIR = DATA_DIR;
  module.exports.RUNS_DIR = RUNS_DIR;
  module.exports.EVENTS_DIR = EVENTS_DIR;
  module.exports.DB_FILE = DB_FILE;
  db = null;
  writesLocked = false;
  corruption = null;
}

function ensureDirs() {
  if (!DATA_DIR) throw new Error('store 尚未 configure()');
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(RUNS_DIR, { recursive: true });
  fs.mkdirSync(EVENTS_DIR, { recursive: true });
}

function dayKey() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return d.getFullYear() + '-' + mm + '-' + dd;
}

/** 当天首次写入前快照当前 db.json，只保留最近 BACKUP_KEEP 天 */
function backupDaily() {
  if (!fs.existsSync(DB_FILE)) return;
  const dest = path.join(BACKUP_DIR, 'db-' + dayKey() + '.json');
  if (fs.existsSync(dest)) return;

  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const tmp = dest + '.tmp';
  fs.copyFileSync(DB_FILE, tmp);
  fs.renameSync(tmp, dest);

  const names = fs.readdirSync(BACKUP_DIR)
    .filter((n) => DAILY_RE.test(n))
    .sort();
  for (const n of names.slice(0, Math.max(0, names.length - BACKUP_KEEP))) {
    try { fs.unlinkSync(path.join(BACKUP_DIR, n)); } catch (_) {}
  }
}

/* ── 快照读取与恢复 ─────────────────────────── */

const pad2 = (n) => String(n).padStart(2, '0');

/** 当前时间的手动快照名；同秒重名追加 -2、-3…，不会被每日清理规则匹配 */
function manualBackupName() {
  const d = new Date();
  const base =
    'manual-' +
    d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + '-' +
    pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds());
  let name = base + '.json';
  for (let seq = 2; fs.existsSync(path.join(BACKUP_DIR, name)); seq += 1) {
    name = base + '-' + seq + '.json';
  }
  return name;
}

/** 列出每日快照与手动安全备份（按文件大小与内容计数，坏文件也列出但标为不可用） */
function listBackups() {
  if (!BACKUP_DIR || !fs.existsSync(BACKUP_DIR)) return [];

  const out = [];
  for (const name of fs.readdirSync(BACKUP_DIR)) {
    const daily = DAILY_RE.exec(name);
    const manual = MANUAL_RE.exec(name);
    if (!daily && !manual) continue;

    const abs = path.join(BACKUP_DIR, name);
    let stat;
    try { stat = fs.statSync(abs); } catch (_) { continue; }

    let parsed = null;
    try { parsed = JSON.parse(fs.readFileSync(abs, 'utf8')); } catch (_) {}
    const ok = parsed && typeof parsed === 'object' && !Array.isArray(parsed);
    const count = (key) => (ok && Array.isArray(parsed[key]) ? parsed[key].length : 0);

    out.push({
      name,
      kind: daily ? 'daily' : 'manual',
      date: daily ? daily[1] : manual[1].slice(0, 4) + '-' + manual[1].slice(4, 6) + '-' + manual[1].slice(6, 8),
      time: daily ? null : manual[2].slice(0, 2) + ':' + manual[2].slice(2, 4) + ':' + manual[2].slice(4, 6),
      size: stat.size,
      projectCount: count('projects'),
      requirementCount: count('requirements'),
      commandCount: count('commands'),
      valid: !!ok
    });
  }

  // 每日快照在前、手动备份在后；两组内部按文件名倒序（时间为最新在前）
  out.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'daily' ? -1 : 1;
    return b.name.localeCompare(a.name);
  });
  return out;
}

function backupError(message, code, status) {
  const e = new Error(message);
  e.code = code;
  e.status = status;
  return e;
}

/**
 * 用指定快照覆盖 db.json。
 * - 文件名必须严格命中两种命名（正则本身已排除分隔符与 ..）；
 * - 先校验快照可解析，坏快照绝不覆盖当前库；
 * - 覆盖前把当前库另存为 manual 安全备份（不参与每日 7 天清理）；
 *   当前库本身已损坏时改为另存 db.json.broken-<时间戳>，不污染快照列表；
 * - 写盘后锁写，调用方必须立即重启应用。
 */
function restoreBackup(name) {
  const n = String(name || '').trim();
  if (!DAILY_RE.test(n) && !MANUAL_RE.test(n)) {
    throw backupError(n ? '快照文件名不合法' : '缺少快照文件名', 'bad_backup', 400);
  }

  const abs = path.join(BACKUP_DIR, n);
  if (!fs.existsSync(abs)) throw backupError('快照不存在：' + n, 'backup_missing', 404);

  let raw;
  try {
    raw = fs.readFileSync(abs, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('不是对象');
  } catch (_) {
    throw backupError('快照已损坏，无法解析：' + n, 'backup_broken', 400);
  }

  let safety = null;
  if (fs.existsSync(DB_FILE)) {
    if (corruption) {
      // 损坏的库：恢复会覆盖 db.json，先把原文件另存一份带时间戳的副本；
      // 它是已知的坏数据，不放进 backups/，避免污染快照列表
      fs.copyFileSync(DB_FILE, DB_FILE + '.broken-' + Date.now());
    } else {
      safety = manualBackupName();
      fs.copyFileSync(DB_FILE, path.join(BACKUP_DIR, safety));
    }
  }

  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, raw, 'utf8');
  fs.renameSync(tmp, DB_FILE);

  writesLocked = true;
  corruption = null;
  db = null;
  return { restored: n, safety };
}

function blank() {
  return JSON.parse(JSON.stringify(EMPTY));
}

function load() {
  ensureDirs();
  if (!fs.existsSync(DB_FILE)) {
    db = blank();
    save();
    return db;
  }
  let raw = null;
  let parsed;
  try {
    raw = fs.readFileSync(DB_FILE, 'utf8');
    parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('根节点不是对象');
  } catch (e) {
    // 损坏的库绝不覆盖：db.json 原样留在磁盘上，本次运行锁写，由界面提示去恢复备份
    corruption = {
      message: e && e.message ? String(e.message) : '无法解析',
      size: raw === null ? null : Buffer.byteLength(raw, 'utf8'),
      at: new Date().toISOString()
    };
    writesLocked = true;
    db = blank();
    process.stderr.write(
      '[store] db.json 解析失败（' + corruption.message + '），已保留原文件并进入只读空库模式\n'
    );
    return db;
  }
  db = parsed;
  if (!Array.isArray(db.projects)) db.projects = [];
  if (!Array.isArray(db.requirements)) db.requirements = [];
  if (!Array.isArray(db.commands)) db.commands = [];
  // 老库没有 agents 字段：AgentID 注册表按需补空数组
  if (!Array.isArray(db.agents)) db.agents = [];
  // 老库没有 settings 字段，这里补上，避免设置读写踩 undefined
  if (!db.settings || typeof db.settings !== 'object' || Array.isArray(db.settings)) db.settings = {};
  for (const c of db.commands) {
    if (!Array.isArray(c.runs)) c.runs = [];
  }
  return db;
}

function get() {
  if (!db) load();
  return db;
}

/**
 * 启动自检结果：corrupted 为 true 时本次运行处于「只读空库」模式，
 * 界面顶部据此提示并引导从快照恢复；backupCount 只算可解析的快照。
 */
function dataStatus() {
  // 事件日志是独立文件，诊断按需加载，避免 store ↔ event-log 顶层循环依赖
  let eventLog = null;
  try {
    eventLog = require('./event-log').status();
  } catch (_) {}
  return {
    corrupted: !!corruption,
    message: corruption ? corruption.message : null,
    size: corruption ? corruption.size : null,
    at: corruption ? corruption.at : null,
    file: DB_FILE,
    eventsDir: EVENTS_DIR,
    writable: !writesLocked,
    backupCount: listBackups().filter((b) => b.valid).length,
    eventLog
  };
}

function save() {
  if (!db || writesLocked) return;
  ensureDirs();
  // 备份失败不能影响主数据写入
  try { backupDaily(); } catch (e) {
    process.stderr.write('[store] 每日备份失败：' + e.message + '\n');
  }
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tmp, DB_FILE);
}

function uid(prefix) {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

module.exports = {
  configure,
  load,
  get,
  save,
  uid,
  ensureDirs,
  listBackups,
  restoreBackup,
  dataStatus,
  DATA_DIR,
  RUNS_DIR,
  EVENTS_DIR,
  DB_FILE
};

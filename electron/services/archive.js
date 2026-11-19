'use strict';

const fs = require('fs');
const path = require('path');
const store = require('./store');

/**
 * 需求归档：已完成的需求从 db.json 搬出来，一条一个 JSON 文件，
 * 放在数据目录的 archive/<项目id>/ 下（与 db.json、backups/、runs/ 同级）。
 *
 * 两层命名各管一件事：
 * - 目录按**项目 id**（p_xxx）分：纯 ASCII、全局唯一、项目改名也不会分裂成两个目录。
 *   代价是目录名读不出项目名，所以每个文件里都冗余存了 projects 的名字与路径。
 * - 文件名按任务编号，补一段任务 id：`<编号>-<任务id>.json`。编号只在项目内唯一，
 *   加 id 是为了即使同名项目、或同一编号被复用过，也不会互相顶掉。
 */
const FOLDER = 'archive';
/** v1 把归档平铺在 需求/ 下，启动时迁到新结构（见 migrateLegacy） */
const LEGACY_FOLDER = '需求';

function root() {
  if (!store.DATA_DIR) throw new Error('store 尚未 configure()');
  return path.join(store.DATA_DIR, FOLDER);
}

function legacyRoot() {
  if (!store.DATA_DIR) throw new Error('store 尚未 configure()');
  return path.join(store.DATA_DIR, LEGACY_FOLDER);
}

/**
 * 项目在归档里的目录名：就是项目 id。
 * 不用目录名/项目名，是因为它们要么可能带中文，要么改名后会让同一个项目的归档
 * 散落在两个目录里；id 没有这两个问题，也省掉「重名时加后缀」的分支。
 */
function projectKey(project) {
  const id = String((project && project.id) || '');
  return id || 'unknown';
}

/** 项目的归档目录，按需创建 */
function ensureDir(project) {
  const d = path.join(root(), projectKey(project));
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function fileName(r) {
  const seq = Number(r && r.seq);
  return (Number.isFinite(seq) ? seq : 0) + '-' + String(r.id) + '.json';
}

function parseFile(abs) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch (_) {
    return null;
  }
  if (!data || typeof data !== 'object' || !data.requirement || typeof data.requirement !== 'object') return null;
  return data;
}

/**
 * 写一份归档文件：需求原样保存，另附归档时间与项目名。
 * 目录名只有 id，所以项目名与路径必须冗余存一份——归档后项目可能被改名、
 * 甚至被彻底移除，文件要能自己说清是哪条需求、属于哪个项目。
 * 先写 .tmp 再改名，避免中途崩溃留下半个 JSON。
 */
function write(r, project) {
  const key = projectKey(project);
  const d = path.join(root(), key);
  fs.mkdirSync(d, { recursive: true });
  const name = fileName(r);
  const abs = path.join(d, name);
  const payload = {
    version: 1,
    archivedAt: new Date().toISOString(),
    project: {
      id: (project && project.id) || r.projectId,
      name: (project && project.name) || '',
      path: (project && project.path) || '',
      dir: key
    },
    requirement: r
  };
  const tmp = abs + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
  fs.renameSync(tmp, abs);
  return path.posix.join(key, name);
}

function collect(dir, out) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    const data = parseFile(path.join(dir, name));
    if (!data) {
      process.stderr.write('[archive] 跳过无法解析的归档文件：' + name + '\n');
      continue;
    }
    out.push({
      name,
      dir: path.basename(dir),
      abs: path.join(dir, name),
      archivedAt: data.archivedAt || null,
      project: data.project || null,
      requirement: data.requirement
    });
  }
}

/** 列出全部归档：分项目子目录 + 可能残留的旧扁平文件；坏文件跳过并留一行 stderr */
function list() {
  const out = [];
  const base = root();
  if (fs.existsSync(base)) {
    for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
      if (entry.isDirectory()) collect(path.join(base, entry.name), out);
      else if (entry.isFile() && entry.name.endsWith('.json')) collect(base, out);
    }
  }
  // 迁移没跑或失败时，旧目录里的文件也要算进编号，否则新建需求会复用已归档的编号
  if (fs.existsSync(legacyRoot())) collect(legacyRoot(), out);
  return out;
}

/**
 * 某项目已归档需求的最大编号。
 * 归档把需求从 db.json 里移走了，新建需求只按库里的最大值 +1 会退回已用过的编号，
 * 所以编号分配要把归档文件一起算进来。
 */
function maxSeq(projectId) {
  let max = 0;
  for (const item of list()) {
    const r = item.requirement;
    if (projectId && r.projectId !== projectId) continue;
    const seq = Number(r.seq) || 0;
    if (seq > max) max = seq;
  }
  return max;
}

/** 目录里已有多少份归档（界面/诊断用） */
function count() {
  return list().length;
}

/**
 * 按需求 id 找一份归档。恢复功能用：界面只认需求 id，不必知道文件落在哪个项目目录。
 */
function findEntry(rid) {
  const id = String(rid || '');
  if (!id) return null;
  return list().find((item) => item.requirement.id === id) || null;
}

/** 删除归档文件：记录写回 db.json 之后调用，失败由调用方决定怎么提示 */
function removeEntry(item) {
  fs.unlinkSync(item.abs);
}

/**
 * 把 v1 的扁平结构 需求/<编号>-<id>.json 迁到 archive/<项目>/，启动时跑一次。
 * 幂等：旧目录不存在就直接返回；单个文件迁移失败留在原地，下轮再试 ——
 * 列表与编号计算都还能读到旧目录，迁移期间不漏号也不丢文件。
 */
function migrateLegacy() {
  const legacy = legacyRoot();
  if (!fs.existsSync(legacy)) return { moved: 0, remain: 0 };

  const projects = store.get().projects || [];
  let moved = 0;
  let remain = 0;
  for (const name of fs.readdirSync(legacy)) {
    if (!name.endsWith('.json')) continue;
    const abs = path.join(legacy, name);
    const data = parseFile(abs);
    if (!data) {
      remain += 1;
      continue;
    }
    const pid = (data.project && data.project.id) || data.requirement.projectId;
    // 目录名就是项目 id，所以项目即使已被移除，文件照样能按原 id 归位
    const project = projects.find((x) => x.id === pid) || { id: pid, path: '' };
    try {
      const target = ensureDir(project);
      fs.renameSync(abs, path.join(target, name));
      moved += 1;
    } catch (e) {
      remain += 1;
      process.stderr.write('[archive] 迁移失败（' + name + '）：' + e.message + '\n');
    }
  }
  if (!remain) {
    try {
      fs.rmdirSync(legacy);
    } catch (_) {
      /* 目录里可能还有别的文件：留着不碍事 */
    }
  }
  return { moved, remain };
}

module.exports = { FOLDER, LEGACY_FOLDER, root, projectKey, write, list, maxSeq, count, findEntry, removeEntry, migrateLegacy };

'use strict';

/**
 * 事件日志：每个项目一个 append-only JSONL（data/events/<projectId>.events.jsonl），
 * 无项目上下文的事件写 _system.events.jsonl。启动时全量读入内存，查询走内存索引。
 * 事件与 db.json 完全解耦：恢复备份不碰事件文件。
 */

const fs = require('fs');
const path = require('path');
const store = require('./store');

const SYSTEM = '_system';
const FILE_RE = /^(p_[a-z0-9]+)\.events\.jsonl$/;
const PROJECT_RE = /^p_[a-z0-9]+$/;
const LIMIT_DEFAULT = 50;
const LIMIT_MAX = 200;
const DATA_MAX = 2048;

const TYPES = new Set([
  'project.created', 'project.updated', 'project.archived', 'project.restored', 'project.deleted',
  'requirement.created', 'requirement.updated', 'requirement.claimed', 'requirement.completed',
  'requirement.released', 'requirement.asked', 'requirement.answered', 'requirement.timeout',
  'requirement.unlocked', 'requirement.relocked',
  'requirement.status_changed', 'requirement.deleted', 'requirement.archived',
  'command.created', 'command.updated', 'command.deleted', 'command.started', 'command.exited',
  'command.stopped', 'command.spawn_failed', 'command.detached', 'command.recovered',
  'data.restored', 'settings.changed',
  'git.pulled', 'git.pull_failed'
]);

const byProject = new Map();
let all = [];
let loaded = false;
let lastError = null;
const listeners = new Set();

const actor = {
  user: () => ({ kind: 'user', name: '我' }),
  agent: (name) => ({ kind: 'agent', name: String(name || 'agent') }),
  system: (name) => ({ kind: 'system', name: String(name || 'system') })
};

function eventsDir() {
  if (!store.DATA_DIR) throw new Error('store 尚未 configure()');
  return path.join(store.DATA_DIR, 'events');
}

function fileOf(key) {
  return path.join(eventsDir(), key + '.events.jsonl');
}

function isEventFile(name) {
  return name === SYSTEM + '.events.jsonl' || FILE_RE.test(name);
}

function byTime(a, b) {
  return String(a.at).localeCompare(String(b.at)) || String(a.id).localeCompare(String(b.id));
}

function clip(text, max) {
  const s = String(text == null ? '' : text);
  return s.length > max ? s.slice(0, Math.max(0, max - 1)) + '…' : s;
}

function clipBytes(text, max) {
  const s = String(text == null ? '' : text);
  if (Buffer.byteLength(s, 'utf8') <= max) return s;
  return Buffer.from(s, 'utf8').subarray(0, Math.max(0, max)).toString('utf8').replace(/\uFFFD+$/, '');
}

function setError(e) {
  lastError = { at: new Date().toISOString(), message: e && e.message ? String(e.message) : String(e) };
  console.error('[event-log] ' + lastError.message);
}

function init() {
  if (loaded) return;
  loaded = true;
  byProject.clear();
  all = [];

  let names = [];
  try {
    const dir = eventsDir();
    fs.mkdirSync(dir, { recursive: true });
    names = fs.readdirSync(dir).filter(isEventFile).sort();
  } catch (e) {
    setError(e);
    return;
  }

  let bad = 0;
  for (const name of names) {
    const key = name === SYSTEM + '.events.jsonl' ? SYSTEM : FILE_RE.exec(name)[1];
    const list = byProject.get(key) || [];
    byProject.set(key, list);

    let text;
    try {
      text = fs.readFileSync(path.join(eventsDir(), name), 'utf8');
    } catch (e) {
      setError(e);
      continue;
    }
    for (const line of text.split('\n')) {
      if (!line) continue;
      let ev;
      try {
        ev = JSON.parse(line);
      } catch (_) {
        bad += 1; // 崩溃中断留下的半截行：跳过，不改写文件
        continue;
      }
      if (!ev || typeof ev !== 'object' || !ev.id || !ev.at || !ev.type) {
        bad += 1;
        continue;
      }
      list.push(ev);
      all.push(ev);
    }
  }
  all.sort(byTime);
  if (bad) console.warn('[event-log] 跳过 ' + bad + ' 行无法解析的事件');
}

function normalize(input) {
  const type = String(input.type || '');
  if (!TYPES.has(type)) {
    setError(new Error('未知事件类型：' + (type || '(空)')));
    return null;
  }
  const projectId = input.projectId ? String(input.projectId) : null;
  if (projectId && !PROJECT_RE.test(projectId)) {
    setError(new Error('非法项目 id：' + projectId));
    return null;
  }
  const actor = input.actor && ['user', 'agent', 'system'].includes(input.actor.kind)
    ? { kind: input.actor.kind, name: clip(input.actor.name, 60) }
    : { kind: 'system', name: 'unknown' };
  const data = input.data && typeof input.data === 'object' && !Array.isArray(input.data)
    ? { ...input.data }
    : {};
  if (typeof data.note === 'string') data.note = clip(data.note, 200);
  if (typeof data.message === 'string') data.message = clip(data.message, 200);
  if (typeof data.text === 'string') data.text = clip(data.text, 300);
  return {
    id: store.uid('e'),
    at: input.at ? String(input.at) : new Date().toISOString(),
    type,
    projectId,
    requirementId: input.requirementId ? String(input.requirementId) : null,
    commandId: input.commandId ? String(input.commandId) : null,
    actor,
    data
  };
}

function append(input) {
  init();
  const ev = normalize(input || {});
  if (!ev) return null;

  // ponytail: 单条 data 超 2KB 就存 512B 预览；JSON 转义最坏约翻倍，仍低于 2KB
  let text;
  try {
    text = JSON.stringify(ev.data);
  } catch (_) {
    text = '{}';
    ev.data = {};
  }
  if (Buffer.byteLength(text, 'utf8') > DATA_MAX) {
    ev.data = { truncated: true, preview: clipBytes(text, 512) };
    if (Buffer.byteLength(JSON.stringify(ev.data), 'utf8') > DATA_MAX) ev.data = { truncated: true };
  }

  const key = ev.projectId || SYSTEM;
  const file = fileOf(key);
  let prefix = '';
  try {
    const size = fs.statSync(file).size;
    if (size > 0) {
      const fd = fs.openSync(file, 'r');
      const last = Buffer.alloc(1);
      fs.readSync(fd, last, 0, 1, size - 1);
      fs.closeSync(fd);
      if (last[0] !== 0x0a) prefix = '\n'; // 上次崩溃留下的半截行：先补换行，避免新事件拼成坏行
    }
  } catch (_) {
    /* 文件还不存在 */
  }

  try {
    fs.appendFileSync(file, prefix + JSON.stringify(ev) + '\n', 'utf8');
  } catch (e) {
    setError(e);
    return null;
  }

  if (!byProject.has(key)) byProject.set(key, []);
  byProject.get(key).push(ev);
  all.push(ev);
  if (all.length > 1 && byTime(all[all.length - 2], ev) > 0) all.sort(byTime);

  for (const fn of listeners) {
    try {
      fn(ev);
    } catch (e) {
      console.error('[event-log] listener failed: ' + e.message);
    }
  }
  return ev;
}

function query(params) {
  init();
  const q = params || {};
  const limit = Math.min(Math.max(parseInt(q.limit, 10) || LIMIT_DEFAULT, 1), LIMIT_MAX);
  const key = q.projectId ? String(q.projectId) : '';
  if (key && key !== SYSTEM && !PROJECT_RE.test(key)) {
    return { events: [], hasMore: false, nextBefore: null };
  }

  let list = key ? byProject.get(key) || [] : all;
  let existing = null;
  if (q.deletedOnly) {
    existing = new Set(store.get().projects.map((p) => p.id));
  }

  const category = q.category ? String(q.category) : '';
  const type = q.type ? String(q.type) : '';
  const actorKind = q.actorKind ? String(q.actorKind) : '';
  const from = q.from ? String(q.from) : '';
  const to = q.to ? String(q.to) : '';
  const rid = q.requirementId ? String(q.requirementId) : '';

  list = list.filter((ev) => {
    if (rid && ev.requirementId !== rid) return false;
    if (category && !String(ev.type).startsWith(category + '.')) return false;
    if (type && ev.type !== type) return false;
    if (actorKind && (!ev.actor || ev.actor.kind !== actorKind)) return false;
    if (from && ev.at < from) return false;
    if (to && ev.at > to) return false;
    if (q.deletedOnly && (!ev.projectId || !existing || existing.has(ev.projectId))) return false;
    return true;
  });

  let end = list.length;
  if (q.before) {
    const idx = list.findIndex((ev) => ev.id === String(q.before));
    if (idx < 0) return { events: [], hasMore: false, nextBefore: null };
    end = idx;
  }
  const start = Math.max(0, end - limit);
  const page = list.slice(start, end);
  return {
    events: page.slice().reverse(),
    hasMore: start > 0,
    nextBefore: page.length ? page[0].id : null
  };
}

function timeline(rid, params) {
  return query({ ...(params || {}), requirementId: String(rid) });
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function status() {
  return { dir: store.DATA_DIR ? eventsDir() : null, loaded, events: all.length, lastError };
}

module.exports = { init, append, query, timeline, subscribe, status, actor, SYSTEM, TYPES };

'use strict';

/**
 * 关键事件系统通知：待审核交付、命令异常退出/启动失败、AI 新增需求。
 * 事件来自 event-log；Notification 只在 Electron 主进程可用，纯函数部分可在 node 下测。
 */

const store = require('./store');
const eventLog = require('./event-log');
const { readSettings } = require('./domain/settings');

const AI_WINDOW_MS = 60 * 1000;
const COMMAND_COOLDOWN_MS = 5 * 60 * 1000;
const NOTIFICATION_TTL_MS = 5 * 60 * 1000;

let navigateTo = null;
let started = false;
let unsubscribe = null;
let aiTimer = null;
let aiBuffer = [];
const commandLast = new Map();
const live = new Set();

function clip(text, max) {
  const s = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function projectActive(projectId) {
  if (!projectId) return true;
  const p = store.get().projects.find((x) => x.id === projectId);
  return !!p && !p.archived;
}

function shouldNotify(ev, settings) {
  const s = settings || readSettings(store.get());
  if (!s.enabled || !ev || !projectActive(ev.projectId)) return false;
  if (ev.type === 'requirement.completed') return !!s.reviewReady;
  if (ev.type === 'command.spawn_failed') return !!s.commandFailed;
  if (ev.type === 'command.exited') {
    const d = ev.data || {};
    return !!s.commandFailed && (d.status === 'failed' || (typeof d.exitCode === 'number' && d.exitCode !== 0));
  }
  if (ev.type === 'requirement.created') {
    return !!s.aiRequirement && !!(ev.data && ev.data.source === 'ai');
  }
  return false;
}

function bodyFor(ev) {
  const d = (ev && ev.data) || {};
  const proj = d.projectName || '';
  const join = (parts) => parts.filter(Boolean).join(' · ');
  const seq = d.seq === undefined || d.seq === null ? '?' : d.seq;
  if (ev.type === 'requirement.completed') {
    return { title: '需求 #' + seq + ' 等待验收', body: join([proj, d.agent || '', clip(d.note, 80)]) };
  }
  if (ev.type === 'requirement.created') {
    return { title: 'AI 新增需求', body: join([proj, '#' + seq + (d.title ? ' ' + d.title : '')]) };
  }
  if (ev.type === 'command.spawn_failed') {
    return { title: '命令启动失败', body: join([proj, d.name || d.text || '', clip(d.message, 80)]) };
  }
  if (ev.type === 'command.exited') {
    const code = d.exitCode === undefined || d.exitCode === null ? '?' : d.exitCode;
    return { title: '命令异常退出', body: join([proj, d.name || d.text || '', 'exit ' + code]) };
  }
  return null;
}

function targetOf(ev) {
  if (!ev) return null;
  if (ev.type === 'requirement.completed' || ev.type === 'requirement.created') {
    return { page: 'req', projectId: ev.projectId, requirementId: ev.requirementId };
  }
  if (ev.type === 'command.exited' || ev.type === 'command.spawn_failed') {
    return {
      page: 'launch',
      projectId: ev.projectId,
      commandId: ev.commandId,
      runId: (ev.data && ev.data.runId) || null
    };
  }
  return null;
}

function supported() {
  try {
    const { Notification } = require('electron');
    return !!Notification && Notification.isSupported();
  } catch (_) {
    return false;
  }
}

function show(title, body, target) {
  if (!title || !supported()) return;
  let n;
  try {
    const { Notification } = require('electron');
    n = new Notification({ title, body });
  } catch (e) {
    console.error('[notify] 创建通知失败：' + e.message);
    return;
  }
  live.add(n);
  const done = () => live.delete(n);
  n.on('click', () => {
    done();
    if (navigateTo && target) navigateTo(target);
  });
  n.on('close', done);
  try {
    n.show();
  } catch (e) {
    done();
    console.error('[notify] 显示通知失败：' + e.message);
  }
  const t = setTimeout(done, NOTIFICATION_TTL_MS);
  if (t.unref) t.unref();
}

function flushAI() {
  aiTimer = null;
  const list = aiBuffer;
  aiBuffer = [];
  if (!list.length) return;
  const s = readSettings(store.get());
  if (!s.enabled || !s.aiRequirement) return;
  if (list.length === 1) {
    const b = bodyFor(list[0]);
    if (b) show(b.title, b.body, targetOf(list[0]));
    return;
  }
  const names = [...new Set(list.map((e) => (e.data && e.data.projectName) || '').filter(Boolean))];
  const latest = list[list.length - 1];
  show('AI 新增 ' + list.length + ' 条需求', names.join('、') || '多个项目有新的 AI 需求', targetOf(latest));
}

function onEvent(ev) {
  if (!shouldNotify(ev)) return;
  if (ev.type === 'requirement.created') {
    aiBuffer.push(ev);
    if (!aiTimer) aiTimer = setTimeout(flushAI, AI_WINDOW_MS);
    return;
  }
  if (ev.type === 'command.exited' || ev.type === 'command.spawn_failed') {
    const now = Date.now();
    const last = commandLast.get(ev.commandId) || 0;
    if (now - last < COMMAND_COOLDOWN_MS) return;
    commandLast.set(ev.commandId, now);
  }
  const b = bodyFor(ev);
  if (b) show(b.title, b.body, targetOf(ev));
}

function start(opts) {
  if (started) return;
  started = true;
  navigateTo = (opts && opts.navigateTo) || null;
  unsubscribe = eventLog.subscribe(onEvent);
}

function stop() {
  if (unsubscribe) unsubscribe();
  unsubscribe = null;
  started = false;
  if (aiTimer) clearTimeout(aiTimer);
  aiTimer = null;
  aiBuffer = [];
  commandLast.clear();
  live.clear();
}

module.exports = {
  start,
  stop,
  shouldNotify,
  bodyFor,
  targetOf,
  AI_WINDOW_MS,
  COMMAND_COOLDOWN_MS
};

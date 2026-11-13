'use strict';

/**
 * 崩溃留痕 + 诊断包导出。
 *
 * 定位是「没有服务端也要留下现场」：
 * - 主进程异常（uncaughtException / unhandledRejection）、渲染进程崩溃（render-process-gone）、
 *   子进程崩溃（child-process-gone，含 GPU）、渲染端 ErrorBoundary 捕获的异常，各记一条 JSON，
 *   写到 <数据目录>/crash/，最多留 MAX_KEEP 条（新的在前，老的删掉）。
 * - Electron 自己的转储收到 <数据目录>/crash/dumps（app.setPath('crashDumps')）。
 *   setPath 必须在 ready 之前，所以 init 在 startGui 最外层、store.configure 之前调用。
 * - uploadToServer 固定 false：不在没告知用户的前提下把任何东西发出去。要联网上报时换
 *   crashReporter 的 submitURL，而不是先偷偷开着再解释。
 * - 「导出诊断包」把版本 / 平台 / 崩溃记录 / 事件尾巴打成一个 JSON，交给用户自己发出来。
 *   这是当前阶段唯一诚实的反馈通道，也是后面接上报端点时同一份数据结构。
 *
 * 已知噪音：这台机器 GPU 进程会周期性崩，child-process-gone 会占掉配额。所以保留条数按 kind
 * 分桶而不是全局 FIFO —— 真崩溃不会被 GPU 日志挤掉。
 */

const fs = require('fs');
const path = require('path');
const { app, crashReporter, dialog, shell } = require('electron');

const MAX_KEEP = 20;

let dir = null;
let collector = null;

function ensureDir() {
  if (!dir) throw new Error('crash 服务尚未 init');
  fs.mkdirSync(dir, { recursive: true });
}

/** 文件名里的时间戳不能用冒号（Windows 非法）：2026-10-30T07-25-11 */
function stamp(d) {
  return (d || new Date()).toISOString().replace(/[:.]/g, '-');
}

function messageOf(err) {
  if (!err) return '';
  if (typeof err === 'string') return err;
  return String(err.message || err.reason || err);
}

function stackOf(err) {
  if (!err) return '';
  if (typeof err === 'string') return '';
  return String(err.stack || '');
}

function appInfo() {
  let mem = null;
  try {
    mem = Math.round(process.memoryUsage().rss / 1048576);
  } catch (_) {}
  return {
    name: app.getName(),
    version: app.getVersion(),
    packaged: app.isPackaged,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    locale: (() => {
      try {
        return app.getLocale();
      } catch (_) {
        return null;
      }
    })(),
    rssMb: mem,
    startedAt: new Date(Date.now() - Math.round(process.uptime() * 1000)).toISOString()
  };
}

/** 按 kind 分桶剪枝：同类只留最新的若干条，避免 GPU 噪音把真崩溃挤掉 */
function prune() {
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith('.json'));
  } catch (_) {
    return;
  }
  const STAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-/;
  const buckets = new Map();
  for (const n of names.sort()) {
    // 文件名 = stamp() + '-' + kind + '.json'，时间戳定长 24 字符，剥掉前缀才是分桶键
    const kind = n.replace(STAMP_RE, '').replace(/\.json$/, '');
    if (!buckets.has(kind)) buckets.set(kind, []);
    buckets.get(kind).push(n);
  }
  for (const list of buckets.values()) {
    for (const n of list.slice(0, Math.max(0, list.length - MAX_KEEP))) {
      try {
        fs.unlinkSync(path.join(dir, n));
      } catch (_) {}
    }
  }
}

/**
 * 记一条崩溃。同步写：崩溃路径要尽量短，异步可能在进程死掉前来不及落盘。
 * err 可以是 Error，也可以直接是字符串（render-process-gone 只给 reason）。
 */
function record(kind, err, extra) {
  try {
    ensureDir();
    const info = appInfo();
    const payload = {
      at: new Date().toISOString(),
      kind: String(kind || 'unknown'),
      message: messageOf(err),
      stack: stackOf(err),
      app: info.version,
      packaged: info.packaged,
      electron: info.electron,
      platform: info.platform,
      arch: info.arch,
      pid: process.pid,
      rssMb: info.rssMb,
      ...(extra && typeof extra === 'object' ? extra : {})
    };
    const name = stamp() + '-' + String(kind || 'unknown').replace(/[^\w-]+/g, '_') + '.json';
    fs.writeFileSync(path.join(dir, name), JSON.stringify(payload, null, 2), 'utf8');
    prune();
  } catch (_) {
    // 崩溃记录自身失败绝不能再抛：那会把一次异常放大成死循环
  }
  return null;
}

function list() {
  if (!dir) return [];
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith('.json'));
  } catch (_) {
    return [];
  }
  return names
    .sort()
    .reverse()
    .map((n) => {
      const file = path.join(dir, n);
      let data = null;
      try {
        data = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch (_) {}
      if (!data) return null;
      return {
        file,
        at: data.at || null,
        kind: data.kind || 'unknown',
        message: String(data.message || '').slice(0, 300),
        app: data.app || null
      };
    })
    .filter(Boolean);
}

function dumps() {
  const d = path.join(dir || '', 'dumps');
  try {
    return fs.readdirSync(d).filter((n) => /\.(dmp|json)$/i.test(n));
  } catch (_) {
    return [];
  }
}

/** 诊断包：能回答「哪台机器、哪个版本、崩在哪」，其余一概不带（不含项目内容与需求正文） */
async function exportPack(opts) {
  const o = opts || {};
  ensureDir();
  let extra = null;
  if (typeof collector === 'function') {
    try {
      extra = await collector();
    } catch (e) {
      extra = { error: messageOf(e) };
    }
  }
  const pack = {
    exportedAt: new Date().toISOString(),
    app: appInfo(),
    crashes: list().map((c) => {
      try {
        return JSON.parse(fs.readFileSync(c.file, 'utf8'));
      } catch (_) {
        return c;
      }
    }),
    dumps: dumps(),
    runtime: extra
  };

  const win = o.win && !o.win.isDestroyed() ? o.win : undefined;
  const opts2 = {
    title: '导出诊断包',
    defaultPath: path.join(app.getPath('downloads'), 'project-manager-diag-' + stamp() + '.json'),
    filters: [{ name: 'JSON', extensions: ['json'] }]
  };
  const res = win ? await dialog.showSaveDialog(win, opts2) : await dialog.showSaveDialog(opts2);
  if (res.canceled || !res.filePath) return { ok: false, canceled: true };
  fs.writeFileSync(res.filePath, JSON.stringify(pack, null, 2), 'utf8');
  try {
    shell.showItemInFolder(res.filePath);
  } catch (_) {}
  return { ok: true, path: res.filePath };
}

/**
 * opts.dataDir：崩溃记录落点（与 db.json 同级，恢复备份不会动它）
 * opts.collect：导出诊断包时补充运行时信息（项目数、需求数等计数，由 main 注入，
 *               避免这里反向依赖领域层）
 */
function init(opts) {
  const o = opts || {};
  dir = path.join(o.dataDir, 'crash');
  collector = typeof o.collect === 'function' ? o.collect : null;

  try {
    fs.mkdirSync(path.join(dir, 'dumps'), { recursive: true });
    // 必须早于 ready：转储目录一旦定下，运行时再改 Electron 不会跟着挪
    app.setPath('crashDumps', path.join(dir, 'dumps'));
    crashReporter.start({ uploadToServer: false, compress: false, productName: 'ProjectConsole' });
  } catch (e) {
    console.error('[crash] 转储初始化失败：' + messageOf(e));
  }

  process.on('uncaughtException', (e) => {
    record('uncaughtException', e);
    console.error('[crash] 未捕获异常：' + messageOf(e));
  });
  process.on('unhandledRejection', (r) => {
    record('unhandledRejection', r);
    console.error('[crash] 未处理的 Promise 拒绝：' + messageOf(r));
  });
  app.on('render-process-gone', (_e, _wc, details) => {
    const d = details || {};
    record('render-process-gone', d.reason || 'unknown', { exitCode: d.exitCode });
  });
  app.on('child-process-gone', (_e, details) => {
    const d = details || {};
    record('child-process-gone', d.reason || 'unknown', { type: d.type, exitCode: d.exitCode });
  });
}

module.exports = { init, record, list, exportPack, appInfo };

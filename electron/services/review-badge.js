'use strict';

/**
 * 托盘待审核角标：只统计非归档项目的 review 需求。
 * Windows 用托盘图标变体 + tooltip + 任务栏 overlay；macOS 用 Dock badge + tray title；
 * Linux 走 app.setBadgeCount（支持的桌面环境）+ tooltip。
 */

const path = require('path');
const store = require('./store');

const TRAY_SIZES = [16, 20, 24, 28, 32, 36, 40, 48];
const MAX_SHOWN = 9;

function summary() {
  const db = store.get();
  const active = db.projects.filter((p) => !p.archived);
  const ids = new Set(active.map((p) => p.id));
  const rows = new Map();

  for (const r of db.requirements) {
    if (r.status !== 'review' || !ids.has(r.projectId)) continue;
    let row = rows.get(r.projectId);
    if (!row) {
      const p = active.find((x) => x.id === r.projectId);
      row = {
        projectId: r.projectId,
        name: p ? p.name : '',
        count: 0,
        seq: -1,
        requirementId: r.id,
        title: r.title
      };
      rows.set(r.projectId, row);
    }
    row.count += 1;
    if ((r.seq || 0) > row.seq) {
      row.seq = r.seq || 0;
      row.requirementId = r.id;
      row.title = r.title;
    }
  }

  const projects = [...rows.values()].sort(
    (a, b) => b.count - a.count || String(a.name).localeCompare(String(b.name))
  );
  return { count: projects.reduce((n, p) => n + p.count, 0), projects };
}

function chooseSize(scale) {
  const want = 16 * (scale || 1);
  let best = TRAY_SIZES[0];
  for (const size of TRAY_SIZES) {
    if (Math.abs(size - want) < Math.abs(best - want)) best = size;
  }
  return best;
}

function image(name) {
  try {
    const { nativeImage } = require('electron');
    const img = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', name));
    return img && !img.isEmpty() ? img : null;
  } catch (_) {
    return null;
  }
}

function label(count) {
  return count > MAX_SHOWN ? '9plus' : String(count);
}

function trayIcon(size, count) {
  if (count) {
    const variant = image('tray/review/' + label(count) + '-' + size + '.png');
    if (variant) return variant;
  }
  const base = image('tray/tray-' + size + '.png');
  if (base) return base;
  throw new Error('托盘图标资源缺失：electron/assets/tray/tray-*.png（npm run icons:tray 重新生成）');
}

function overlayIcon(count, scale) {
  if (!count) return null;
  const size = (scale || 1) >= 1.5 ? 32 : 16;
  return image('overlay/review/' + label(count) + '-' + size + '.png');
}

function update({ app, tray, win, scale, setMenu }) {
  const data = summary();
  const count = data.count;
  const size = chooseSize(scale);

  try {
    tray.setImage(trayIcon(size, count));
  } catch (e) {
    console.error('[badge] ' + e.message);
  }
  tray.setToolTip(count ? '项目管理台 · ' + count + ' 条待审核' : '项目管理台');

  if (process.platform === 'darwin') {
    try { tray.setTitle(count ? String(count) : ''); } catch (_) {}
  }
  if (process.platform !== 'win32') {
    try { app.setBadgeCount(count); } catch (_) {}
  }
  if (process.platform === 'win32' && win && !win.isDestroyed()) {
    const overlay = overlayIcon(count, scale);
    try { win.setOverlayIcon(overlay, count ? count + ' 条待审核' : ''); } catch (_) {}
  }

  if (setMenu) {
    try {
      setMenu(data);
    } catch (e) {
      console.error('[badge] 菜单更新失败：' + e.message);
    }
  }
  return data;
}

module.exports = { summary, chooseSize, trayIcon, overlayIcon, update, MAX_SHOWN };

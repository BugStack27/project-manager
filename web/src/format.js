/* 纯格式化函数与派生计算：无 React 依赖，可被任何模块直接引用。 */
import { PROJECT_COLORS } from './constants.js';
import { projectColorMap } from './lib/project-color.js';

const pad = (n) => String(n).padStart(2, '0');

export function fmtClock(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return pad(d.getHours()) + ':' + pad(d.getMinutes());
}

export function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

export function fmtDuration(startIso, endIso) {
  if (!startIso) return '—';
  const start = new Date(startIso).getTime();
  const end = endIso ? new Date(endIso).getTime() : Date.now();
  const ms = Math.max(0, end - start);
  if (ms < 60000) return Math.max(1, Math.round(ms / 1000)) + 's';
  const min = Math.floor(ms / 60000);
  if (min < 60) return min + 'm';
  const h = Math.floor(min / 60);
  return h + 'h ' + (min % 60) + 'm';
}

const MIN_MS = 60000;
const HOUR_MS = 60 * MIN_MS;
const DAY_MS = 24 * HOUR_MS;
/** 相对时间只覆盖一周内；再早的日期用「几天前」没有信息量，交给 fmtDateTime */
const AGO_LIMIT_MS = 7 * DAY_MS;

/**
 * 一周内的相对时间：刚刚 / N 分钟前 / N 小时前 / N 天前。
 * 超出 7 天返回 null，由调用方换回日期 —— 这里不返回「8 天前」，
 * 是因为「哪天启动的」比「8 天前」更有用。
 * 时钟偏差导致的未来时间按「刚刚」处理，不显示负数。
 */
export function fmtAgo(iso, now) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const ms = Math.max(0, (now === undefined ? Date.now() : now) - t);
  if (ms >= AGO_LIMIT_MS) return null;
  if (ms < MIN_MS) return '刚刚';
  const min = Math.floor(ms / MIN_MS);
  if (min < 60) return min + '分钟前';
  const h = Math.floor(ms / HOUR_MS);
  if (h < 24) return h + '小时前';
  return Math.floor(ms / DAY_MS) + '天前';
}

/** 命令是否仍在跑：本应用托管中，或分离出去但宿主进程还活着（不能停止，但确实在跑） */
export function isCommandActive(c) {
  if (!c) return false;
  if (c.status === 'running') return true;
  const last = c.lastRun;
  return !!(last && last.status === 'detached' && last.alive);
}

export function runExitLabel(run) {
  if (!run) return '未运行';
  if (run.status === 'running') return '运行中';
  if (run.status === 'stopped') return '已手动停止';
  if (run.status === 'interrupted') return '服务重启中断';
  if (run.status === 'detached') return run.alive ? '已分离 · 仍在运行' : '已分离 · 已退出';
  if (run.status === 'failed') return 'exit ' + (run.exitCode === null ? '?' : run.exitCode);
  return 'exit ' + (run.exitCode === null ? 0 : run.exitCode);
}

export function initials(name) {
  const s = String(name || '?').trim();
  return s ? s[0].toUpperCase() : '?';
}

/** 项目头像色：按 id 稳定分配（色板见 constants 的 PROJECT_COLORS），与列表顺序无关 */
export function avatarColor(projects, id) {
  return projectColorMap(projects).get(id) || PROJECT_COLORS[0];
}

/**
 * 头像上的文字色：深色底白字、浅色底深字。
 * 色板第 13 个起是浅色圈，固定白字在那儿对比度不足 2:1，字母会糊成一片。
 * 判据是 sRGB 加权亮度（阈值 0.62）：现有 12 个中深色全部落在白字一侧。
 * 深字取 `--label` 的值，因为这里返回的是内联样式值，用不了 CSS 变量。
 */
export function avatarInk(bg) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(bg || ''));
  if (!m) return '#FFFFFF';
  const n = parseInt(m[1], 16);
  const lum = (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
  return lum > 0.62 ? '#1D1D1F' : '#FFFFFF';
}

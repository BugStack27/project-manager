/**
 * 主题偏好：三态（跟随系统 / 浅色 / 深色）与解析规则。
 *
 * 纯函数、不依赖 DOM 与 React —— 便于用 node 直接执行冒烟，也便于 index.html 那份内联脚本
 * 与本模块保持同一套判断口径（内联脚本无法 import，键名与三态字符串在那边手写了一遍，
 * 两边注释互相指向；改动时必须同步）。
 */

/** localStorage 键。与 layout.js 的 pm.ui.layout、shortcuts.js 的 pm.ui.shortcuts 同族。 */
export const THEME_KEY = 'pm.ui.theme';

/** 三态，顺序即界面上的排列顺序 */
export const THEMES = ['system', 'light', 'dark'];

/** 菜单里显示的名称 */
export const THEME_LABELS = { system: '跟随系统', light: '浅色', dark: '深色' };

/** 非法值一律回落「跟随系统」，不抛错 */
export function normalizePref(v) {
  return THEMES.includes(v) ? v : 'system';
}

/** 读偏好；隐私模式等访问失败时静默回落默认值，不影响本次使用 */
export function readPref() {
  try {
    return normalizePref(window.localStorage.getItem(THEME_KEY));
  } catch {
    return 'system';
  }
}

/** 写偏好；写失败（配额、隐私模式）静默忽略 */
export function writePref(pref) {
  try {
    window.localStorage.setItem(THEME_KEY, normalizePref(pref));
  } catch {
    /* 忽略 */
  }
}

/** 偏好 + 系统当前是否深色 → 实际生效的主题（'light' | 'dark'） */
export function resolveApplied(pref, systemDark) {
  if (pref === 'light' || pref === 'dark') return pref;
  return systemDark ? 'dark' : 'light';
}

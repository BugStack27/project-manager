/**
 * 浅色皮肤偏好：清透 / 暖纸 / 活力（默认活力）。
 *
 * 皮肤只作用于浅色模式（样式见 styles/skins.css，选择器带 [data-theme="light"]）；
 * 深色模式有自己的一套取值，不受皮肤影响。
 *
 * 纯函数、不依赖 DOM 与 React —— 与 lib/theme.js 同族。index.html 的内联首帧脚本
 * 无法 import，键名 / 取值 / 默认值在那边手写了一遍，改动时必须同步两边。
 */

/** localStorage 键。与 pm.ui.theme / pm.ui.layout / pm.ui.shortcuts 同族。 */
export const SKIN_KEY = 'pm.ui.skin';

/** 三套皮肤，顺序即界面上的排列顺序 */
export const SKINS = ['crisp', 'warm', 'vivid'];

/** 菜单里显示的名称 */
export const SKIN_LABELS = { crisp: '清透', warm: '暖纸', vivid: '活力' };

/** 各皮肤浅色主底色：通知主进程设窗口底色与 Windows 标题栏覆盖色用（与 skins.css 的 --bg 一致） */
export const SKIN_BG = { crisp: '#EDF0F4', warm: '#F4F1EA', vivid: '#FFFFFF' };

/** 默认皮肤：活力（去灰、对比最强） */
export const DEFAULT_SKIN = 'vivid';

/** 非法值一律回落默认，不抛错 */
export function normalizeSkin(v) {
  return SKINS.includes(v) ? v : DEFAULT_SKIN;
}

/** 读偏好；隐私模式等访问失败时静默回落默认值 */
export function readSkin() {
  try {
    return normalizeSkin(window.localStorage.getItem(SKIN_KEY));
  } catch {
    return DEFAULT_SKIN;
  }
}

/** 写偏好；写失败（配额、隐私模式）静默忽略 */
export function writeSkin(pref) {
  try {
    window.localStorage.setItem(SKIN_KEY, normalizeSkin(pref));
  } catch {
    /* 忽略 */
  }
}
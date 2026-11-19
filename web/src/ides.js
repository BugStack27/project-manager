import { api } from './api.js';

/**
 * IDE 列表的进程内缓存。
 * ContextBar 在需求中心 / 启动台 / 修改记录三个页面各渲染一次，
 * 用模块级 Promise 记忆化，三个页面共享同一次扫描，不会各扫一遍盘。
 */

let data = null;
let pending = null;

/**
 * 本轮会话里各项目最新选过的 IDE。
 * 落库后项目列表要等下一次轮询才刷新，先记在内存里，避免切走再切回来时闪回旧值。
 */
const chosenByProject = new Map();

/**
 * 取 IDE 列表（含全局上次使用的 ideId）。
 * @param {boolean} refresh 强制重新扫描（装机列表可能变了）
 */
export function loadIdes(refresh) {
  if (refresh) {
    data = null;
    pending = null;
  }
  if (data) return Promise.resolve(data);
  if (!pending) {
    pending = api
      .ides(refresh)
      .then((res) => {
        data = res;
        pending = null;
        return res;
      })
      .catch((e) => {
        pending = null;
        throw e;
      });
  }
  return pending;
}

/** 菜单里切换成功后调用：只记项目偏好，不把「没打开的 IDE」算成全局上次使用 */
export function rememberProjectIde(projectId, ideId) {
  if (projectId && ideId) chosenByProject.set(projectId, ideId);
}

/** 打开成功后调用：项目偏好与全局上次使用都变了 */
export function rememberOpenedIde(projectId, ideId) {
  rememberProjectIde(projectId, ideId);
  if (data) data = { ...data, lastIdeId: ideId };
}

/**
 * 项目该用哪个 IDE：内存里的最新选择 → 已落库的项目偏好 → 全局上次使用。
 * 返回值可能不在当前安装列表里，调用方再按列表兜底。
 */
export function preferredIde(projectId, savedIdeId, lastIdeId) {
  return (projectId && chosenByProject.get(projectId)) || savedIdeId || lastIdeId || null;
}

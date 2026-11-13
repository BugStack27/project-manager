import { api } from './api.js';

/**
 * IDE 列表的进程内缓存。
 * ContextBar 在需求中心 / 启动台 / 修改记录三个页面各渲染一次，
 * 用模块级 Promise 记忆化，三个页面共享同一次扫描，不会各扫一遍盘。
 */

let data = null;
let pending = null;

/**
 * 取 IDE 列表（含上次使用的 ideId）。
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

/** 打开成功后同步本地缓存里的「上次使用」，避免下次进页面又跳回旧值 */
export function rememberIde(ideId) {
  if (data) data = { ...data, lastIdeId: ideId };
}

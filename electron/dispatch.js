'use strict';

/**
 * 统一方法分发（不依赖 electron）：IPC 与控制管道共用。
 * 失败序列化为 { ok:false, status, code, message }，渲染端再还原成带 status 的 Error。
 */
function createDispatcher(domain) {
  return async function dispatch(method, params) {
    const fn = domain[method];
    if (typeof fn !== 'function') {
      return { ok: false, status: 404, code: 'unknown_method', message: '未知方法：' + method };
    }
    try {
      const data = await fn(params || {});
      return { ok: true, data };
    } catch (e) {
      const status = e && e.status ? e.status : 500;
      if (status >= 500) console.error('[domain]', method, e);
      return {
        ok: false,
        status,
        code: (e && e.code) || 'internal_error',
        message: (e && e.message) || '内部错误',
        ...(e && e.claim ? { claim: e.claim } : {})
      };
    }
  };
}

module.exports = { createDispatcher };

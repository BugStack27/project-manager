import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';

/**
 * 版本号、自动更新状态与诊断包导出。
 * 更新状态只认主进程推送（pm:update），界面不自己推断「已下载」这类中间态。
 */
export function useUpdater({ notify }) {
  /** 版本号只读一次 */
  const [version, setVersion] = useState('');
  const [update, setUpdate] = useState({ phase: 'idle' });

  // 一次拉取版本与当前更新状态，之后只吃主进程推送
  useEffect(() => {
    api
      .appInfo()
      .then((d) => setVersion((d && d.version) || ''))
      .catch(() => {});
    if (window.pm && window.pm.updater) {
      window.pm.updater
        .state()
        .then((s) => s && s.phase && setUpdate(s))
        .catch(() => {});
    }
    const off = window.pm && window.pm.onUpdate ? window.pm.onUpdate(setUpdate) : null;
    return () => {
      if (typeof off === 'function') off();
    };
  }, []);

  /** 一次更新动作（check / download / install）：结果即最新状态，直接替换本地副本 */
  const runUpdateAction = useCallback(async (action) => {
    if (!window.pm || !window.pm.updater) throw new Error('更新通道不可用');
    const res = await window.pm.updater[action]();
    if (res && res.phase) setUpdate(res);
    else if (res && res.state) setUpdate(res.state);
    if (res && res.ok === false) throw new Error('当前状态不能执行该操作');
  }, []);

  /** 导出诊断包：版本 / 平台 / 崩溃记录，用户自己发出来 */
  const exportDiagnostics = useCallback(async () => {
    try {
      if (!window.pm || !window.pm.crash) throw new Error('诊断通道不可用');
      const res = await window.pm.crash.export();
      if (res && res.ok) notify('诊断包已导出');
    } catch (e) {
      notify('导出失败：' + ((e && e.message) || ''), 'warn');
    }
  }, [notify]);

  return { version, update, runUpdateAction, exportDiagnostics };
}

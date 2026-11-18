import { useEffect, useState } from 'react';
import { api } from '../api.js';

/** 通道状态在主进程每 5 秒推进一次，页面这里取一个更省的值 */
const POLL_MS = 10000;

/**
 * 手机端通信是否需要用户介入（频道在当前网关上已不存在）。
 * 只读状态、不触发联网；打开弹窗才能看到的问题等于没提示，所以顶部提示条自己巡检。
 */
export function useMobileAlert() {
  const [repair, setRepair] = useState(null);

  useEffect(() => {
    let alive = true;
    let timer = null;

    const load = async () => {
      try {
        const info = await api.mobileAlert();
        if (!alive) return;
        setRepair(info && info.needsRepair ? { message: info.message || '' } : null);
      } catch (_) {
        /* 读不到就保持上一次的结论，不因为一次 IPC 失败把提示撤掉 */
      }
      if (alive) timer = setTimeout(load, POLL_MS);
    };

    load();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, []);

  return repair;
}

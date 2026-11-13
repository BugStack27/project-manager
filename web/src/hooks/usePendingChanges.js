import { useEffect, useState } from 'react';
import { api } from '../api.js';

/**
 * 待提交改动的文件数：验收时据此决定要不要提供「提交并推送」选项。
 * 只在 enabled 时请求；不是仓库 / 取不到（git 不可用、路径失效）都按 0 处理，界面不出现该选项。
 */
export function usePendingChanges(projectId, enabled) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!enabled || !projectId) {
      setCount(0);
      return undefined;
    }
    let alive = true;
    api
      .gitChanges(projectId)
      .then((res) => {
        if (!alive) return;
        setCount(res && res.isRepo === false ? 0 : (res && res.counts && res.counts.total) || 0);
      })
      .catch(() => {
        if (alive) setCount(0);
      });
    return () => {
      alive = false;
    };
  }, [projectId, enabled]);

  return count;
}

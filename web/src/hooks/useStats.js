import { useCallback, useRef, useState } from 'react';
import { api } from '../api.js';
import { statsWindow } from '../lib/stats-view.js';

/**
 * 统计页数据：跨项目聚合，一次取回覆盖三档范围的数据，切换范围只在前端切片。
 * 进入页面时由外部按「无缓存才加载」触发；项目集合变化后调用 invalidateStats 清空缓存。
 */
export function useStats({ notify }) {
  const [stats, setStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsRefreshing, setStatsRefreshing] = useState(false);
  const [statsError, setStatsError] = useState(null);
  /** 请求进行中标记：刷新按钮连点、进页自动加载撞车时只留一次请求 */
  const statsBusy = useRef(false);

  /**
   * background=true 时保留旧数据，只让刷新按钮转圈。
   */
  const loadStats = useCallback(
    async (background) => {
      if (statsBusy.current) return;
      statsBusy.current = true;
      if (background) setStatsRefreshing(true);
      else setStatsLoading(true);
      setStatsError(null);
      try {
        const { since, until } = statsWindow();
        setStats(await api.gitActivity(since, until));
      } catch (e) {
        setStatsError(e.message || '统计失败');
        if (background) notify(e.message || '统计失败', 'warn');
      } finally {
        statsBusy.current = false;
        setStatsLoading(false);
        setStatsRefreshing(false);
      }
    },
    [notify]
  );

  /** 统计缓存失效：项目集合被写操作改动后由 useProjects 统一触发 */
  const invalidateStats = useCallback(() => setStats(null), []);

  return { stats, statsLoading, statsRefreshing, statsError, loadStats, invalidateStats };
}

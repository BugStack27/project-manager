import { useCallback, useEffect, useRef, useState } from 'react';

/** 返回历史最多保留的步数 */
const NAV_LIMIT = 50;

/**
 * 页面导航：当前页、深链参数、返回历史栈（Alt+← 与返回按钮）。
 * 历史只记录页面变化，同页内换项目不算「上一页」。
 * 快捷键本身由 useShortcuts 统一分发，这里只提供 goBack 回调。
 */
export function useNavigation({ pid, setPid, projects, openRight }) {
  const [page, setPage] = useState('overview');
  /** 总览 → 其他页的一次性跳转参数；reqId 只在需要选中某条需求时带 */
  const [pendingNav, setPendingNav] = useState(null);
  /** 页面返回历史栈，元素为 { page, pid }；只记录页面变化，最多 50 条 */
  const [navStack, setNavStack] = useState([]);

  /** 上一次渲染的 page / pid：判断页面是否切换、并把切换前的状态压入历史 */
  const navPrev = useRef(null);
  /** 正在执行返回动作：返回引起的跳转不能再入栈 */
  const navBacking = useRef(false);

  // 页面切换记入返回历史：只在 page 变化时压栈，同页内换项目不算「上一页」；
  // 返回动作引起的跳转用 navBacking 标记跳过，否则会来回互推。
  useEffect(() => {
    const prev = navPrev.current;
    navPrev.current = { page, pid };
    if (!prev || prev.page === page) return;
    if (navBacking.current) {
      navBacking.current = false;
      return;
    }
    setNavStack((s) => s.concat(prev).slice(-NAV_LIMIT));
  }, [page, pid]);

  /**
   * 总览/审计/通知的深链入口：切到目标页并选中该项目。
   * extra 兼容旧的 reqId 字符串；新调用可传 { reqId, logCmdId, runId }。
   */
  const gotoProject = useCallback(
    (p, target, extra) => {
      if (!p) return;
      const extras = typeof extra === 'string' ? { reqId: extra } : extra || {};
      setPendingNav({ page: target, pid: p.id, ...extras });
      // 去启动台 / 直达某条需求或日志就是为了看右面板：落地即展开，否则 autoPick 不会挑内容；
      // 同步展开也让「点外面自动收起」把这次点击识别为开抽屉而非点外面
      if (target === 'launch' || extras.reqId || extras.logCmdId) openRight();
      setPage(target);
      setPid(p.id);
    },
    [openRight, setPage, setPid]
  );

  /** 返回上一页：弹出历史栈顶，页面与项目一起恢复；目标页所需的项目已不存在时退回总览 */
  const goBack = useCallback(() => {
    const target = navStack[navStack.length - 1];
    if (!target) return;
    navBacking.current = true;
    setNavStack((s) => s.slice(0, -1));
    const exists = !!target.pid && projects.some((p) => p.id === target.pid);
    // 总览 / 统计是全局页，不依赖当前项目；其余页面项目没了就退回总览
    const global = target.page === 'overview' || target.page === 'statistics';
    if (!global && !exists) {
      // 项目被归档 / 删除后目标页无从落地：退回总览并清空历史。
      // 已经在总览时 page/pid 都不变，effect 不会执行，标记必须当场复位，否则会吞掉下一次正常的入栈。
      setNavStack([]);
      if (page === 'overview') navBacking.current = false;
      else setPage('overview');
      return;
    }
    setPage(target.page);
    if (exists) setPid(target.pid);
  }, [navStack, projects, page, setPage, setPid]);

  return { page, setPage, pendingNav, setPendingNav, navStack, gotoProject, goBack };
}

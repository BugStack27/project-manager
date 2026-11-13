import { useCallback, useEffect, useRef } from 'react';
import { api } from '../api.js';

/**
 * 外部导航目标的统一落点：通知 / 审计 / 全局搜索。
 * 主进程只给目标，项目与页面在这里解析；启动完成前的目标先挂起，等 projects 就绪后补发。
 * 深链参数（reqId / logCmdId / commitSha / openWorking）也在这里消费，等对应数据确属目标项目后才落地。
 */
export function useDeepLinks({
  booted,
  projects,
  page,
  pid,
  setPage,
  setPid,
  gotoProject,
  pendingNav,
  setPendingNav,
  reqs,
  reqsPid,
  cmds,
  cmdsPid,
  showLog,
  setSelReqId,
  layout,
  setLayout,
  gitCommits,
  gitChanges,
  gitLoading,
  gitRefreshing,
  gitStatePid,
  openCommitDetail,
  openFile,
  notify
}) {
  /** 主进程导航回调的最新副本：projects 轮询变化后仍能落到正确项目 */
  const navigateRef = useRef(null);
  /** 启动完成前到达的导航目标：等 projects 加载后再解析，避免误判「项目已删除」 */
  const navPendingRef = useRef(null);

  const handleNavigate = useCallback(
    (target) => {
      const t = target || {};
      if (!booted) {
        navPendingRef.current = t;
        return;
      }
      if (t.page === 'overview' || t.page === 'statistics') {
        setPage(t.page);
        return;
      }
      const p = t.projectId ? projects.find((x) => x.id === t.projectId) : null;
      if (!p) {
        notify('项目已归档或删除，无法跳转', 'warn');
        return;
      }
      if (t.page === 'launch') {
        gotoProject(p, 'launch', { logCmdId: t.commandId, runId: t.runId });
        return;
      }
      if (t.page === 'changes') {
        gotoProject(p, 'changes', t.openWorking ? { openWorking: true } : undefined);
        return;
      }
      gotoProject(p, 'req', t.requirementId);
    },
    [booted, projects, setPage, gotoProject, notify]
  );

  navigateRef.current = handleNavigate;

  useEffect(() => {
    const off = api.onNavigate((t) => {
      if (navigateRef.current) navigateRef.current(t);
    });
    return () => {
      if (typeof off === 'function') off();
    };
  }, []);

  // 启动前的导航目标等 loadProjects 完成后补发；booted 为真才查「项目不存在」
  useEffect(() => {
    if (!booted || !navPendingRef.current) return;
    const t = navPendingRef.current;
    navPendingRef.current = null;
    handleNavigate(t);
  }, [booted, projects, handleNavigate]);

  /**
   * 总览深链的消费点。
   * 切项目时 useRequirements 会清空 selReqId，所以不能同步写；等 reqs 确属目标项目后再落地。
   */
  useEffect(() => {
    if (!pendingNav) return;
    if (page !== pendingNav.page || pid !== pendingNav.pid) {
      setPendingNav(null);
      return;
    }
    if (pendingNav.reqId) {
      if (reqsPid.current !== pid) return;
      if (!reqs.some((r) => r.id === pendingNav.reqId)) {
        setPendingNav(null);
        return;
      }
      setSelReqId(pendingNav.reqId);
      if (layout.rightCollapsed) setLayout((l) => ({ ...l, rightCollapsed: false }));
      setPendingNav(null);
      return;
    }
    if (pendingNav.logCmdId) {
      if (cmdsPid.current !== pid) return;
      if (!cmds.some((c) => c.id === pendingNav.logCmdId)) {
        setPendingNav(null);
        return;
      }
      showLog(pendingNav.logCmdId, { runId: pendingNav.runId || null, find: pendingNav.logFind || null });
      if (layout.rightCollapsed) setLayout((l) => ({ ...l, rightCollapsed: false }));
      setPendingNav(null);
      return;
    }
    if (pendingNav.commitSha) {
      const sha = pendingNav.commitSha;
      // 目标项目的提交列表还在加载：等它落地后再判断，避免拿上一个项目的数据误判
      if (gitLoading || gitRefreshing) return;
      // 目标项目的提交列表还没落地：等 useGit 把它换成该项目的再判断
      if (gitStatePid !== pid) return;
      setPendingNav(null);
      if (gitCommits.some((c) => c.sha === sha)) openCommitDetail(sha);
      else notify('该提交不在项目最近 30 条记录中，无法查看详情', 'warn');
      return;
    }
    if (pendingNav.openWorking) {
      // 审核页「查看改动」落地：目标项目的改动列表就位后默认选中第一个未提交文件，
      // 让中区选中行与右面板 diff 联动，而不是停在空提示上
      if (gitLoading || gitRefreshing) return;
      if (gitStatePid !== pid) return;
      setPendingNav(null);
      const files = (gitChanges && gitChanges.files) || [];
      if (files.length) openFile(files[0]);
      return;
    }
    setPendingNav(null);
  }, [
    pendingNav,
    page,
    pid,
    reqs,
    cmds,
    gitCommits,
    gitChanges,
    gitLoading,
    gitRefreshing,
    gitStatePid,
    openCommitDetail,
    openFile,
    notify,
    layout.rightCollapsed,
    setLayout,
    setPendingNav,
    reqsPid,
    cmdsPid,
    showLog,
    setSelReqId
  ]);

  /**
   * 全局搜索结果跳转：四类结果都带到自己的详情落点。
   * 项目直接切选中（总览 / 统计没有当前项目，改为进需求中心）；需求开右面板；
   * 日志进启动台并带上命中行；提交进修改记录，等列表加载完再打开详情。
   */
  const pickSearchResult = useCallback(
    (row, query) => {
      const { group, item } = row;
      if (group === 'project') {
        const p = projects.find((x) => x.id === item.projectId);
        if (!p) {
          notify('项目已归档或删除，无法跳转', 'warn');
          return;
        }
        if (page === 'overview' || page === 'statistics') gotoProject(p, 'req');
        else setPid(p.id);
        return;
      }
      const p = item.projectId ? projects.find((x) => x.id === item.projectId) : null;
      if (!p) {
        notify('项目已归档或删除，无法跳转', 'warn');
        return;
      }
      if (group === 'requirement') {
        gotoProject(p, 'req', { reqId: item.id });
      } else if (group === 'log') {
        gotoProject(p, 'launch', {
          logCmdId: item.commandId,
          runId: item.runId,
          logFind: { q: query, line: item.line }
        });
      } else if (group === 'commit') {
        gotoProject(p, 'changes', { commitSha: item.sha });
      }
    },
    [projects, page, gotoProject, setPid, notify]
  );

  return { handleNavigate, pickSearchResult };
}

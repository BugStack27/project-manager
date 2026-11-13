import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

/**
 * 启动台的数据与动作：命令列表加载 / 轮询、筛选、日志面板的查看态，
 * 以及命令的新建、编辑、删除、启停与命令面板的快捷启停。
 */
export function useCommands({ page, pid, modal, notify, setModal, loadProjects, openRight }) {
  const [cmds, setCmds] = useState([]);
  const [cmdLoading, setCmdLoading] = useState(false);
  const [cfilter, setCfilter] = useState('all');
  /** 启动台右面板正在查看日志的命令 id（null = 空态提示） */
  const [logCmdId, setLogCmdId] = useState(null);
  /** 指定要定位的历史运行 id；null = 最新一次运行 */
  const [logRunId, setLogRunId] = useState(null);
  /** 从搜索跳转日志时要定位的命中（{ q, line }）：LogDrawer 据此高亮并滚到那一行 */
  const [logFind, setLogFind] = useState(null);
  /** 每次点「启动」自增：让日志面板退出历史运行视图，回到「最新运行」 */
  const [logNonce, setLogNonce] = useState(0);

  /** cmds 属于哪个项目：切项目时旧数据还在 state 里，不能拿它做默认选中 */
  const cmdsPid = useRef(null);

  const loadCmds = useCallback(
    async (id, silent) => {
      if (!id) return;
      if (!silent) setCmdLoading(true);
      try {
        const { commands } = await api.commands(id);
        setCmds(commands);
        cmdsPid.current = id;
      } catch (e) {
        if (!silent) notify(e.message, 'warn');
      } finally {
        if (!silent) setCmdLoading(false);
      }
    },
    [notify]
  );

  useEffect(() => {
    if (!pid) {
      setCmds([]);
      cmdsPid.current = null;
      setCfilter('all');
      return;
    }
    setCfilter('all');
    loadCmds(pid);
  }, [pid, loadCmds]);

  // 切换项目时清空日志查看态，避免指向上一项目的命令
  useEffect(() => {
    setLogCmdId(null);
    setLogRunId(null);
    setLogFind(null);
  }, [pid]);

  useEffect(() => {
    if (page !== 'launch' || !pid) return undefined;
    const t = setInterval(() => loadCmds(pid, true), 2000);
    return () => clearInterval(t);
  }, [page, pid, loadCmds]);

  /* ── 日志查看态 ─────────────────────────────── */

  /** 打开某条命令的日志视图：runId / find 为空即回到「最新运行」，nonce 让历史视图复位 */
  const showLog = useCallback((cmdId, { runId = null, find = null } = {}) => {
    setLogCmdId(cmdId);
    setLogRunId(runId);
    setLogFind(find);
    setLogNonce((n) => n + 1);
  }, []);

  /** 列表里点「日志」：切到这条命令并展开右面板，否则日志没有落脚处 */
  const openLog = useCallback(
    (c) => {
      showLog(c.id);
      openRight();
    },
    [showLog, openRight]
  );

  /* 按 id 解析选中项：列表轮询刷新后仍取最新数据；外部删除后自然回空态 */
  const logCommand = logCmdId ? cmds.find((c) => c.id === logCmdId) || null : null;

  useEffect(() => {
    // 只在数据确属当前项目时才清：切项目瞬间可能还留着上一批数据
    if (logCmdId && !logCommand && cmdsPid.current === pid) setLogCmdId(null);
  }, [logCmdId, logCommand, pid]);

  /* ── 动作 ─────────────────────────────────── */

  async function saveCommand(data) {
    if (modal.mode === 'edit') {
      await api.updateCommand(modal.command.id, data);
      notify('命令已更新');
    } else {
      await api.createCommand(pid, data);
      notify('命令已添加');
    }
    setModal(null);
    await loadCmds(pid, true);
  }

  async function deleteCommand() {
    await api.deleteCommand(modal.command.id);
    setModal(null);
    if (logCmdId === modal.command.id) {
      setLogCmdId(null);
      setLogRunId(null);
    }
    await Promise.all([loadCmds(pid, true), loadProjects()]);
    notify('命令已删除');
  }

  async function startCommand(c) {
    // 先把右面板切到这条命令：点下去立即看到启动日志，不等接口返回。
    // 同一条命令可能正锁在历史运行上，nonce 让日志视图复位到「最新」。
    showLog(c.id);
    openRight();
    try {
      await api.startCommand(c.id);
      notify('命令已启动');
    } catch (e) {
      notify(e.message, 'warn');
    }
    await Promise.all([loadCmds(pid, true), loadProjects()]);
  }

  async function stopCommand(c) {
    try {
      await api.stopCommand(c.id);
      notify('命令已停止');
    } catch (e) {
      notify(e.message, 'warn');
    }
    await Promise.all([loadCmds(pid, true), loadProjects()]);
  }

  /**
   * 命令面板（Ctrl+P）的启停：与启动台共用同一对接口，
   * 差别只在「不起日志视图、不切页面」——面板本身是随手开关服务的入口。
   * 执行后必须立刻刷 projects：面板靠里面的 status / lastRun 换态与重排，不能等 5s 轮询。
   */
  async function runFromPalette(row) {
    const c = row.c;
    const label = c.name || c.text;
    try {
      if (row.on) {
        await api.stopCommand(c.id);
        notify('已停止 ' + label);
      } else {
        await api.startCommand(c.id);
        notify('已启动 ' + label);
      }
    } catch (e) {
      notify(e.message, 'warn');
    }
    await Promise.all([loadProjects(), loadCmds(pid, true)]);
  }

  return {
    cmds,
    cmdLoading,
    cfilter,
    setCfilter,
    cmdsPid,
    logCmdId,
    logRunId,
    logFind,
    logNonce,
    logCommand,
    setLogCmdId,
    loadCmds,
    showLog,
    openLog,
    saveCommand,
    deleteCommand,
    startCommand,
    stopCommand,
    runFromPalette
  };
}

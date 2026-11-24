import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import ChangesPage from './ChangesPage.jsx';
import AppModals from './components/AppModals.jsx';
import CommandPalette from './components/CommandPalette.jsx';
import { HoverCardLayer } from './components/HoverCardLayer.jsx';
import QuestionBall from './components/QuestionBall.jsx';
import QuitPrompt from './components/QuitPrompt.jsx';
import PageMenu from './components/PageMenu.jsx';
import ProjectEmptyState from './components/ProjectEmptyState.jsx';
import ProjectPalette from './components/ProjectPalette.jsx';
import RightPanel from './components/RightPanel.jsx';
import RunPalette from './components/RunPalette.jsx';
import TopWarnStack from './components/TopWarnStack.jsx';
import { UNFINISHED } from './constants.js';
import GitPanel from './GitPanel.jsx';
import { useCommands } from './hooks/useCommands.js';
import { useDeepLinks } from './hooks/useDeepLinks.js';
import { useGit } from './hooks/useGit.js';
import { useGitAuthWarning } from './hooks/useGitAuthWarning.js';
import { useMcp } from './hooks/useMcp.js';
import { useMobileAlert } from './hooks/useMobileAlert.js';
import { useNavigation } from './hooks/useNavigation.js';
import { useProjects } from './hooks/useProjects.js';
import { useRequirements } from './hooks/useRequirements.js';
import { useShortcuts } from './hooks/useShortcuts.js';
import { useStats } from './hooks/useStats.js';
import { useTheme } from './hooks/useTheme.js';
import { useToast } from './hooks/useToast.js';
import { useUpdater } from './hooks/useUpdater.js';
import LaunchPage from './LaunchPage.jsx';
import { clampW, RAIL_W, startDrag, useLayout } from './layout.js';
import { buildBehindMap, buildDirtyFiles, isDiffUnavailable } from './lib/git-view.js';
import { defaultLogCmd } from './lib/log-target.js';
import { PAGE_ICON, PAGE_TITLE, VIEWS } from './lib/page-meta.js';
import { samePath } from './lib/paths.js';
import { formatBinding } from './lib/shortcuts.js';
import OverviewPage from './OverviewPage.jsx';
import RequirementsPage from './RequirementsPage.jsx';
import Sidebar from './Sidebar.jsx';
import StatsPage from './StatsPage.jsx';
import { IdeButton, PageBar, Toast } from './ui.jsx';

/**
 * 「点抽屉外收起」时算作抽屉内部的节点。
 * 悬停卡与证据浮层都 portal 到 body，不在 .rpanel 子树里：卡片改成能接鼠标之后，
 * 点一下卡就会被当成点外面，把抽屉连同正在看的卡一起关掉。点卡片是「读内容」不是「离开抽屉」。
 */
const PANEL_INSIDE = '.rpanel, .phover, .skhover, .rqhover, .fhover, .ev-pop, .imgview';

export default function App() {
  const { layout, setLayout } = useLayout();
  const { pref: themePref, setPref: setThemePref, skin, setSkin } = useTheme();
  const { toast, notify } = useToast();
  const { version, update, runUpdateAction, exportDiagnostics } = useUpdater({ notify });

  /** 统计页数据：跨项目聚合；项目集合变化时由 useProjects 触发失效 */
  const { stats, statsLoading, statsRefreshing, statsError, loadStats, invalidateStats } = useStats({ notify });

  const [modal, setModal] = useState(null);
  /** 数据文件损坏自检结果：非空时顶部常驻提示条（本次运行处于只读空库模式） */
  const [corrupt, setCorrupt] = useState(null);

  const { mcpFail, setMcpFail, mcpRetrying, openMcp, retryMcp } = useMcp({ notify, setModal });
  /** 手机端通信的频道在当前网关上失效时，顶部直接提示重新配对（不必等用户点开弹窗） */
  const mobileRepair = useMobileAlert();

  /** 全局搜索面板是否打开（Ctrl / ⌘ + K） */
  const [paletteOpen, setPaletteOpen] = useState(false);
  /** 启动命令面板是否打开（Ctrl / ⌘ + P）：与搜索面板互斥，同一时刻只留一层浮层 */
  const [runPaletteOpen, setRunPaletteOpen] = useState(false);
  /** 项目切换面板是否打开（Ctrl / ⌘ + O）：同样与另外两个面板互斥 */
  const [projectPaletteOpen, setProjectPaletteOpen] = useState(false);

  const {
    projects,
    archivedProjects,
    project,
    booted,
    pid,
    setPid,
    pidRef,
    loadProjects,
    reorderProjects,
    openCreateProject,
    archiveProject,
    deleteProject,
    restoreProject,
    revealProject,
    openTerminal,
    openDataDir
  } = useProjects({ notify, setModal, onProjectsChanged: invalidateStats });

  /** 项目菜单里的归档：与设置弹窗复用同一领域动作；失败（如仍有命令在运行）转成警告 */
  const archiveProjectFromMenu = useCallback(
    async (p) => {
      try {
        await archiveProject(p);
      } catch (e) {
        notify(e.message, 'warn');
      }
    },
    [archiveProject, notify]
  );

  /** 自动默认选中「每次进入只做一次」的标记，key = page|pid */
  const autoPick = useRef('');

  // 首屏数据就绪后通知主进程：关掉独立启动窗，显示主窗口。
  // 等两帧确认完整界面已上屏，主窗口出现的第一帧就是它。
  useEffect(() => {
    if (!booted) return;
    requestAnimationFrame(() => requestAnimationFrame(() => window.pm?.signalReady?.()));
  }, [booted]);

  /** 本次 click 是否触发了「展开抽屉」：点外面自动收起时据此豁免，避免换内容时先关再开地闪一下 */
  const reopenGuard = useRef(false);

  /** 展开右抽屉：日志 / 需求详情 / diff 的落脚处 */
  const openRight = useCallback(() => {
    reopenGuard.current = true;
    setLayout((l) => (l.rightCollapsed ? { ...l, rightCollapsed: false } : l));
  }, [setLayout]);

  /** 关闭右抽屉：保留选中项，重开还在原位 */
  const closeRight = useCallback(() => {
    setLayout((l) => (l.rightCollapsed ? l : { ...l, rightCollapsed: true }));
  }, [setLayout]);

  // Esc 关抽屉：与弹窗（window 级 Esc 监听）分层 —— 弹窗开着时不响应；
  // 焦点在输入控件里也不响应，否则在回复框里打字按 Esc 会连抽屉一起关掉
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape' || modal || layout.rightCollapsed) return;
      const t = e.target;
      if (t && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      closeRight();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modal, layout.rightCollapsed, closeRight]);

  // 点抽屉外自动收起：覆盖式抽屉与浮层同一套「点外面即关」习惯。
  // click 捕获阶段先复位 reopenGuard，目标 onClick 里若展开抽屉会置位，冒泡到 document 时据此跳过：
  // 点列表行 / 日志 / 改动是「换内容」而非「点外面」，不能先关再开地闪一下。
  // 弹窗 / 命令面板盖在抽屉上时不响应，点它们不算点外面。
  // portal 到 body 的悬停卡 / 证据浮层不在 .rpanel 子树里，但点它们是「读抽屉里的内容」，
  // 一并算作内部（PANEL_INSIDE），否则卡片改成能接鼠标后一点就把抽屉收掉。
  // 拖拽（调宽 / 排序 / 选文本）松手会在公共祖先上合成一次 click，靠按下位置与位移豁免，避免拖完就关。
  useEffect(() => {
    if (layout.rightCollapsed) return undefined;
    let press = { inside: false, moved: false, x: 0, y: 0 };
    const onDown = (e) => {
      const t = e.target;
      press = { inside: !!(t && t.closest && t.closest(PANEL_INSIDE)), moved: false, x: e.clientX, y: e.clientY };
    };
    const onUp = (e) => {
      press.moved = Math.hypot(e.clientX - press.x, e.clientY - press.y) > 4;
    };
    const arm = () => {
      reopenGuard.current = false;
    };
    const onClick = (e) => {
      const skip = reopenGuard.current || press.inside || press.moved;
      press = { inside: false, moved: false, x: 0, y: 0 };
      if (skip) return;
      if (modal || paletteOpen || runPaletteOpen || projectPaletteOpen) return;
      const t = e.target;
      if (t && t.closest && t.closest(PANEL_INSIDE)) return;
      closeRight();
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('pointerup', onUp, true);
    document.addEventListener('click', arm, true);
    document.addEventListener('click', onClick);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('pointerup', onUp, true);
      document.removeEventListener('click', arm, true);
      document.removeEventListener('click', onClick);
    };
  }, [layout.rightCollapsed, modal, paletteOpen, runPaletteOpen, projectPaletteOpen, closeRight]);

  const { page, setPage, pendingNav, setPendingNav, navStack, gotoProject, goBack } = useNavigation({
    pid,
    setPid,
    projects,
    openRight
  });

  const {
    reqs,
    reqLoading,
    filter,
    setFilter,
    selReqId,
    setSelReqId,
    reqsPid,
    selReq,
    loadReqs,
    reloadRequirements,
    openNewRequirement,
    saveRequirement,
    saveRequirementDetail,
    answerRequirement,
    approveRequirement,
    replyRequirement,
    changeStatus,
    confirmStatusNote,
    openRequirement,
    deleteRequirement,
    archiveRequirement,
    unlockRequirement,
    relockRequirement
  } = useRequirements({ page, pid, project, modal, notify, setModal, loadProjects, openRight });

  const {
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
  } = useCommands({ page, pid, modal, notify, setModal, loadProjects, openRight });

  /** 快捷键「全局搜索」：三个面板互斥，已开则关 */
  const toggleSearchPalette = useCallback(() => {
    if (paletteOpen) {
      setPaletteOpen(false);
      return;
    }
    setRunPaletteOpen(false);
    setProjectPaletteOpen(false);
    setPaletteOpen(true);
  }, [paletteOpen]);

  /** 快捷键「启动命令面板」：与搜索面板互斥，已开则关 */
  const toggleRunPalette = useCallback(() => {
    if (runPaletteOpen) {
      setRunPaletteOpen(false);
      return;
    }
    setPaletteOpen(false);
    setProjectPaletteOpen(false);
    setRunPaletteOpen(true);
  }, [runPaletteOpen]);

  /** 快捷键「切换项目」：与另外两个面板互斥，已开则关 */
  const toggleProjectPalette = useCallback(() => {
    if (projectPaletteOpen) {
      setProjectPaletteOpen(false);
      return;
    }
    setPaletteOpen(false);
    setRunPaletteOpen(false);
    setProjectPaletteOpen(true);
  }, [projectPaletteOpen]);

  /**
   * 正文里点「@{项目名}」：跳到那个项目的需求中心。
   * 归档项目也要能打开——引用里留着已归档的项目是正常的，真的不存在才提示。
   */
  const openProjectById = useCallback(
    (id) => {
      const p = projects.find((x) => x.id === id) || archivedProjects.find((x) => x.id === id);
      if (!p) {
        notify('引用的项目已不存在，可能已被删除', 'warn');
        return;
      }
      gotoProject(p, 'req');
    },
    [projects, archivedProjects, gotoProject, notify]
  );

  /** 面板里选中项目：总览 / 统计没有当前项目语义，落地到该项目的需求中心；其余页只换项目 */
  const switchProject = useCallback(
    (p) => {
      setProjectPaletteOpen(false);
      if (!p) return;
      if (page === 'overview' || page === 'statistics') {
        gotoProject(p, 'req');
        return;
      }
      setPid(p.id);
    },
    [page, gotoProject, setPid]
  );

  /**
   * 快捷键「新建」：同一个组合在两种视图里指两件事——需求中心建需求，启动台建命令。
   * 不拆成两条动作：快捷键表禁止两个动作共用同一组合，拆开必然有一条永远不生效。
   * 其它视图没有可新建的东西，给一句提示而不是静默吞键，否则会被当成快捷键失灵。
   */
  const createInView = useCallback(() => {
    if (!project) {
      notify('先选一个项目，再新建需求或命令', 'warn');
      return;
    }
    if (page === 'req') {
      setModal({ type: 'requirement' });
      return;
    }
    if (page === 'launch') {
      setModal({ type: 'command', mode: 'create' });
      return;
    }
    notify('「新建」只在需求中心与启动台可用', 'info');
  }, [page, project, notify]);

  /** 快捷键「项目设置」：没有选中项目时给一句提示，避免被当成快捷键失灵 */
  const openProjectSettings = useCallback(() => {
    if (!project) {
      notify('先选一个项目，再打开项目设置', 'warn');
      return;
    }
    setModal({ type: 'project', mode: 'edit', project });
  }, [project, notify]);

  /** 快捷键「切换视图页签」：在项目的三个视图间循环；总览 / 统计或没有选中项目时不响应 */
  const cycleView = useCallback(() => {
    const keys = VIEWS.map((v) => v.key);
    const i = keys.indexOf(page);
    if (!project || i < 0) return;
    setPage(keys[(i + 1) % keys.length]);
  }, [page, project, setPage]);

  /** 全局快捷键统一分发；弹窗打开时整体让路（快捷键弹窗里的录制按键不受影响） */
  const shortcuts = useShortcuts({
    blocked: !!modal,
    handlers: {
      back: goBack,
      cycleView,
      search: toggleSearchPalette,
      run: toggleRunPalette,
      switchProject: toggleProjectPalette,
      create: createInView,
      projectSettings: openProjectSettings,
      shortcuts: () => setModal({ type: 'shortcuts' })
    }
  });

  const {
    gitCommits,
    gitChanges,
    gitRemote,
    gitPulling,
    gitPushing,
    gitHasMore,
    gitLoading,
    gitRefreshing,
    gitLoadingMore,
    gitUnavailable,
    gitError,
    gitErrorCode,
    gitStatePid,
    gitSummary,
    gitOpen,
    gitCommitFiles,
    sel,
    content,
    loadGit,
    loadGitSummary,
    loadMoreGit,
    toggleGitGroup,
    openCommitDetail,
    openFile,
    refreshPage,
    pullGit,
    pushGit,
    openCommit,
    submitCommit,
    commitAndPushPending
  } = useGit({ pid, pidRef, page, projects, notify, setModal, openRight, reloadRequirements });

  const { authRow, authProject, showAuthWarn, dismissAuthWarn, authRetrying, recheckGitAuth } = useGitAuthWarning({
    gitSummary,
    projects,
    pid,
    page,
    loadGit,
    loadGitSummary,
    notify
  });

  /**
   * 验收通过时可顺带提交并推送工作区改动：git 先完成，失败则验收不生效（弹窗/面板里报错）
   */
  const approveRequirementWithGit = useCallback(
    async (requirement, autoPush) => {
      if (autoPush) await commitAndPushPending(requirement);
      await approveRequirement(requirement);
    },
    [approveRequirement, commitAndPushPending]
  );

  /** 列表 / 看板的「通过」走状态弹窗，勾选项随表单一起提交 */
  const confirmStatusWithGit = useCallback(
    async (text, opts) => {
      const requirement = modal && modal.requirement;
      const auto =
        !!(opts && opts.autoCommitPush) &&
        requirement &&
        requirement.status === 'review' &&
        modal.status === 'done';
      if (auto) await commitAndPushPending(requirement);
      await confirmStatusNote(text);
    },
    [modal, confirmStatusNote, commitAndPushPending]
  );

  /**
   * 启动自动拉取的结果：主进程在窗口起来后后台跑完才推过来，
   * 这里只做两件事——给一句提示、把修改记录刷成拉取后的状态（拉取会改动工作区）。
   */
  useEffect(() => {
    return api.onAutoPull((s) => {
      if (!s || !s.pulled) return;
      notify(
        '启动自动拉取：' + s.pulled + ' 个项目已更新' + (s.failed ? '，' + s.failed + ' 个失败' : '')
      );
      if (pidRef.current) loadGit(pidRef.current, { background: true });
      loadGitSummary();
    });
  }, [notify, loadGit, loadGitSummary]);

  // 进入统计页时只在没有缓存的情况下加载；刷新由按钮手动触发
  useEffect(() => {
    if (page !== 'statistics' || stats || statsLoading) return;
    loadStats(false);
  }, [page, stats, statsLoading, loadStats]);

  // 启动自检只做一次：数据文件损坏要让用户立刻看到，而不是等打开备份弹窗才发现
  useEffect(() => {
    api
      .dataStatus()
      .then((s) => {
        if (s && s.corrupted) setCorrupt(s);
      })
      .catch(() => {});
  }, []);

  // 每次进入页面 / 切换项目，自动默认选中重新计一次（用户之后手动关掉不再弹回）。
  // 顺序要紧：本 effect 必须先于下面两个消费型 effect 执行，否则重置会晚于消费。
  useEffect(() => {
    autoPick.current = '';
  }, [page, pid]);

  // 进入启动台：右面板展开且未选日志时，默认打开运行中的第一条，否则最近一次运行过的那条
  useEffect(() => {
    if (page !== 'launch' || !pid) return;
    if (cmdsPid.current !== pid) return;
    const key = 'launch|' + pid;
    if (autoPick.current === key) return;
    autoPick.current = key;
    if (layout.rightCollapsed || logCmdId || !cmds.length) return;
    const id = defaultLogCmd(cmds);
    if (id) setLogCmdId(id);
  }, [page, pid, cmds, layout.rightCollapsed, logCmdId, cmdsPid, setLogCmdId]);

  // 进入需求中心 / 切换项目：面板展开、未选需求时自动展示编号最大的未完成需求；
  // 「已完成 / 已拒绝」页签不选（详情必须与列表可见行对齐）。
  // autoPick 标记只在真正选中后写入：收起 / 页签不符 / 数据未就绪都不算消费，展开后仍会补选。
  useEffect(() => {
    if (page !== 'req' || !pid || reqsPid.current !== pid) return;
    const key = 'req|' + pid;
    if (autoPick.current === key) return;
    if (layout.rightCollapsed || selReqId) return;
    if (filter !== 'unfinished') return;
    const first = reqs.find((r) => UNFINISHED.includes(r.status));
    if (!first) return;
    autoPick.current = key;
    setSelReqId(first.id);
  }, [page, pid, reqs, selReqId, filter, layout.rightCollapsed, reqsPid, setSelReqId]);

  // 进入总览 / 统计即关抽屉：这两页右侧没有可看的详情，留着只会是一片空壳盖在内容上
  useEffect(() => {
    if (page !== 'overview' && page !== 'statistics') return;
    setLayout((l) => (l.rightCollapsed ? l : { ...l, rightCollapsed: true }));
  }, [page, setLayout]);

  // 深链消费必须排在自动选中之后：先让默认选中消费 autoPick，再由深链覆盖成目标项，
  // 否则深链落地后 autoPick 没被消费，用户关掉详情时会自动弹回默认项。
  const { handleNavigate, pickSearchResult } = useDeepLinks({
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
  });

  /**
   * 跨项目的待处理事项：项目轮询（5s）已经带回 questions / reviews 摘要，不额外发请求。
   * 提问按到点先后、待审核按交付时间，统一按最紧急的那条排在最上面。
   */
  const pendingItems = projects
    .flatMap((p) => [
      ...(p.questions || []).map((q) => ({ kind: 'question', project: p, ...q })),
      ...(p.reviews || []).map((r) => ({ kind: 'review', project: p, ...r }))
    ])
    .sort((a, b) => String(a.expiresAt || a.at).localeCompare(String(b.expiresAt || b.at)));

  /* ── 项目弹窗 ─────────────────────────────── */

  async function saveProject(data) {
    if (modal.mode === 'edit') {
      const targetId = modal.project.id;
      const moved = !samePath(modal.project.path, data.path);
      const res = await api.updateProject(targetId, data);
      setModal(null);
      await Promise.all([loadProjects(), loadReqs(pid, true), loadCmds(pid, true)]);
      if (moved) {
        // 目录换了：git 侧读的是 p.path，后端不用动，脏的只是界面里这份缓存。
        // 提交树的展开态与右面板选中文件都保留 —— 换的是同一个仓库的另一个位置，不是另一个仓库。
        // 只在正看着修改记录页时重拉：别的情况下没人在看那份数据，白起三个 git 进程（还带 15s 静默 fetch），
        // 等下次进页时 page 变化会让进页 effect 自己拉一次。
        loadGitSummary();
        if (targetId === pid && page === 'changes') loadGit(targetId, { background: true });
        invalidateStats();
      }
      const synced = (res && res.syncedCommands) || 0;
      notify(synced > 0 ? '项目已更新，已同步 ' + synced + ' 条命令的工作目录' : '项目已更新');
    } else {
      const res = await api.createProject(data);
      setModal(null);
      await loadProjects();
      setPid(res.project.id);
      invalidateStats();
      notify('已创建项目 ' + res.project.name + '，去启动台加一条命令吧');
    }
  }

  /** 总览页行内启停：不走启动台的日志视图，避免在这里把右面板顶开 */
  async function startFromOverview(c) {
    try {
      await api.startCommand(c.id);
      notify('已启动 ' + c.text);
    } catch (e) {
      notify(e.message, 'warn');
    }
    await loadProjects();
  }

  async function stopFromOverview(c) {
    try {
      await api.stopCommand(c.id);
      notify('已停止 ' + c.text);
    } catch (e) {
      notify(e.message, 'warn');
    }
    await loadProjects();
  }

  /* ── 渲染 ─────────────────────────────────── */

  const leftW = layout.leftCollapsed ? RAIL_W : layout.leftW;
  /** 中间面板宽度 = 视口减左右两栏；强提醒列表最宽占它的 2/3 */
  /* 抽屉是覆盖层，中区不再被挤压，弹层宽度只随左栏宽度变化 */
  const popMaxW = `calc((100vw - ${leftW}px) * 0.66)`;

  function dragLeft(e) {
    const base = layout.leftW;
    startDrag(e, (dx) => setLayout((l) => ({ ...l, leftW: clampW(base + dx, 'left') })));
  }

  function dragRight(e) {
    const base = layout.rightW;
    startDrag(e, (dx) => setLayout((l) => ({ ...l, rightW: clampW(base - dx, 'right') })));
  }

  /** 用系统浏览器打开外链（目前只有「访问远程仓库」用） */
  function openUrl(url) {
    api.openUrl(url).catch((e) => notify(e.message, 'warn'));
  }

  const diffUnavailable = isDiffUnavailable({ gitUnavailable, gitError, gitChanges });
  const dirtyFiles = buildDirtyFiles(gitSummary);
  const behindMap = buildBehindMap(gitSummary);

  if (!booted) {
    return (
      <div className="app">
        <div className="main">
          <div className="loading">
            <span className="spinner" />
            正在连接本地服务…
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <Sidebar
        projects={projects}
        archivedProjects={archivedProjects}
        currentId={pid}
        page={page}
        onNav={setPage}
        onOpenBackup={() => setModal({ type: 'backup' })}
        onOpenDataDir={openDataDir}
        onOpenMcp={openMcp}
        onOpenShortcuts={() => setModal({ type: 'shortcuts' })}
        shortcutsHint={formatBinding(shortcuts.bindings.shortcuts).join(' + ')}
        theme={themePref}
        onSetTheme={setThemePref}
        skin={skin}
        onSetSkin={setSkin}
        modalOpen={!!modal}
        onOpenUpdate={() => setModal({ type: 'update' })}
        version={version}
        updatePhase={update.phase}
        onOpenAudit={() => setModal({ type: 'audit' })}
        onOpenNotifications={() => setModal({ type: 'notifications' })}
        onOpenGitSettings={() => setModal({ type: 'git' })}
        onOpenMobile={() => setModal({ type: 'mobile' })}
        onSelect={(id) => {
          // 总览 / 统计没有「当前项目」语义：点侧栏项目直接进入该项目的需求中心
          if (page === 'overview' || page === 'statistics') {
            const p = projects.find((x) => x.id === id);
            if (p) {
              gotoProject(p, 'req');
              return;
            }
          }
          setPid(id);
        }}
        onNewProject={openCreateProject}
        onReorderProjects={reorderProjects}
        onEditProject={(p) => setModal({ type: 'project', mode: 'edit', project: p })}
        onArchiveProject={archiveProjectFromMenu}
        onRestoreProject={restoreProject}
        onDeleteProject={deleteProject}
        onReveal={revealProject}
        onOpenTerminal={openTerminal}
        onOpenView={gotoProject}
        onNotify={notify}
        width={leftW}
        collapsed={layout.leftCollapsed}
        onToggle={() => setLayout((l) => ({ ...l, leftCollapsed: !l.leftCollapsed }))}
        dirtyFiles={dirtyFiles}
        behindMap={behindMap}
      />

      {!layout.leftCollapsed && <div className="rz" onPointerDown={dragLeft} />}

      <main className="main">
        <PageBar
          title={PAGE_TITLE[page] || '需求中心'}
          icon={PAGE_ICON[page]}
          titleSlot={
            // 视图切换只对「选中了项目」的页面有意义：总览 / 统计没有当前项目，空状态也没有
            page !== 'overview' && page !== 'statistics' && project ? (
              <PageMenu
                page={page}
                project={project}
                dirtyCount={dirtyFiles[project.id] || 0}
                behindCount={behindMap[project.id] || 0}
                onNav={(target) => {
                  // 切到启动台是为了看日志：保持抽屉展开，也让点外面收起把这次点击识别为开抽屉
                  if (target === 'launch') openRight();
                  setPage(target);
                }}
              />
            ) : null
          }
          onBack={navStack.length ? goBack : undefined}
        >
          {/* 在 IDE 中打开：总览 / 统计没有"当前项目"，不显示 */}
          {project && page !== 'overview' && page !== 'statistics' ? <IdeButton project={project} /> : null}
        </PageBar>

        {/* 顶部提示条：多条都可能出现，粘性挂在容器上，避免各自的 sticky 在同一个 top 上叠成一堆 */}
        <TopWarnStack
          corrupt={corrupt}
          mcpFail={mcpFail}
          mcpRetrying={mcpRetrying}
          onRetryMcp={retryMcp}
          onDismissMcp={() => setMcpFail(null)}
          onOpenBackup={() => setModal({ type: 'backup' })}
          onOpenDataDir={openDataDir}
          showAuthWarn={showAuthWarn}
          authRow={authRow}
          authProject={authProject}
          authRetrying={authRetrying}
          onLogin={() => openTerminal(authProject)}
          onRecheckAuth={recheckGitAuth}
          onDismissAuth={dismissAuthWarn}
          mobileRepair={mobileRepair}
          onOpenMobile={() => setModal({ type: 'mobile' })}
        />

        {page === 'overview' ? (
          <OverviewPage
            projects={projects}
            gitSummary={gitSummary}
            onOpen={gotoProject}
            onStart={startFromOverview}
            onStop={stopFromOverview}
            onEditProject={(p) => setModal({ type: 'project', mode: 'edit', project: p })}
            onArchiveProject={archiveProjectFromMenu}
            onReveal={revealProject}
            onOpenTerminal={openTerminal}
            onNotify={notify}
            onCreateProject={openCreateProject}
          />
        ) : page === 'statistics' ? (
          <StatsPage
            data={stats}
            loading={statsLoading}
            refreshing={statsRefreshing}
            error={statsError}
            onRefresh={() => loadStats(!!stats)}
          />
        ) : !project ? (
          <ProjectEmptyState onCreateProject={openCreateProject} />
        ) : page === 'req' ? (
          <RequirementsPage
            project={project}
            projects={projects}
            requirements={reqs}
            filter={filter}
            onFilter={setFilter}
            loading={reqLoading && reqs.length === 0}
            onNew={openNewRequirement}
            onStatus={changeStatus}
            onArchive={archiveRequirement}
            onArchived={() => setModal({ type: 'archive' })}
            selId={selReqId}
            onSelect={openRequirement}
          />
        ) : page === 'launch' ? (
          <LaunchPage
            project={project}
            projects={projects}
            commands={cmds}
            filter={cfilter}
            onFilter={setCfilter}
            loading={cmdLoading && cmds.length === 0}
            selId={logCmdId}
            onNew={() => setModal({ type: 'command', mode: 'create' })}
            onEdit={(c) => setModal({ type: 'command', mode: 'edit', command: c })}
            onStart={startCommand}
            onStop={stopCommand}
            onLogs={openLog}
          />
        ) : (
          <ChangesPage
            project={project}
            projects={projects}
            changes={gitChanges}
            remote={gitRemote}
            pulling={gitPulling}
            pushing={gitPushing}
            loading={gitLoading}
            refreshing={gitRefreshing}
            unavailable={gitUnavailable}
            error={gitError}
            errorCode={gitErrorCode}
            onCommit={openCommit}
            onRefresh={refreshPage}
            onPull={pullGit}
            onPush={pushGit}
            onOpenUrl={openUrl}
            onEditPath={() => setModal({ type: 'project', mode: 'edit', project })}
          >
            <GitPanel
              changes={gitChanges}
              commits={gitCommits}
              remote={gitRemote}
              hasMore={gitHasMore}
              loading={gitLoading}
              loadingMore={gitLoadingMore}
              unavailable={gitUnavailable}
              error={gitError}
              openGroups={gitOpen}
              onToggleGroup={toggleGitGroup}
              sel={sel}
              onOpenCommit={openCommitDetail}
              onOpenFile={openFile}
              onLoadMore={loadMoreGit}
            />
          </ChangesPage>
        )}
      </main>

      <RightPanel
        page={page}
        project={project}
        projects={projects}
        collapsed={layout.rightCollapsed}
        width={layout.rightW}
        sel={sel}
        content={content}
        diffUnavailable={diffUnavailable}
        commitFiles={gitCommitFiles}
        logCommand={logCommand}
        logNonce={logNonce}
        logRunId={logRunId}
        logFind={logFind}
        selReq={selReq}
        onOpenProject={openProjectById}
        onOpenRequirement={(id) => openRequirement({ id })}
        onDragStart={dragRight}
        onClosePanel={closeRight}
        onCloseLog={closeRight}
        onStart={startCommand}
        onStop={stopCommand}
        onSaveRequirement={saveRequirementDetail}
        onDeleteRequirement={deleteRequirement}
        onArchiveRequirement={archiveRequirement}
        onStatusRequirement={changeStatus}
        onAnswerRequirement={answerRequirement}
        onApproveRequirement={approveRequirementWithGit}
        onReplyRequirement={replyRequirement}
        onUnlockRequirement={unlockRequirement}
        onRelockRequirement={relockRequirement}
        onOpenAudit={(payload) => setModal({ type: 'audit', ...payload })}
        onViewChanges={() => gotoProject(project, 'changes', { openWorking: true })}
        onOpenCommit={(sha) => gotoProject(project, 'changes', { commitSha: sha })}
        notify={notify}
      />

      <AppModals
        modal={modal}
        project={project}
        projects={projects}
        archivedProjects={archivedProjects}
        onClose={() => setModal(null)}
        onNavigate={handleNavigate}
        onRestoredRequirements={async () => {
          await Promise.all([reloadRequirements(pid), loadProjects()]);
        }}
        onSaveProject={saveProject}
        onArchiveProject={async () => {
          await archiveProject(modal.project);
          setModal(null);
        }}
        onRevealProject={revealProject}
        onSaveRequirement={saveRequirement}
        onConfirmStatusNote={confirmStatusWithGit}
        onSaveCommand={saveCommand}
        onDeleteCommand={deleteCommand}
        onCommit={submitCommit}
        update={update}
        onUpdateAction={runUpdateAction}
        onExportDiag={exportDiagnostics}
        onRetryMcp={retryMcp}
        mcpBusy={mcpRetrying}
        shortcuts={shortcuts}
        notify={notify}
      />

      <Toast toast={toast} />

      {/* 引用项目 / 技能的悬停信息窗：全界面一张卡，就地挂在根层，chip 谁都能呼叫 */}
      <HoverCardLayer
        projects={projects}
        archivedProjects={archivedProjects}
        dirtyFiles={dirtyFiles}
        behindMap={behindMap}
      />

      {/* 强提醒球：提问与待审核都收在这里，贴在右面板左侧的右下角，不压内容 */}
      <QuestionBall
        items={pendingItems}
        rightOffset={layout.rightCollapsed ? 20 : layout.rightW + 20}
        maxWidth={popMaxW}
        onOpen={(p, reqId) => {
          // 提问与待审核都属于「未完成」：把列表切回未完成，点开后左右两侧都能对上
          setFilter('unfinished');
          gotoProject(p, 'req', { reqId });
        }}
      />

      <CommandPalette
        open={paletteOpen}
        blocked={!!modal}
        onClose={() => setPaletteOpen(false)}
        onPick={(row, query) => {
          setPaletteOpen(false);
          pickSearchResult(row, query);
        }}
      />

      <RunPalette
        open={runPaletteOpen}
        blocked={!!modal}
        projects={projects}
        onClose={() => setRunPaletteOpen(false)}
        onRun={runFromPalette}
        onRefresh={loadProjects}
      />

      <ProjectPalette
        open={projectPaletteOpen}
        blocked={!!modal}
        projects={projects}
        currentId={pid}
        onClose={() => setProjectPaletteOpen(false)}
        onPick={switchProject}
      />

      {/* 退出询问独立挂载：它由主进程推开，不属于 modal 这套用户触发的装配 */}
      <QuitPrompt />
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import ProjectHoverCard from './components/ProjectHoverCard.jsx';
import ProjectMenu from './components/ProjectMenu.jsx';
import { PROJECT_KIND_LABELS, PROJECT_STACK_LABELS } from './constants.js';
import { avatarColor } from './format.js';
import { IC, PanelIcon } from './icons.jsx';
import { behindBadge, behindTip } from './lib/git-view.js';
import { THEME_LABELS, THEMES } from './lib/theme.js';
import { SKIN_LABELS, SKINS } from './lib/skin.js';
import { VIEWS } from './lib/page-meta.js';
import { ProjectIcon, ProjectStackIcon } from './ui.jsx';

/** 灯 → 视图名的映射：tooltip 与中区标题下拉用同一套叫法，改名时只改 page-meta 一处 */
const VIEW_LABEL = Object.fromEntries(VIEWS.map((v) => [v.key, v.label]));

export default function Sidebar({
  projects,
  archivedProjects,
  currentId,
  page,
  onNav,
  onOpenBackup,
  onOpenDataDir,
  onOpenMcp,
  onOpenShortcuts,
  shortcutsHint,
  theme,
  onSetTheme,
  skin,
  onSetSkin,
  modalOpen,
  onOpenUpdate,
  version,
  updatePhase,
  onOpenAudit,
  onOpenNotifications,
  onOpenGitSettings,
  onSelect,
  onNewProject,
  onReorderProjects,
  onEditProject,
  onArchiveProject,
  onRestoreProject,
  onDeleteProject,
  onReveal,
  onOpenTerminal,
  onOpenView,
  width,
  collapsed,
  onToggle,
  dirtyFiles,
  behindMap
}) {
  // 底部「设置与数据」浮层：{ left, bottom }，向上弹出，不挤压项目列表
  const [dataPop, setDataPop] = useState(null);
  const dataPopRef = useRef(null);
  /** 鼠标停留后的项目信息卡：{ project, color, dirty, behind, left, top } */
  const [hoverCard, setHoverCard] = useState(null);
  const hoverTimer = useRef(null);
  /** 行 → 卡片之间有一段空隙：延时收起，卡片接住鼠标时由 onMouseEnter 撤掉 */
  const hoverCloseTimer = useRef(0);
  /* ── 外观 / 皮肤：各一行入口 + 右侧二级菜单 ────────────────────
     平铺会把「界面」组撑得过长；收成行后右侧显示当前值，选项放进二级菜单。
     两行共用一套二级菜单机制（openSub 标记当前展开的是哪行），fixed 定位避免被 .datapop 的 overflow:auto 裁掉。 */
  const [openSub, setOpenSub] = useState(null); // 'theme' | 'skin' | null
  const [subPos, setSubPos] = useState(null); // { left, bottom }
  const subWrapRef = useRef(null);
  const subRef = useRef(null);
  const themeRowRef = useRef(null);
  const skinRowRef = useRef(null);
  const subCloseTimer = useRef(null);
  const subFocusOnOpen = useRef(false);
  const subRowRef = (key) => (key === 'skin' ? skinRowRef : themeRowRef);

  const closeSub = () => {
    clearTimeout(subCloseTimer.current);
    setOpenSub(null);
  };

  /** 行与子菜单之间有空隙：移出后延迟收，否则鼠标还没走到子菜单它就没了 */
  const scheduleCloseSub = () => {
    clearTimeout(subCloseTimer.current);
    subCloseTimer.current = setTimeout(() => setOpenSub(null), 140);
  };

  /** 向右弹出；右侧放不下就翻到左边（判据是真实剩余空间，不是固定像素） */
  const openSubMenu = (key, focusFirst) => {
    clearTimeout(subCloseTimer.current);
    const el = subRowRef(key).current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = 168;
    const gap = 6;
    const roomRight = window.innerWidth - 8 - (r.right + gap);
    const left = roomRight >= width ? r.right + gap : r.left - width - gap;
    subFocusOnOpen.current = !!focusFirst;
    setSubPos({ left: Math.max(8, left), bottom: Math.max(8, window.innerHeight - r.bottom) });
    setOpenSub(key);
  };

  // 打开后按需把焦点送进子菜单；子菜单是 fixed，浮层内滚动或窗口缩放都会让锚点跑掉，直接收起
  useEffect(() => {
    if (!openSub) return undefined;
    if (subFocusOnOpen.current) {
      subFocusOnOpen.current = false;
      subRef.current?.querySelector('[role="menuitemradio"]')?.focus();
    }
    const close = () => setOpenSub(null);
    document.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [openSub]);

  // 卸载时清掉延迟器，避免浮层已关还在 setState
  useEffect(() => () => clearTimeout(subCloseTimer.current), []);
  useEffect(() => () => {
    clearTimeout(hoverTimer.current);
    clearTimeout(hoverCloseTimer.current);
  }, []);

  // 悬停卡片是 fixed 定位：列表滚动 / 窗口缩放 / 打开弹层时直接收起，避免悬空
  useEffect(() => {
    if (!hoverCard) return undefined;
    const hide = () => setHoverCard(null);
    window.addEventListener('resize', hide);
    document.addEventListener('scroll', hide, true);
    return () => {
      window.removeEventListener('resize', hide);
      document.removeEventListener('scroll', hide, true);
    };
  }, [hoverCard]);

  useEffect(() => {
    if (modalOpen || collapsed || dataPop) setHoverCard(null);
  }, [modalOpen, collapsed, dataPop]);

  const onSubRowKeyDown = (key) => (e) => {
    if (e.key !== 'ArrowRight') return;
    e.preventDefault();
    openSubMenu(key, true);
  };

  const onSubKeyDown = (e) => {
    // Esc / ←：只收二级菜单，不牵连整个「设置与数据」浮层（stopPropagation 挡住 window 上的 Esc）
    if (e.key === 'Escape' || e.key === 'ArrowLeft') {
      e.preventDefault();
      e.stopPropagation();
      const row = subRowRef(openSub).current;
      closeSub();
      row?.focus();
      return;
    }
    const items = Array.from(subRef.current?.querySelectorAll('[role="menuitemradio"]') || []);
    if (!items.length) return;
    const i = items.indexOf(document.activeElement);
    let next = -1;
    if (e.key === 'ArrowDown') next = (i + 1) % items.length;
    else if (e.key === 'ArrowUp') next = (i - 1 + items.length) % items.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    if (next < 0) return;
    e.preventDefault();
    items[next].focus();
  };

  /** 焦点整体离开「行 + 子菜单」才收起；否则点中某项时会先被自己的 blur 关掉 */
  const onSubBlur = () => {
    setTimeout(() => {
      const wrap = subWrapRef.current;
      if (wrap && !wrap.contains(document.activeElement)) setOpenSub(null);
    }, 0);
  };

  const themeIcon = theme === 'system' ? IC.auto : theme === 'light' ? IC.sun : IC.moon;

  // 「已归档」分组：默认收起，展开状态只记在本次会话
  const [archivedOpen, setArchivedOpen] = useState(false);
  // 正在恢复的项目 id：防重复点击，按钮显示恢复中
  const [restoringId, setRestoringId] = useState(null);
  // 已归档行的删除：armedId 是「已武装、等第二次点击」的项目 id；deletingId 是真正在删的那个
  const [armedId, setArmedId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  // 项目拖拽排序：dragId 是正在拖的项目，dropAt 是插入位置（0..可见项目数）
  const listRef = useRef(null);
  const [dragId, setDragId] = useState(null);
  const [dropAt, setDropAt] = useState(null);

  // 武装状态 5 秒后自动撤销：和弹窗里的两步确认按钮同一口径
  useEffect(() => {
    if (armedId == null) return undefined;
    const t = setTimeout(() => setArmedId(null), 5000);
    return () => clearTimeout(t);
  }, [armedId]);
  // 开合动画期间置真：内容淡出，避免宽度过渡时的重排观感
  const [animating, setAnimating] = useState(false);
  const animTimer = useRef(null);

  useEffect(() => () => clearTimeout(animTimer.current), []);

  function toggle() {
    setAnimating(true);
    clearTimeout(animTimer.current);
    animTimer.current = setTimeout(() => setAnimating(false), 260);
    onToggle();
  }

  // 收起侧栏时底部浮层一并关掉
  useEffect(() => {
    if (!collapsed) return;
    setDataPop(null);
  }, [collapsed]);

  // 任何弹窗打开都收起浮层：Ctrl+/ 打开快捷键设置不经过菜单点击，
  // 浮层 z-index 高于弹窗遮罩，留着会压在弹窗上
  useEffect(() => {
    if (!modalOpen) return;
    setDataPop(null);
  }, [modalOpen]);

  // 底部浮层：点外部 / Esc / 缩放窗口都关闭；浮层本身与触发按钮不触发外部关闭
  useEffect(() => {
    if (!dataPop) return undefined;
    const onDown = (e) => {
      if (dataPopRef.current && dataPopRef.current.contains(e.target)) return;
      setDataPop(null);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setDataPop(null);
    };
    const onResize = () => setDataPop(null);
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    };
  }, [dataPop]);

  /** 底部入口：浮层贴着按钮上沿弹出，左缘对齐侧栏内边距 */
  function toggleDataPop(e) {
    if (dataPop) {
      setDataPop(null);
      return;
    }
    const r = e.currentTarget.getBoundingClientRect();
    const w = 232;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
    setDataPop({ left, bottom: window.innerHeight - r.top + 4 });
  }

  /** 拖拽落点：按可见行（未归档）的纵向中点计算插入位置 */
  function dropIndexAt(clientY) {
    const rows = listRef.current ? listRef.current.querySelectorAll('.pitem[data-pid]') : [];
    for (let i = 0; i < rows.length; i += 1) {
      const r = rows[i].getBoundingClientRect();
      if (clientY < r.top + r.height / 2) return i;
    }
    return rows.length;
  }

  function startRowDrag(e, p) {
    clearRowHover();
    // 收起成图标窄栏时不排序：没有可读的项目名，拖拽目标也无法确认
    if (collapsed) {
      e.preventDefault();
      return;
    }
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', p.id);
    }
    setDragId(p.id);
    setDropAt(null);
  }

  function overList(e) {
    if (!dragId) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    const at = dropIndexAt(e.clientY);
    if (at !== dropAt) setDropAt(at);
  }

  function leaveList(e) {
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setDropAt(null);
  }

  function endRowDrag() {
    setDragId(null);
    setDropAt(null);
  }

  function dropList(e) {
    if (!dragId) return;
    e.preventDefault();
    const at = dropIndexAt(e.clientY);
    const moved = dragId;
    endRowDrag();
    const ids = projects.map((p) => p.id);
    const from = ids.indexOf(moved);
    if (from < 0) return;
    // 光标落在自身下半区时 at === from + 1，扣掉自己后落点其实没变
    const to = from < at ? at - 1 : at;
    if (to === from) return;
    const next = ids.slice();
    next.splice(from, 1);
    next.splice(to, 0, moved);
    onReorderProjects(next);
  }

  /** 导航角标口径与需求页「未完成」页签一致：todo + doing + review */
  const unfinishedTotal = projects.reduce(
    (a, p) => a + (p.todoCount || 0) + (p.doingCount || 0) + (p.reviewCount || 0),
    0
  );
  // 拖到自己原位（前 / 后）等于没动，此时不画插入提示线
  const dragIndex = dragId ? projects.findIndex((p) => p.id === dragId) : -1;
  const lineAt = dropAt != null && dropAt !== dragIndex && dropAt !== dragIndex + 1 ? dropAt : null;

  /** 项目行状态灯：三类待处理事项各一盏，点自己那盏直接跳到对应视图。
   *  口径不随当前页面变化——「在哪个视图」与「哪个项目有事」是两个正交维度。
   *  tone 上必须带 plight- 前缀：裸的 run / dirty 会撞上启动台与别处的同名类（`.run` 带 padding:0 9px）。
   *  需求灯形态跟「有没有在动」对齐（多条未完成并存时按待审核 > 进行中 > 未开始只亮一盏，
   *  优先提醒需要你处理的那一档，其余状态在本页列表里看）：
   *  未开始＝静态蓝点（排队中）、进行中＝呼吸蓝点、待审核＝静态中空大环（停住等你批）。
   *  未提交改动同理只留静态橙点，运行中才保留呼吸。
   *
   *  远程落后与本地未提交共用「修改记录」这一盏灯：两者都要在这一页里处理，
   *  而 6px 色点的色板（蓝 / 橙 / 绿 / 青 / 靛蓝）已经用满，不再为它加第六种语义色。
   *  区别只写在文案里：本地看「N 个未提交」，远程看「远程 ↓N」。 */
  const files = dirtyFiles || {};
  const behinds = behindMap || {};
  function lightsOf(p) {
    const out = [];
    const dirty = files[p.id] || 0;
    const behind = behinds[p.id] || 0;
    const running = p.runningCount || 0;
    const add = (tone, view, label, state, tip) =>
      out.push({ tone, state, view, label, tip: (tip || label) + ' · 点击打开' + VIEW_LABEL[view] });
    if (dirty > 0 || behind > 0) {
      const parts = [];
      const tips = [];
      if (dirty > 0) {
        parts.push(dirty + ' 个未提交');
        tips.push(dirty + ' 个未提交文件');
      }
      if (behind > 0) {
        parts.push('远程 ' + behindBadge(behind));
        // 箭头方向别让人猜：tooltip 里写成完整的一句话
        tips.push(behindTip(behind));
      }
      add('plight-dirty', 'changes', parts.join(' · '), undefined, tips.join(' · '));
    }
    const review = p.reviewCount || 0;
    const asking = p.questionCount || 0;
    const doing = p.doingCount || 0;
    const todo = p.todoCount || 0;
    // 待回答与待审核一样是「卡在我手上」：同一个需求灯只亮一盏，优先级 待审核 > 待回答 > 进行中 > 未开始
    if (review > 0) add('plight-req', 'req', review + ' 条待审核', 'is-review');
    else if (asking > 0) add('plight-req', 'req', asking + ' 条待回答', 'is-review');
    else if (doing > 0) add('plight-req', 'req', '进行中');
    else if (todo > 0) add('plight-req', 'req', '未开始', 'is-todo');
    if (running > 0) add('plight-run', 'launch', running + ' 个运行中');
    return out;
  }

  /** 有未拉取提交的项目数：底部「设置与数据」入口与「代码同步」项共用一个口径 */
  const behindProjects = Object.keys(behinds).length;

  /** 项目行悬停提示：路径 + 灯的含义 + 候选池条数。
   *  必须挂在整行上——灯在 hover 时会被「更多操作」按钮挤向左侧（不是被顶掉），
   *  但 6px 的圆点做不了悬停靶子，明细只能落在行上。
   *  候选池不计入未完成、也不亮灯，只能在行内角标与这里体现，否则折叠侧栏时完全看不到。 */
  function rowTitle(p, lights) {
    const lines = [collapsed ? p.name + ' · ' + p.path : p.path];
    const stacks = (p.stacks || []).map((id) => PROJECT_STACK_LABELS[id]).filter(Boolean);
    if (stacks.length) lines.push('技术栈：' + stacks.join(' · '));
    else if (PROJECT_KIND_LABELS[p.kind]) lines.push(PROJECT_KIND_LABELS[p.kind]);
    if (p.aiScout === false) lines.push('AI 巡检已停用：不会自动提需求');
    if (lights.length) lines.push(lights.map((l) => l.label).join(' · '));
    if (p.candidateCount > 0) lines.push('候选池 ' + p.candidateCount + ' 条（未确认，不派给 agent）');
    return lines.join('\n');
  }

  /** 收起悬停卡片与待触发的定时器（点击项目行、滚动、缩放这类明确要关的动作） */
  function clearRowHover() {
    clearTimeout(hoverTimer.current);
    clearTimeout(hoverCloseTimer.current);
    setHoverCard(null);
  }

  /** 鼠标划进卡片：撤掉行离开时安排的那次收起，停在卡上看多久都不收 */
  function cancelRowHoverClose() {
    clearTimeout(hoverCloseTimer.current);
  }

  /** 鼠标离开行 / 卡片：留 160ms 过路时间，让鼠标能跨过那点空隙划进卡里 */
  function scheduleRowHoverClose() {
    clearTimeout(hoverCloseTimer.current);
    hoverCloseTimer.current = setTimeout(() => {
      clearTimeout(hoverTimer.current);
      setHoverCard(null);
    }, 160);
  }

  /** 停留 240ms 后再出卡，避免鼠标扫过列表时一路闪 */
  function enterRow(e, p) {
    cancelRowHoverClose();
    clearTimeout(hoverTimer.current);
    setHoverCard(null);
    const row = e.currentTarget;
    hoverTimer.current = setTimeout(() => {
      if (!row.isConnected) return;
      const rect = row.getBoundingClientRect();
      const width = 286;
      const gap = 10;
      const roomRight = window.innerWidth - rect.right;
      const left = roomRight >= width + gap + 8 ? rect.right + gap : Math.max(8, rect.left - width - gap);
      const top = Math.max(8, Math.min(rect.top - 4, window.innerHeight - 8 - 340));
      setHoverCard({
        project: p,
        color: avatarColor(projects, p.id),
        dirty: files[p.id] || 0,
        behind: behinds[p.id] || 0,
        left,
        top
      });
    }, 240);
  }

  return (
    <aside
      className={
        'side' + (collapsed ? ' collapsed' : '') + (animating ? ' animating' : '')
      }
      style={{ width }}
    >
      <div className="brand">
        <div className="brand-txt">
          <div className="brand-name">项目管理台</div>
          {version ? (
            <div className="brand-ver" title={'当前版本 v' + version}>
              v{version}
            </div>
          ) : null}
        </div>
        <button
          className="toggle"
          onClick={toggle}
          title={collapsed ? '展开侧栏' : '收起侧栏'}
          aria-label={collapsed ? '展开侧栏' : '收起侧栏'}
        >
          <PanelIcon side="left" open={!collapsed} />
        </button>
      </div>

      {/* 只剩「总览」一项：它表示「不选某个具体项目」，属于项目维度；
          需求中心 / 启动台 / 修改记录 是选中项目后的下级视图，入口在中区标题下拉 */}
      <nav className="nav">
        <div
          className={'nav-item' + (page === 'overview' ? ' active' : '')}
          onClick={() => onNav('overview')}
          title={collapsed ? '总览' : '全部项目一览'}
          role="button"
          tabIndex={0}
        >
          <span className="ico">{IC.grid}</span>
          <span className="label">总览</span>
          <span className="cnt" title={unfinishedTotal + ' 个未完成需求'}>
            {unfinishedTotal}
          </span>
        </div>
        <div
          className={'nav-item' + (page === 'statistics' ? ' active' : '')}
          onClick={() => onNav('statistics')}
          title={collapsed ? '统计' : '代码提交与需求处理统计'}
          role="button"
          tabIndex={0}
        >
          <span className="ico">{IC.chart}</span>
          <span className="label">统计</span>
        </div>
      </nav>

      <div className="side-sec">
        <span className="lbl">项目</span>
        <div className="acts">
          <button className="addbtn" onClick={onNewProject} title="新建项目" aria-label="新建项目">
            {IC.plusSmall}
          </button>
        </div>
      </div>

      <div
        className="plist"
        ref={listRef}
        onDragOver={overList}
        onDragLeave={leaveList}
        onDrop={dropList}
      >
        {projects.map((p, i) => {
          const lights = lightsOf(p);
          const dropCls =
            lineAt === i
              ? ' drop-before'
              : lineAt === projects.length && i === projects.length - 1
                ? ' drop-after'
                : '';
          return (
            <div
              key={p.id}
              className={
                'pitem' +
                (currentId === p.id ? ' active' : '') +
                (dragId === p.id ? ' dragging' : '') +
                dropCls
              }
              data-pid={p.id}
              aria-label={rowTitle(p, lights)}
              onMouseEnter={(e) => enterRow(e, p)}
              onMouseLeave={scheduleRowHoverClose}
              onClick={() => {
                clearRowHover();
                onSelect(p.id);
              }}
            >
              {/* 只有图标是拖动把手：整行可拖会让悬停抓手铺满列表，观感太重 */}
              <span
                className="pdrag"
                draggable={!collapsed}
                onDragStart={(e) => startRowDrag(e, p)}
                onDragEnd={endRowDrag}
              >
                <ProjectIcon project={p} color={avatarColor(projects, p.id)} />
              </span>
              <span className="pname">
                <span className="pname-txt">{p.name}</span>
                <ProjectStackIcon project={p} />
              </span>
              {/* 候选池角标：不进未完成、不亮灯，只有这里能一眼看到「攒了几条想法」。
                  只放数字——项目行宽度有限，加「候选」二字会把项目名挤短；
                  含义交给行 tooltip 与悬停提示，不与「AI 停」这类文字徽标争位置。
                  点它仍然是整行点击（进该项目需求中心），不额外做跳转入口 */}
              {p.candidateCount > 0 ? (
                <span
                  className="pcand"
                  title={'候选池 ' + p.candidateCount + ' 条（未确认，不派给 agent）· 在需求中心的「候选池」页签查看'}
                >
                  {p.candidateCount}
                </span>
              ) : null}
              {p.aiScout === false ? (
                <span className="pai" title="AI 巡检已停用：不会自动提需求">
                  AI 停
                </span>
              ) : null}
              {lights.length ? (
                <span className="plights">
                  {lights.map((l) => (
                    <button
                      key={l.tone}
                      className="plight-btn"
                      title={l.tip}
                      aria-label={l.tip}
                      onClick={(e) => {
                        // 灯自己就是入口：不要连带触发行选中（那只会改 pid，页面不动）
                        e.stopPropagation();
                        onOpenView(p, l.view);
                      }}
                    >
                      <i className={'plight ' + l.tone + (l.state ? ' ' + l.state : '')} />
                    </button>
                  ))}
                </span>
              ) : null}
              {/* 菜单按钮排在灯之后：展开时占住行尾，把灯挤向左，而不是把灯顶掉 */}
              <ProjectMenu
                project={p}
                buttonClassName="pmenu"
                onEdit={onEditProject}
                onOpenTerminal={onOpenTerminal}
                onReveal={onReveal}
                onArchive={onArchiveProject}
              />
            </div>
          );
        })}
        {projects.length === 0 ? (
          <div className="pitem" style={{ cursor: 'default', color: 'var(--label-3)' }}>
            <span className="pname">还没有项目</span>
          </div>
        ) : null}

        {!collapsed && archivedProjects.length > 0 ? (
          <div className="parch">
            <button
              className="parch-toggle"
              onClick={() => setArchivedOpen((v) => !v)}
              aria-expanded={archivedOpen}
              title={archivedOpen ? '收起已归档项目' : '展开已归档项目'}
            >
              <span className="chev">{IC.chevDown}</span>
              <span className="lbl">已归档</span>
              <span className="cnt">{archivedProjects.length}</span>
            </button>
            {archivedOpen ? (
              <div className="parch-list">
                {archivedProjects.map((p) => (
                  <div className="pitem parch-item" key={p.id} title={p.path}>
                    <ProjectIcon project={p} color={avatarColor(archivedProjects, p.id)} />
                    <span className="pname">
                      <span className="pname-txt">{p.name}</span>
                      <ProjectStackIcon project={p} />
                    </span>
                    <button
                      className="parch-restore"
                      disabled={restoringId === p.id}
                      title={'恢复项目 ' + p.name}
                      onClick={(e) => {
                        e.stopPropagation();
                        setRestoringId(p.id);
                        Promise.resolve(onRestoreProject(p)).finally(() => setRestoringId(null));
                      }}
                    >
                      {restoringId === p.id ? '恢复中…' : '恢复'}
                    </button>
                    {/* disabled 的按钮收不到 hover，原因用 title 挂在外面这层上 */}
                    <span
                      className="parch-tip"
                      title={
                        deletingId === p.id
                          ? '正在删除…'
                          : armedId === p.id
                            ? '再点一次彻底删除登记（不动磁盘上的项目文件）'
                            : '彻底删除项目登记'
                      }
                    >
                      <button
                        className={'parch-del' + (armedId === p.id ? ' armed' : '')}
                        disabled={deletingId === p.id}
                        aria-label="彻底删除项目登记"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (deletingId === p.id) return;
                          if (armedId !== p.id) {
                            setArmedId(p.id);
                            return;
                          }
                          setArmedId(null);
                          setDeletingId(p.id);
                          Promise.resolve(onDeleteProject(p)).finally(() => {
                            setDeletingId(null);
                            setArmedId(null);
                          });
                        }}
                      >
                        {deletingId === p.id ? <span className="parch-wait">…</span> : IC.trash}
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="side-data" ref={dataPopRef}>
        <button
          className={'side-data-toggle' + (dataPop ? ' on' : '')}
          onClick={toggleDataPop}
          aria-expanded={!!dataPop}
          aria-haspopup="true"
          aria-label={dataPop ? '收起设置与数据' : '展开设置与数据'}
          title={
            dataPop
              ? '收起：备份与恢复 / 通知设置 / 代码同步 / AI 接入 / 键盘快捷键 / 审计日志 / 检查更新'
              : '备份与恢复 / 通知设置 / 代码同步 / AI 接入 / 键盘快捷键 / 审计日志 / 检查更新'
          }
        >
          <span className="ico">{IC.gear}</span>
          <span className="lbl">设置与数据</span>
          {/* 两个提示点各管一件事：橙＝有代码没拉，蓝＝有新版本可装。
              排在标题右侧统一用「有东西等你处理」的语义，不抢主标签的宽度 */}
          {behindProjects > 0 ? (
            <span
              className="side-data-dot is-git"
              title={behindProjects + ' 个项目有未拉取的远程提交'}
            />
          ) : null}
          {updatePhase === 'available' || updatePhase === 'downloaded' ? (
            <span className="side-data-dot" title="有新版本可装" />
          ) : null}
          <span className="chev">{IC.chevDown}</span>
        </button>
        {dataPop ? (
          <div
            className="datapop"
            style={{ left: dataPop.left, bottom: dataPop.bottom }}
            role="menu"
            aria-label="设置与数据"
          >
            <div className="datapop-group">
              <div className="datapop-hd">数据</div>
              <button
                className="datapop-item"
                role="menuitem"
                onClick={() => {
                  setDataPop(null);
                  onOpenBackup();
                }}
                title="查看最近 7 天快照与手动安全备份，一键恢复"
              >
                <span className="ico">{IC.archive}</span>
                备份与恢复
              </button>
              <button
                className="datapop-item"
                role="menuitem"
                onClick={() => {
                  setDataPop(null);
                  onOpenDataDir();
                }}
                title="在系统文件管理器中打开数据目录（db.json / backups / runs）"
              >
                <span className="ico">{IC.folder}</span>
                数据文件
              </button>
            </div>
            <div className="datapop-group">
              <div className="datapop-hd">通知与集成</div>
              <button
                className="datapop-item"
                role="menuitem"
                onClick={() => {
                  setDataPop(null);
                  onOpenNotifications();
                }}
                title="配置待审核、命令异常与 AI 新需求的系统通知"
              >
                <span className="ico">{IC.bell}</span>
                通知设置
              </button>
              <button
                className="datapop-item"
                role="menuitem"
                onClick={() => {
                  setDataPop(null);
                  onOpenGitSettings();
                }}
                title={
                  '配置软件启动时是否自动拉取代码，并查看最近一轮结果' +
                  (behindProjects ? ' · 当前 ' + behindProjects + ' 个项目有未拉取的提交' : '')
                }
              >
                <span className="ico">{IC.pull}</span>
                代码同步
                {behindProjects > 0 ? (
                  <span className="tail">
                    <span className="side-data-dot is-git" />
                    {behindProjects}
                  </span>
                ) : null}
              </button>
              <button
                className="datapop-item"
                role="menuitem"
                onClick={() => {
                  setDataPop(null);
                  onOpenMcp();
                }}
                title="查看 MCP 接入配置，复制配置或复制 AI 提示词"
              >
                <span className="ico">{IC.plug}</span>
                AI 接入
              </button>
            </div>
            <div className="datapop-group">
              <div className="datapop-hd">界面</div>
              <button
                className="datapop-item"
                role="menuitem"
                onClick={() => {
                  setDataPop(null);
                  onOpenShortcuts();
                }}
                title={'查看与修改全局快捷键' + (shortcutsHint ? ' · 当前 ' + shortcutsHint : '')}
              >
                <span className="ico">{IC.keys}</span>
                键盘快捷键
                <span className="tail">{shortcutsHint || null}</span>
              </button>
              {/* 外观 / 皮肤：各一行入口 + 右侧二级菜单。右侧常显当前值，选中态另有勾选图标与字重，
                  不只靠颜色；选完只收子菜单，浮层留着让用户当场看到界面变化。 */}
              <div className="theme-wrap" ref={subWrapRef} onMouseLeave={scheduleCloseSub}>
                <button
                  ref={themeRowRef}
                  className="datapop-item"
                  role="menuitem"
                  aria-haspopup="menu"
                  aria-expanded={openSub === 'theme'}
                  onClick={() => (openSub === 'theme' ? closeSub() : openSubMenu('theme', true))}
                  onMouseEnter={() => openSubMenu('theme', false)}
                  onKeyDown={onSubRowKeyDown('theme')}
                  title={'外观：' + THEME_LABELS[theme] + '，可选跟随系统 / 浅色 / 深色'}
                >
                  <span className="ico">{themeIcon}</span>
                  外观
                  <span className="tail">
                    {THEME_LABELS[theme]}
                    {IC.chev}
                  </span>
                </button>
                <button
                  ref={skinRowRef}
                  className="datapop-item"
                  role="menuitem"
                  aria-haspopup="menu"
                  aria-expanded={openSub === 'skin'}
                  onClick={() => (openSub === 'skin' ? closeSub() : openSubMenu('skin', true))}
                  onMouseEnter={() => openSubMenu('skin', false)}
                  onKeyDown={onSubRowKeyDown('skin')}
                  title={'皮肤：' + SKIN_LABELS[skin] + '，浅色界面的配色方案（清透 / 暖纸 / 活力），深色模式不生效'}
                >
                  <span className="ico">{IC.skin}</span>
                  皮肤
                  <span className="tail">
                    {SKIN_LABELS[skin]}
                    {IC.chev}
                  </span>
                </button>
                {openSub && subPos ? (
                  <div
                    ref={subRef}
                    className="theme-sub"
                    style={{ left: subPos.left, bottom: subPos.bottom }}
                    role="menu"
                    aria-label={openSub === 'skin' ? '皮肤' : '外观'}
                    onMouseEnter={() => clearTimeout(subCloseTimer.current)}
                    onMouseLeave={scheduleCloseSub}
                    onKeyDown={onSubKeyDown}
                    onBlur={onSubBlur}
                  >
                    {openSub === 'theme'
                      ? THEMES.map((key) => {
                          const active = theme === key;
                          return (
                            <button
                              key={key}
                              className="datapop-item theme-opt"
                              role="menuitemradio"
                              aria-checked={active}
                              onClick={() => {
                                onSetTheme(key);
                                closeSub();
                                themeRowRef.current?.focus();
                              }}
                              title={
                                key === 'system'
                                  ? '跟随系统的浅色/深色设置，系统切换时界面实时跟随'
                                  : key === 'light'
                                    ? '始终使用浅色界面'
                                    : '始终使用深色界面'
                              }
                            >
                              <span className="ico">
                                {key === 'system' ? IC.auto : key === 'light' ? IC.sun : IC.moon}
                              </span>
                              {THEME_LABELS[key]}
                              <span className="tail">{active ? IC.check : null}</span>
                            </button>
                          );
                        })
                      : (
                        <>
                          {SKINS.map((key) => {
                            const active = skin === key;
                            return (
                              <button
                                key={key}
                                className="datapop-item theme-opt"
                                role="menuitemradio"
                                aria-checked={active}
                                onClick={() => {
                                  onSetSkin(key);
                                  closeSub();
                                  skinRowRef.current?.focus();
                                }}
                                title={
                                  key === 'crisp'
                                    ? '清透：略深冷灰底 + 纯白卡片强分层，最贴近原风格'
                                    : key === 'warm'
                                      ? '暖纸：暖纸底 + 暖墨字 + 琥珀强调，温润耐看'
                                      : '活力：纯白 + 电光蓝强调 + 最强对比（默认）'
                                }
                              >
                                <span className="ico">
                                  <span className={'skin-sw skin-sw-' + key} aria-hidden="true" />
                                </span>
                                {SKIN_LABELS[key]}
                                <span className="tail">{active ? IC.check : null}</span>
                              </button>
                            );
                          })}
                          <div className="theme-sub-hint">皮肤仅用于浅色模式</div>
                        </>
                      )}
                  </div>
                ) : null}
              </div>
            </div>
            <div className="datapop-group">
              <div className="datapop-hd">记录与关于</div>
              <button
                className="datapop-item"
                role="menuitem"
                onClick={() => {
                  setDataPop(null);
                  onOpenAudit();
                }}
                title="查看项目、需求、命令与数据恢复的只读记录"
              >
                <span className="ico">{IC.list}</span>
                审计日志
              </button>
              <button
                className="datapop-item"
                role="menuitem"
                onClick={() => {
                  setDataPop(null);
                  onOpenUpdate();
                }}
                title="检查更新、下载并重启安装；出问题时可以导出诊断包"
              >
                <span className="ico">{IC.refresh}</span>
                检查更新
                <span className="tail">
                  {updatePhase === 'available' || updatePhase === 'downloaded' ? (
                    <span className="side-data-dot" title="有新版本可装" />
                  ) : null}
                  {version ? 'v' + version : null}
                </span>
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {hoverCard ? (
        <ProjectHoverCard
          project={hoverCard.project}
          color={hoverCard.color}
          dirty={hoverCard.dirty}
          behind={hoverCard.behind}
          left={hoverCard.left}
          top={hoverCard.top}
          onEnter={cancelRowHoverClose}
          onLeave={scheduleRowHoverClose}
        />
      ) : null}
    </aside>
  );
}

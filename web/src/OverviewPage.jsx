import { useEffect, useRef, useState } from 'react';
import ProjectMenu from './components/ProjectMenu.jsx';
import { STATUS } from './constants.js';
import { avatarColor, fmtDuration, isCommandActive, runExitLabel } from './format.js';
import { IC } from './icons.jsx';
import { behindBadge, behindTip } from './lib/git-view.js';
import { Empty, ProjectIcon, ProjectStackIcon } from './ui.jsx';

const pad = (n) => String(n).padStart(2, '0');

/** 相对时间：总览里“3 小时前”比绝对时间更好扫；超过一周退回日期 */
function fmtAgo(iso) {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  const ms = Date.now() - t;
  if (ms < 60000) return '刚刚';
  const min = Math.floor(ms / 60000);
  if (min < 60) return min + ' 分钟前';
  const h = Math.floor(min / 60);
  if (h < 24) return h + ' 小时前';
  const d = Math.floor(h / 24);
  if (d < 7) return d + ' 天前';
  const dt = new Date(iso);
  return pad(dt.getMonth() + 1) + '-' + pad(dt.getDate());
}

/** 路径只留最后两段：项目列只需要“哪个目录”，完整路径交给 title */
function shortPath(p) {
  const parts = String(p || '').split(/[\\/]+/).filter(Boolean);
  if (parts.length <= 2) return p || '';
  return '…\\' + parts.slice(-2).join('\\');
}

/** 浮层关闭：点外部或 Esc */
function useDismiss(open, setOpen, ref) {
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (ref.current && ref.current.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, setOpen, ref]);
}

/**
 * 启停按钮：只有一条候选时直接执行；多条时展开选。
 * 停止时传入的是「正在运行的那些命令」，启动时是全部命令。
 */
function CmdButton({ items, label, tone, busy, onPick }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useDismiss(open, setOpen, ref);

  const single = items.length === 1;
  return (
    <div className="ov-dd" ref={ref}>
      <button
        className={'btn sm ' + (tone === 'danger' ? 'stop' : 'start')}
        disabled={busy}
        title={single ? items[0].text : '选择要' + label + '的命令'}
        onClick={() => (single ? onPick(items[0]) : setOpen((v) => !v))}
      >
        {label}
        {single ? null : IC.chevDown}
      </button>
      {open ? (
        <div className="ov-dd-menu" role="menu">
          {items.map((c) => (
            <button
              key={c.id}
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onPick(c);
              }}
            >
              <span className="t" style={c.name ? { fontFamily: 'inherit' } : undefined}>
                {c.name || c.text}
              </span>
              <span className="s">
                {c.status === 'running' ? '运行中' : isCommandActive(c) ? '已分离' : '已停止'}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ProjectRow({ p, projects, git, onOpen, onStart, onStop, onEditProject, onReveal, onOpenTerminal }) {
  const cmds = p.commands || [];
  /** 在跑的（含分离仍存活）：既能展示也都能停 —— 分离的按库里 hostPid 结束进程树 */
  const running = cmds.filter(isCommandActive);
  const primary = running[0] || null;
  const last = cmds.reduce((acc, c) => {
    const lr = c.lastRun;
    if (!lr || !lr.startedAt) return acc;
    if (!acc || lr.startedAt > acc.startedAt) return lr;
    return acc;
  }, null);

  const [busy, setBusy] = useState(false);

  async function act(fn, c) {
    setBusy(true);
    try {
      await fn(c);
    } finally {
      setBusy(false);
    }
  }

  /* 未完成可能有任意多条，总览只给分布：按待审核 > 进行中 > 未开始挑最该看的一档 */
  const pending = p.pendingCount || 0;
  const focus = p.reviewCount ? 'review' : p.doingCount ? 'doing' : p.todoCount ? 'todo' : null;
  const focusCount = focus ? p[focus + 'Count'] : 0;
  const spread = [
    p.questionCount ? '待回答 ' + p.questionCount : '',
    p.reviewCount ? '待审核 ' + p.reviewCount : '',
    p.doingCount ? '进行中 ' + p.doingCount : '',
    p.todoCount ? '未开始 ' + p.todoCount : '',
    p.candidateCount ? '候选 ' + p.candidateCount : ''
  ]
    .filter(Boolean)
    .join(' · ');
  /* 候选池不进未完成口径：没有待处理需求时它就是唯一的看点 */
  const candCount = p.candidateCount || 0;

  const sample = (git && git.sample) || [];

  /* 单元格只剩一行，细节全部收进 tooltip */
  const changeTip = !git
    ? '等待统计'
    : git.pathMissing
      ? '项目目录不存在，点击修改路径'
      : !git.isRepo
        ? '非 git 仓库，无法统计改动'
        : [
            git.files
              ? sample.map((s) => s.path).join('\n') + (git.files > sample.length ? '\n…' : '')
              : '',
            git.behind ? behindTip(git.behind) : ''
          ]
            .filter(Boolean)
            .join('\n\n') || '与 HEAD 一致';

  const runTip = primary
    ? (primary.name ? primary.name + ' · ' + primary.text : primary.text) +
      ' · 已运行 ' +
      fmtDuration(primary.lastRun && primary.lastRun.startedAt) +
      (running.length > 1 ? ' · 另有 ' + (running.length - 1) + ' 条在跑' : '')
    : !cmds.length
      ? '去启动台添加命令'
      : last
        ? '上次：' + runExitLabel(last) + ' · ' + fmtAgo(last.startedAt)
        : '从未运行';

  return (
    <div className="ov-row">
      <div
        className="ov-who"
        onClick={() => onOpen(p, 'req', null)}
        title="在需求中心查看这个项目"
        role="button"
        tabIndex={0}
      >
        <ProjectIcon project={p} color={avatarColor(projects, p.id)} size={22} />
        <div className="txt">
          <div className="nm">
            <span className="ov-name">{p.name}</span>
            <ProjectStackIcon project={p} />
          </div>
          <div className="path" title={p.path}>
            {shortPath(p.path)}
          </div>
        </div>
      </div>

      {/* 未完成分布：单行只亮最该看的一档，完整分布收进 tooltip */}
      <div
        className="ov-cell"
        onClick={() => onOpen(p, 'req', null)}
        title={'在需求中心查看' + (spread ? ' · ' + spread : '')}
      >
        <div className="l1">
          {focus ? (
            <span className={'pill ov-req ' + STATUS[focus].cls}>
              {STATUS[focus].label}
              {focusCount > 1 ? <span className="rid">×{focusCount}</span> : null}
            </span>
          ) : candCount ? (
            <span className="ov-muted">候选 {candCount} 条</span>
          ) : (
            <span className="ov-muted">暂无未完成</span>
          )}
          {pending > focusCount ? <span className="ov-sub tabular">共 {pending} 条</span> : null}
        </div>
      </div>

      {/* 未提交改动：本地未提交与远程未拉取都归这一列 —— 处理它们的地方是同一个页面 */}
      <div
        className="ov-cell"
        onClick={() => (git && git.pathMissing ? onEditProject(p) : onOpen(p, 'changes', null))}
        title={changeTip}
      >
        <div className="l1">
          {!git ? (
            <span className="ov-muted">—</span>
          ) : git.pathMissing ? (
            <span className="ov-muted">路径失效</span>
          ) : !git.isRepo ? (
            <span className="ov-muted">非 git 仓库</span>
          ) : git.files ? (
            <span className="ov-nfile tabular">
              {git.files}
              <span className="unit">个文件</span>
            </span>
          ) : (
            <span className="ov-muted">干净</span>
          )}
          {/* 远程差量：与修改记录页「拉取」按钮的 ↓N 同一口径 */}
          {git && git.isRepo && git.behind ? (
            <span className="ov-behind" title={behindTip(git.behind)}>
              {behindBadge(git.behind)}
            </span>
          ) : null}
        </div>
      </div>

      {/* 运行状态 */}
      <div className="ov-cell" onClick={() => onOpen(p, 'launch', null)} title={runTip}>
        <div className="l1">
          {primary ? (
            <>
              <span className="ov-live">
                <i />
                {running.length}/{cmds.length}
              </span>
              <span className="cmdname">{primary.name || primary.text}</span>
            </>
          ) : !cmds.length ? (
            <span className="ov-muted">未配置命令</span>
          ) : (
            <>
              <span className="ov-muted">未运行</span>
              <span className="ov-sub tabular">
                0/{cmds.length}
              </span>
            </>
          )}
        </div>
      </div>

      <div className="ov-acts">
        {running.length ? (
          <CmdButton items={running} label="停止" tone="danger" busy={busy} onPick={(c) => act(onStop, c)} />
        ) : cmds.length ? (
          <CmdButton items={cmds} label="启动" busy={busy} onPick={(c) => act(onStart, c)} />
        ) : null}
        <ProjectMenu
          project={p}
          buttonClassName="btn sm icon"
          onEdit={onEditProject}
          onOpenTerminal={onOpenTerminal}
          onReveal={onReveal}
        />
      </div>
    </div>
  );
}

/**
 * 总览：三类状态同屏，一项目一行。
 * 没有筛选器、没有行内展开——细节通过点击对应列直达三页，避免多次上下文切换。
 */
export default function OverviewPage({
  projects,
  gitSummary,
  onOpen,
  onStart,
  onStop,
  onEditProject,
  onReveal,
  onOpenTerminal,
  onCreateProject
}) {
  const [idleOpen, setIdleOpen] = useState(false);

  const gitMap = {};
  if (gitSummary && Array.isArray(gitSummary.projects)) {
    for (const g of gitSummary.projects) gitMap[g.id] = g;
  }

  const rows = projects
    .map((p, i) => {
      const g = gitMap[p.id] || null;
      const files = g && g.isRepo ? g.files || 0 : 0;
      const behind = g && g.isRepo ? g.behind || 0 : 0;
      const running = (p.commands || []).filter(isCommandActive).length;
      const score =
        (p.reviewCount ? 5 : 0) +
        (p.doingCount ? 4 : 0) +
        (p.todoCount ? 2 : 0) +
        (running ? 3 : 0) +
        (files ? 2 : 0) +
        // 路径失效要修，别让它跟着「干净」项目沉到空闲组里
        (g && g.pathMissing ? 2 : 0) +
        // 有待拉取的提交也算「有事」：否则它会沉到空闲组里，正是这次要修的问题
        (behind ? 2 : 0);
      // 只有「明确干净」才算空闲：git 还没拿到时不能假设它没改动；
      // 远程落后同理 —— 没检查过不代表没有待拉取的提交，但也不能据此判成忙碌，
      // 所以只在确实读到 behind > 0 时才算不空闲。
      const idle =
        !p.pendingCount && !running && !!g && !(g.isRepo && g.files > 0) && !behind && !g.pathMissing;
      return { p, g, score, i, idle };
    })
    .sort((a, b) => b.score - a.score || a.i - b.i);

  const active = rows.filter((r) => !r.idle);
  const idle = rows.filter((r) => r.idle);

  const pending = projects.reduce((a, p) => a + (p.pendingCount || 0), 0);
  const review = projects.reduce((a, p) => a + (p.reviewCount || 0), 0);
  const doing = projects.reduce((a, p) => a + (p.doingCount || 0), 0);
  const todo = projects.reduce((a, p) => a + (p.todoCount || 0), 0);
  const dirtyProj = rows.filter((r) => r.g && r.g.isRepo && r.g.files > 0).length;
  const dirtyFiles = rows.reduce((a, r) => a + (r.g && r.g.isRepo ? r.g.files || 0 : 0), 0);
  const behindProj = rows.filter((r) => r.g && r.g.isRepo && r.g.behind > 0).length;
  const behindCommits = rows.reduce((a, r) => a + (r.g && r.g.isRepo ? r.g.behind || 0 : 0), 0);
  const runningProj = rows.filter((r) => (r.p.commands || []).some(isCommandActive)).length;
  const runningCmds = rows.reduce(
    (a, r) => a + (r.p.commands || []).filter(isCommandActive).length,
    0
  );
  const totalCmds = projects.reduce((a, p) => a + (p.commandCount || 0), 0);

  if (!projects.length) {
    return (
      <div className="wrap">
        <Empty
          title="还没有登记任何项目"
          desc="新建一个项目后，这里会汇总它的需求、改动与运行状态。"
          icon={IC.folder}
        >
          <button className="btn sm primary" onClick={onCreateProject}>
            {IC.plus}新建项目
          </button>
        </Empty>
      </div>
    );
  }

  const rowProps = { projects, onOpen, onStart, onStop, onEditProject, onReveal, onOpenTerminal };

  return (
    <div className="wrap">
      <div className="ov-stats">
        <div className="ov-stat">
          <span className="k">待处理需求</span>
          <span className="v tabular">
            {pending}
            <em>项</em>
          </span>
          <span className="s">
            {review ? review + ' 待审核 · ' : ''}
            {doing} 进行中 · {todo} 未开始
          </span>
        </div>
        <div className="ov-stat">
          <span className="k">有改动项目</span>
          <span className="v tabular">
            {dirtyProj}
            <em>个</em>
          </span>
          <span className="s">
            共 {dirtyFiles} 个未提交文件
            {behindProj ? ' · ' + behindProj + ' 个项目待拉取 ' + behindCommits + ' 个提交' : ''}
          </span>
        </div>
        <div className="ov-stat">
          <span className="k">运行中项目</span>
          <span className="v tabular">
            {runningProj}
            <em>个</em>
          </span>
          <span className="s">
            {runningCmds} 条在跑 · 共 {totalCmds} 条脚本
          </span>
        </div>
        <div className="ov-stat">
          <span className="k">空闲项目</span>
          <span className="v tabular">
            {idle.length}
            <em>个</em>
          </span>
          <span className="s">{idle.length ? '见列表末尾' : '没有空闲项目'}</span>
        </div>
      </div>

      <div className="ov-thead">
        <span>项目</span>
        <span>当前需求</span>
        <span>改动与同步</span>
        <span>运行状态</span>
        <span />
      </div>

      {active.map((r) => (
        <ProjectRow key={r.p.id} p={r.p} git={r.g} {...rowProps} />
      ))}

      {idle.length ? (
        <>
          <div
            className={'ov-group' + (idleOpen ? ' open' : '')}
            onClick={() => setIdleOpen((v) => !v)}
            role="button"
            tabIndex={0}
          >
            <span className="gt">空闲项目 {idle.length} 个</span>
            <span className="gs">无待处理需求 · 无未提交改动 · 无运行中服务</span>
            <span className="gchev">{IC.chevDown}</span>
          </div>
          {idleOpen
            ? idle.map((r) => <ProjectRow key={r.p.id} p={r.p} git={r.g} {...rowProps} />)
            : null}
        </>
      ) : null}
    </div>
  );
}

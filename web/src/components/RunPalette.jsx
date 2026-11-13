import { useEffect, useMemo, useRef, useState } from 'react';
import { fmtAgo, fmtDateTime, fmtDuration, runExitLabel } from '../format.js';
import { IC } from '../icons.jsx';
import { projectColorMap } from '../lib/project-color.js';
import { collectRuns, matchRuns } from '../lib/run-palette.js';
import { stepIndex } from '../lib/search-view.js';

/**
 * 启动命令面板（Ctrl / ⌘ + P）：列出所有未归档项目的命令，回车启动 / 停止。
 * 只管「选中即执行」这一件事；启动后台的作用域、日志视图、toast 由 App 统一处理。
 */
export default function RunPalette({ open, blocked, projects, onClose, onRun, onRefresh }) {
  const [q, setQ] = useState('');
  /** 选中项记 id 而不是下标：执行后列表会重排（启动的跳到顶部、停止的掉回组内），
      下标会指到别的命令上，第二次回车就可能作用错对象 */
  const [activeId, setActiveId] = useState(null);
  const [pending, setPending] = useState(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const all = useMemo(() => collectRuns(projects), [projects]);
  const rows = useMemo(() => matchRuns(all, q), [all, q]);
  const running = all.filter((r) => r.on).length;
  /** 项目色与侧栏头像同源：跨项目列表里最先要认的是「这是哪个项目」 */
  const colorOf = useMemo(() => projectColorMap(projects), [projects]);
  /** 当前高亮位置：选中项被筛掉时回落到第一条 */
  const hit = rows.findIndex((r) => r.c.id === activeId);
  const activeIndex = hit < 0 ? 0 : hit;

  // 打开：清空上一轮的查询与选中，并让状态先跟上后台（可能在别处启停过）
  useEffect(() => {
    if (!open) return undefined;
    setQ('');
    setActiveId(null);
    setPending(null);
    if (onRefresh) onRefresh();
    const t = setTimeout(() => inputRef.current && inputRef.current.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  // 弹窗打开时自动收起，避免两层浮层叠在一起
  useEffect(() => {
    if (blocked && open) onClose();
  }, [blocked, open, onClose]);

  useEffect(() => {
    const el = listRef.current && listRef.current.querySelector('.cmdk-row.active');
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  if (!open) return null;

  async function run(row) {
    if (!row || pending) return;
    setPending(row.c.id);
    try {
      await onRun(row);
    } finally {
      setPending(null);
      // 执行完回到输入框：面板不关，方便接着启停下一条
      if (inputRef.current) inputRef.current.focus();
    }
  }

  /** 上下移动：以当前高亮位置为起点循环，落点写回 id */
  const step = (delta) => {
    if (!rows.length) return;
    const next = stepIndex(activeIndex, rows.length, delta);
    setActiveId(rows[next].c.id);
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      step(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      step(-1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(rows[activeIndex]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className="cmdk" role="dialog" aria-modal="true" aria-label="启动命令">
      <div className="cmdk-scrim" onClick={onClose} />
      <div className="cmdk-card">
        <div className="cmdk-input">
          {IC.term}
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="搜索命令，回车启动 / 停止"
            spellCheck="false"
            autoComplete="off"
          />
          {pending ? <span className="spinner" /> : <kbd>Esc</kbd>}
        </div>

        <div className="cmdk-list" ref={listRef}>
          {!all.length ? (
            <div className="cmdk-hint">还没有配置启动命令，去启动台添加一条</div>
          ) : !rows.length ? (
            <div className="cmdk-hint">没有匹配的命令</div>
          ) : null}

          {rows.map((r, i) => {
            const on = r.on;
            const busy = pending === r.c.id;
            const last = r.c.lastRun;
            // 一周内说「刚刚 / N 分钟前」，再早才给具体日期
            const when = last
              ? '上次启动 ' + (fmtAgo(last.startedAt) || fmtDateTime(last.startedAt))
              : '从未启动';
            return (
              <button
                type="button"
                key={r.c.id}
                className={'cmdk-row' + (i === activeIndex ? ' active' : '')}
                onMouseEnter={() => setActiveId(r.c.id)}
                onClick={() => run(r)}
              >
                <i className="cmdk-ico">{IC.term}</i>
                <span className="cmdk-main">
                  <span className="cmdk-title">{r.c.name || r.c.text}</span>
                  <span className="cmdk-meta">
                    {/* 项目名是这里唯一的归属信息：色块 + 加粗，跟侧栏头像同色 */}
                    <span className="cmdk-pj">
                      <i className="cmdk-pjc" style={{ background: colorOf.get(r.projectId) || 'transparent' }} />
                      {r.projectName}
                    </span>
                    {r.c.name ? <span className="mono">{r.c.text}</span> : null}
                    <span>{when}</span>
                  </span>
                </span>
                <span className="cmdk-side">
                  {/* 状态只读：一行灰字 / 一个绿点，不做成胶囊，免得看着像第二个按钮。
                      时长 / 退出结果并入这一列而不是第二行：第二行保持项目+文本+时间，不再加项 */}
                  <span className={'cmdk-state' + (on ? ' on' : '')}>
                    {on ? (
                      <>
                        <i className="plight plight-run" />
                        运行中{last ? ' · ' + fmtDuration(last.startedAt) : ''}
                      </>
                    ) : last ? (
                      runExitLabel(last)
                    ) : (
                      '已停止'
                    )}
                  </span>
                  <span className="cmdk-act">{busy ? '处理中…' : on ? '结束' : '启动'}</span>
                </span>
              </button>
            );
          })}
        </div>

        <div className="cmdk-foot">
          <span>↑↓ 选择 · Enter 启动 / 停止 · Esc 关闭</span>
          <span>
            {all.length} 条命令 · {running} 个运行中
          </span>
        </div>
      </div>
    </div>
  );
}

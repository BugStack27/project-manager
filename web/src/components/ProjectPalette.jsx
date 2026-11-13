import { useEffect, useMemo, useRef, useState } from 'react';
import { avatarColor } from '../format.js';
import { IC } from '../icons.jsx';
import { matchProjects } from '../lib/project-palette.js';
import { stepIndex } from '../lib/search-view.js';
import { Highlight, ProjectIcon, ProjectStackIcon } from '../ui.jsx';

/**
 * 项目切换面板（Ctrl / ⌘ + O）：像全局搜索一样列出项目，输入即模糊匹配，
 * 回车切到选中项目；空查询按侧栏顺序列出全部项目，方向键即可直达。
 */
export default function ProjectPalette({ open, blocked, projects, currentId, onClose, onPick }) {
  const [q, setQ] = useState('');
  /** 选中项记项目 id：查询变化导致列表重排时不会指到别的项目 */
  const [activeId, setActiveId] = useState(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const all = useMemo(() => (Array.isArray(projects) ? projects : []), [projects]);
  const rows = useMemo(() => matchProjects(all, q), [all, q]);
  const colorOf = useMemo(() => {
    const map = new Map();
    all.forEach((p) => map.set(p.id, avatarColor(all, p.id)));
    return map;
  }, [all]);

  /** 当前高亮位置：选中项被筛掉时回落到第一条 */
  const hit = rows.findIndex((r) => r.p.id === activeId);
  const activeIndex = hit < 0 ? 0 : hit;

  // 打开：清空查询，默认停在当前项目上
  useEffect(() => {
    if (!open) return undefined;
    setQ('');
    setActiveId(currentId || null);
    const t = setTimeout(() => inputRef.current && inputRef.current.focus(), 0);
    return () => clearTimeout(t);
  }, [open, currentId]);

  // 弹窗打开时自动收起，避免两层浮层叠在一起
  useEffect(() => {
    if (blocked && open) onClose();
  }, [blocked, open, onClose]);

  useEffect(() => {
    const el = listRef.current && listRef.current.querySelector('.cmdk-row.active');
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, q]);

  if (!open) return null;

  const pick = (row) => {
    if (!row) return;
    onPick(row.p);
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (rows.length) setActiveId(rows[stepIndex(activeIndex, rows.length, 1)].p.id);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (rows.length) setActiveId(rows[stepIndex(activeIndex, rows.length, -1)].p.id);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(rows[activeIndex]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className="cmdk" role="dialog" aria-modal="true" aria-label="切换项目">
      <div className="cmdk-scrim" onClick={onClose} />
      <div className="cmdk-card">
        <div className="cmdk-input">
          {IC.search}
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="搜索项目名或拼音"
            spellCheck="false"
            autoComplete="off"
          />
          <kbd>Esc</kbd>
        </div>

        <div className="cmdk-list" ref={listRef}>
          {!all.length ? <div className="cmdk-hint">还没有项目，先去新建一个</div> : null}
          {all.length && !rows.length ? <div className="cmdk-hint">没有匹配的项目</div> : null}

          {rows.map((row, i) => {
            const p = row.p;
            const on = i === activeIndex;
            return (
              <button
                type="button"
                key={p.id}
                className={'cmdk-row' + (on ? ' active' : '')}
                onMouseEnter={() => setActiveId(p.id)}
                onClick={() => pick(row)}
                title={p.path}
              >
                <span className="cmdk-av">
                  <ProjectIcon project={p} color={colorOf.get(p.id)} size={22} />
                </span>
                <span className="cmdk-main">
                  <span className="cmdk-title">
                    <span className="cmdk-name">
                      <Highlight text={p.name} positions={row.namePos} />
                    </span>
                    <ProjectStackIcon project={p} size={11} />
                  </span>
                  <span className="cmdk-meta">
                    <span className="mono">{p.path}</span>
                  </span>
                </span>
                <span className="cmdk-side">
                  {p.id === currentId ? <span className="cmdk-act">当前</span> : null}
                </span>
              </button>
            );
          })}
        </div>

        <div className="cmdk-foot">
          <span>↑↓ 选择 · Enter 切换 · Esc 关闭</span>
          <span>{rows.length} 个项目</span>
        </div>
      </div>
    </div>
  );
}

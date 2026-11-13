import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { STATUS } from '../constants.js';
import { fmtDateTime } from '../format.js';
import { IC } from '../icons.jsx';
import { matchText } from '../lib/pinyin.js';
import { Highlight } from '../ui.jsx';
import {
  GROUP_SHOWN,
  GROUP_SHOWN_EXPANDED,
  SEARCH_GROUPS,
  countByGroup,
  flattenResults,
  stepIndex,
  visibleItems
} from '../lib/search-view.js';

const DEBOUNCE_MS = 250;

const GROUP_ICON = {
  projects: IC.folder,
  requirements: IC.req,
  logs: IC.term,
  commits: IC.commit
};

/**
 * 命中文字高亮：关键字可能以文字、子序列或拼音命中（口径见 lib/pinyin.js），
 * 下标只能由内核给。片段是后端截好的，拼音命中可能整体落在截断之外，这时就不标。
 */
function Hi({ text, q }) {
  const needle = String(q || '').trim();
  const hit = needle ? matchText(text, needle) : null;
  return <Highlight text={text} positions={hit ? hit.positions : null} />;
}

function titleOf(row, q) {
  const it = row.item;
  if (row.group === 'projects') return <Hi text={it.name} q={q} />;
  if (row.group === 'requirements') return <Hi text={'#' + it.seq + ' ' + it.title} q={q} />;
  if (row.group === 'logs') return <Hi text={it.snippet.text} q={q} />;
  return <Hi text={it.subject} q={q} />;
}

function metaOf(row, q) {
  const it = row.item;
  if (row.group === 'projects') {
    return <span className="mono">{it.path}</span>;
  }
  if (row.group === 'requirements') {
    return (
      <>
        <span>{it.projectName}</span>
        <span>{STATUS[it.status] ? STATUS[it.status].label : it.status}</span>
      </>
    );
  }
  if (row.group === 'logs') {
    return (
      <>
        <span>{it.projectName}</span>
        <span>{it.commandName || it.commandText}</span>
        <span>{fmtDateTime(it.runStartedAt)}</span>
      </>
    );
  }
  return (
    <>
      <span>{it.projectName}</span>
      <span className="mono">{it.shortSha}</span>
      <span>{it.author}</span>
      <span>{fmtDateTime(it.committedAt)}</span>
    </>
  );
}

/** 需求正文 / 备注命中时多给一行片段；标题命中则不重复 */
function snippetOf(row, q) {
  const it = row.item;
  if (row.group !== 'requirements') return null;
  if (it.matchedField === 'title' || it.matchedField === 'seq') return null;
  return (
    <span className="cmdk-snip">
      <Hi text={it.snippet.text} q={q} />
    </span>
  );
}

export default function CommandPalette({ open, blocked, onClose, onPick }) {
  const [q, setQ] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [active, setActive] = useState(0);
  const [expanded, setExpanded] = useState({});
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const seqRef = useRef(0);

  const rows = useMemo(() => flattenResults(data, expanded), [data, expanded]);
  const counts = useMemo(() => countByGroup(data, expanded), [data, expanded]);
  const partial = !!(data && data.partial && (data.partial.commits || data.partial.logs));
  // 有组点过「查看更多」就按接口上限多取一些，未展开的组仍只显示 5 条
  const limit = SEARCH_GROUPS.some((g) => expanded[g.key]) ? GROUP_SHOWN_EXPANDED : GROUP_SHOWN;

  // 打开：聚焦输入并清空上一轮的查询与结果
  useEffect(() => {
    if (!open) return;
    setQ('');
    setData(null);
    setError('');
    setLoading(false);
    setActive(0);
    setExpanded({});
    const t = setTimeout(() => inputRef.current && inputRef.current.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  // 弹窗打开时命令面板自动收起，避免两层浮层叠在一起
  useEffect(() => {
    if (blocked && open) onClose();
  }, [blocked, open, onClose]);

  // 换了关键字就回到每组的默认展示条数，上一组的展开不带到新结果里
  useEffect(() => {
    setExpanded({});
  }, [q]);

  // 防抖查询：请求序号丢弃过期响应，连续输入不会出现旧结果覆盖新结果
  useEffect(() => {
    if (!open) return undefined;
    const query = q.trim();
    const seq = ++seqRef.current;
    if (!query) {
      setData(null);
      setLoading(false);
      setError('');
      return undefined;
    }
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await api.globalSearch(query, limit);
        if (seq !== seqRef.current) return;
        setData(res);
        setError('');
      } catch (e) {
        if (seq !== seqRef.current) return;
        setData(null);
        setError(e.message || '搜索失败');
      } finally {
        if (seq === seqRef.current) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [open, q, limit]);

  useEffect(() => {
    setActive(0);
  }, [data]);

  useEffect(() => {
    const el = listRef.current && listRef.current.querySelector('.cmdk-row.active');
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;

  const pick = (row) => {
    if (!row) return;
    onPick(row, q.trim());
  };

  const expand = (key) => {
    setExpanded((m) => (m[key] ? m : { ...m, [key]: true }));
    // 按钮点完就被替换掉，焦点还给输入框，方向键与回车继续可用
    if (inputRef.current) inputRef.current.focus();
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => stepIndex(i, rows.length, 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => stepIndex(i, rows.length, -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(rows[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  let groupIndex = 0;
  return (
    <div className="cmdk" role="dialog" aria-modal="true" aria-label="全局搜索">
      <div className="cmdk-scrim" onClick={onClose} />
      <div className="cmdk-card">
        <div className="cmdk-input">
          {IC.search}
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="搜索项目、需求、日志与提交"
            spellCheck="false"
            autoComplete="off"
          />
          {loading ? <span className="spinner" /> : <kbd>Esc</kbd>}
        </div>

        <div className="cmdk-list" ref={listRef}>
          {error ? <div className="cmdk-hint">搜索失败：{error}</div> : null}
          {!error && !q.trim() ? <div className="cmdk-hint">输入关键字开始搜索</div> : null}
          {!error && q.trim() && !loading && !rows.length ? <div className="cmdk-hint">没有匹配结果</div> : null}

          {error
            ? null
            : SEARCH_GROUPS.map((g) => {
                const items = visibleItems(data, g.key, expanded);
                if (!items.length) return null;
                const more = !!(data && data.more && data.more[g.key]);
                const full = !!(expanded && expanded[g.key]);
                const head = (
                  <div className="cmdk-group" key={'hd-' + g.key}>
                    {g.label}
                    {more && !full ? (
                      <button type="button" className="cmdk-more" onClick={() => expand(g.key)}>
                        {counts[g.key]}＋ 查看更多
                      </button>
                    ) : (
                      <span>{counts[g.key] + (more ? '＋' : '')}</span>
                    )}
                  </div>
                );
                const body = items.map((item) => {
                  const idx = groupIndex++;
                  const row = { group: g.key, item };
                  const on = idx === active;
                  return (
                    <button
                      type="button"
                      key={g.key + '-' + idx}
                      className={'cmdk-row' + (on ? ' active' : '')}
                      onMouseEnter={() => setActive(idx)}
                      onClick={() => pick(row)}
                    >
                      <i className="cmdk-ico">{GROUP_ICON[g.key]}</i>
                      <span className="cmdk-main">
                        <span className="cmdk-title">{titleOf(row, q.trim())}</span>
                        <span className="cmdk-meta">{metaOf(row, q.trim())}</span>
                        {snippetOf(row, q.trim())}
                      </span>
                    </button>
                  );
                });
                return (
                  <div className="cmdk-sec" key={g.key}>
                    {head}
                    {body}
                  </div>
                );
              })}
        </div>

        <div className="cmdk-foot">
          <span>↑↓ 选择 · Enter 打开 · Esc 关闭</span>
          {partial ? <span className="cmdk-warn">部分来源未扫描完，结果可能不完整</span> : null}
        </div>
      </div>
    </div>
  );
}

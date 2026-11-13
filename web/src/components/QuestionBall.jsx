import { useEffect, useRef, useState } from 'react';
import { fmtClock } from '../format.js';
import { IC } from '../icons.jsx';

/** 提醒类型：图标负责区分，颜色沿用现有语义色 */
const KIND = {
  question: { label: '提问', icon: IC.chat, cls: 'question' },
  review: { label: '交付', icon: IC.check, cls: 'review' },
  other: { label: '提醒', icon: IC.bell, cls: 'other' }
};

function kindOf(q) {
  return KIND[q.kind] || KIND.other;
}

/** 倒计时：问题到 /ask 超时，交付到 /complete 等待结束；到点仍保留在列表里 */
function remainOf(q, now) {
  const end = q.expiresAt ? Date.parse(q.expiresAt) : NaN;
  if (!Number.isFinite(end)) return null;
  const ms = end - now;
  if (ms <= 0) return { text: '已超时', over: true };
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return { text: m + ':' + String(s).padStart(2, '0'), over: false };
}

/** 单行内容：项目 · 编号 标题 · 谁说了什么 */
/** 提问条数：一条需求可能挂多条，摘要里只有第一条，剩多少要写出来 */
function moreOf(q) {
  return q.count > 1 ? '（共 ' + q.count + ' 条待回答）' : '';
}

function lineOf(q) {
  const who = q.agentName || q.agent || 'agent';
  const tail = q.text ? who + '：' + q.text : who;
  return q.project.name + ' · #' + q.seq + ' ' + (q.title || '') + ' · ' + tail + moreOf(q);
}

/**
 * 强提醒球：悬浮在右下角，不占版面，收集「等你回答」的提问与「等你验收」的交付。
 * 鼠标悬浮就展开列表（不管有几条），每条单行；点条目直达对应需求。
 * 不做关闭按钮：移开鼠标自动收起，Esc / 点击外部也能关。
 */
export default function QuestionBall({ items, rightOffset, maxWidth, onOpen }) {
  const list = Array.isArray(items) ? items : [];
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(Date.now());
  const rootRef = useRef(null);
  const closeTimer = useRef(null);

  // 事项被处理完 / 超时后收起浮层
  useEffect(() => {
    if (!list.length) setOpen(false);
  }, [list.length]);

  // 倒计时每秒刷新；只在展开时跑，避免后台空转
  useEffect(() => {
    if (!open) return undefined;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // 卸载时清掉悬停关闭的延迟定时器
  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    []
  );

  if (!list.length) return null;

  const total = list.length;
  const asking = list.filter((q) => q.kind === 'question').length;
  const reviewing = list.filter((q) => q.kind === 'review').length;
  const others = total - asking - reviewing;

  function summary() {
    const parts = [];
    if (asking) parts.push(asking + ' 条提问');
    if (reviewing) parts.push(reviewing + ' 条待审核');
    if (others) parts.push(others + ' 条提醒');
    return parts.join('、') || total + ' 条待处理';
  }

  /** 悬浮即展开；留一点延迟，允许鼠标跨过球与浮层之间的空隙 */
  function show() {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setNow(Date.now());
    setOpen(true);
  }

  function hideSoon() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  }

  function pick(q) {
    setOpen(false);
    onOpen(q.project, q.requirementId);
  }

  return (
    <div
      className="qball-wrap"
      style={{ right: rightOffset, '--qpop-max': maxWidth }}
      ref={rootRef}
      onMouseEnter={show}
      onMouseLeave={hideSoon}
    >
      {open ? (
        <div className="qpop" role="dialog" aria-label={summary()}>
          <div className="qpop-hd">{summary()}</div>
          <div className="qpop-list">
            {list.map((q) => {
              const k = kindOf(q);
              const r = remainOf(q, now);
              const who = q.agentName || q.agent || 'agent';
              const tail = q.text ? who + '：' + q.text : who;
              const more = moreOf(q);
              return (
                <button
                  className="qpop-row"
                  key={q.project.id + '|' + q.requirementId + '|' + q.kind}
                  onClick={() => pick(q)}
                  title={k.label + ' · ' + lineOf(q)}
                >
                  <span className={'qpop-ico ' + k.cls} aria-hidden="true">
                    {k.icon}
                  </span>
                  <span className="qpop-proj" title={q.project.name}>
                    {q.project.name}
                  </span>
                  <span className="qpop-text">
                    <span className="qpop-rid">#{q.seq}</span>
                    {q.title ? <span className="qpop-title">{q.title}</span> : null}
                    <span className="qpop-tail">{tail + more}</span>
                  </span>
                  <span className={'qpop-remain' + (r ? (r.over ? ' over' : '') : ' plain')}>
                    {r ? r.text : q.at ? fmtClock(q.at) : ''}
                  </span>
                  <span className="qpop-chev" aria-hidden="true">
                    {IC.chev}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
      <button
        type="button"
        className="qball"
        onClick={show}
        onFocus={show}
        title={summary()}
        aria-label={summary()}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <span className="qball-ico">{IC.chat}</span>
        <span className="qball-badge">{total}</span>
      </button>
    </div>
  );
}

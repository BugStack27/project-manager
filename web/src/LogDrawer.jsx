import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { fmtDateTime, fmtDuration, runExitLabel } from './format.js';
import { IC } from './icons.jsx';
import { parseAnsi, STYLE_ATTRS } from './lib/ansi.js';
import { findUrls } from './lib/urls.js';

/** 一段带 ANSI 样式的文本：颜色走 CSS 变量，属性走 ansi-<属性> 类 */
function AnsiSpan({ seg, text = seg.text }) {
  const cls = STYLE_ATTRS.filter((k) => seg[k]).map((k) => 'ansi-' + k);
  const style = {};
  if (seg.fg) {
    cls.push('ansi-fg');
    style['--ansi-fg'] = seg.fg;
  }
  if (seg.bg) {
    cls.push('ansi-bg');
    style['--ansi-bg'] = seg.bg;
  }
  return (
    <span className={cls.join(' ') || undefined} style={style}>
      {text}
    </span>
  );
}

/** 日志里的地址：target=_blank 交给主进程，由系统浏览器打开 */
function LogLink({ url, children }) {
  return (
    <a href={url} title={url} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  );
}

/** 把样式分段按查询命中与行内地址切开：命中段包 <mark>（on = 当前定位到的那一处），地址包 <a> */
function renderAnsi(parsed, hits) {
  const links = findUrls(parsed.text);
  if ((!hits || !hits.length) && !links.length) {
    return parsed.segments.map((seg, i) => <AnsiSpan key={i} seg={seg} />);
  }

  const out = [];
  let offset = 0;
  parsed.segments.forEach((seg, si) => {
    const start = offset;
    const end = start + seg.text.length;
    offset = end;

    // 命中与地址换算到段内区间，两者的切点并集决定小块边界
    const hs = [];
    const ls = [];
    const cuts = new Set([start, end]);
    (hits || []).forEach((h) => {
      const from = Math.max(h.at, start);
      const to = Math.min(h.at + h.len, end);
      if (to <= from) return;
      hs.push({ on: h.on, from, to });
      cuts.add(from);
      cuts.add(to);
    });
    links.forEach((l) => {
      const from = Math.max(l.at, start);
      const to = Math.min(l.at + l.len, end);
      if (to <= from) return;
      ls.push({ url: l.url, from, to });
      cuts.add(from);
      cuts.add(to);
    });

    const points = [...cuts].sort((a, b) => a - b);
    let hi = 0;
    let li = 0;
    for (let i = 0; i < points.length - 1; i++) {
      const from = points[i];
      const to = points[i + 1];
      while (hi < hs.length && hs[hi].to <= from) hi++;
      while (li < ls.length && ls[li].to <= from) li++;
      const hit = hi < hs.length && hs[hi].from <= from ? hs[hi] : null;
      const link = li < ls.length && ls[li].from <= from ? ls[li] : null;

      let node = <AnsiSpan seg={seg} text={seg.text.slice(from - start, to - start)} />;
      if (link) node = <LogLink url={link.url}>{node}</LogLink>;
      if (hit) node = <mark className={hit.on ? 'on' : ''}>{node}</mark>;
      out.push(<React.Fragment key={si + '-' + from}>{node}</React.Fragment>);
    }
  });
  return out;
}

/** 按原始行文本缓存解析结果：1.5s 轮询每次全量重拉，不缓存会反复解析整份日志 */
function cachedParse(cache, text) {
  const raw = String(text);
  let parsed = cache.get(raw);
  if (!parsed) {
    parsed = parseAnsi(raw);
    cache.set(raw, parsed);
  }
  return parsed;
}

/** 启动台右面板：运行日志（原日志弹窗改造，嵌入 rpanel-body） */
export default function LogDrawer({ command, resetToken, initialRunId, initialFind, onClose, onStart, onStop }) {
  const [runId, setRunId] = useState(initialRunId || null);
  const [data, setData] = useState({ run: null, lines: [], running: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  /** 日志内搜索：open 控制输入条，idx 是定位到的命中序号（可为负，渲染时取模） */
  const [find, setFind] = useState({ open: false, q: '', idx: 0 });
  /** 每次「打开搜索」自增：搜索条已打开时再按 Ctrl+F / 点搜索按钮也要重新聚焦 */
  const [focusTick, setFocusTick] = useState(0);
  const findRef = useRef(null);
  const logsRef = useRef(null);
  const atBottomRef = useRef(true);
  const parseCache = useRef(new Map());

  const cid = command.id;
  const runs = command.runs || [];
  const latest = runs[0] || null;
  const latestId = latest ? latest.id : null;

  const load = useCallback(async () => {
    try {
      const res = await api.logs(cid, runId);
      setData(res);
      setError('');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [cid, runId]);

  // 点「启动」/切命令后回到最新运行；带 initialRunId 时定位到指定历史运行
  useEffect(() => {
    setRunId(initialRunId || null);
  }, [initialRunId, resetToken]);

  // 换命令 / 换运行之后旧的解析结果不再复用：清掉，避免缓存随会话无限增长
  useEffect(() => {
    parseCache.current.clear();
  }, [cid, runId]);

  // latestId 变化（含启动后立刻退出的短命进程）也要重拉：否则状态已 stopped、轮询不开，会一直停在旧运行
  useEffect(() => {
    setLoading(true);
    load();
  }, [load, latestId]);

  // 看最新一次运行、且进程还活着时轮询追加。
  // 用本次拉取到的 data.run 而不是 command 里的快照：分离的宿主一死，下一次轮询就会
  // 带回 alive=false，轮询自然停下，头部状态也不会停在「仍在运行」。
  const liveRun = data.run;
  const shouldPoll =
    runId === null &&
    (command.status === 'running' ||
      !!(liveRun && (liveRun.status === 'running' || (liveRun.status === 'detached' && liveRun.alive))));
  useEffect(() => {
    if (!shouldPoll) return undefined;
    const t = setInterval(load, 1500);
    return () => clearInterval(t);
  }, [shouldPoll, load]);

  // 新日志到来时，若原本贴在底部则继续贴底（搜索定位中不拽回底部，否则看不到命中）
  const lineCount = data.lines.length;
  useEffect(() => {
    const el = logsRef.current;
    if (!el) return;
    if (find.open && find.q.trim()) return;
    if (atBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [lineCount, loading, find.open, find.q]);

  // Ctrl+F 打开日志内搜索、Esc 关闭：监听只在日志面板挂载期间存在，不影响其它页面
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setFind((f) => ({ ...f, open: true }));
        setFocusTick((n) => n + 1);
      } else if (e.key === 'Escape') {
        setFind((f) => (f.open ? { open: false, q: '', idx: 0 } : f));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!find.open) return;
    findRef.current?.focus();
    findRef.current?.select();
  }, [find.open, focusTick]);

  function onScroll() {
    const el = logsRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }

  const isLive = command.status === 'running';
  /** 分离出去但宿主还活着：应用没句柄，但进程确实在跑，可以按 hostPid 结束 */
  const isDetachedAlive = !isLive && !!data.run && data.run.status === 'detached' && data.run.alive;
  const canStop = isLive || isDetachedAlive;

  /** 启停请求期间禁用：底部按钮没有行内按钮的 pending 保护，双击会打出误导性的 409 */
  async function act(fn) {
    if (busy) return;
    setBusy(true);
    try {
      await fn(command);
    } finally {
      setBusy(false);
    }
  }

  /* ── ANSI 解析（按行缓存）与搜索命中（按行归集，渲染时只标记，不改文本） ── */
  const parsed = data.lines.map((l) => cachedParse(parseCache.current, l.text));
  const q = find.q.trim();
  const lineHits = new Map();
  let hitTotal = 0;
  let activeHit = -1;
  if (q) {
    const needle = q.toLowerCase();
    parsed.forEach((p, li) => {
      const lower = p.text.toLowerCase();
      let at = lower.indexOf(needle);
      while (at >= 0) {
        if (!lineHits.has(li)) lineHits.set(li, []);
        lineHits.get(li).push({ at, len: q.length, on: false });
        hitTotal += 1;
        at = lower.indexOf(needle, at + needle.length);
      }
    });
    if (hitTotal) {
      activeHit = ((find.idx % hitTotal) + hitTotal) % hitTotal;
      let n = 0;
      for (const hits of lineHits.values()) {
        if (activeHit < n + hits.length) {
          hits[activeHit - n].on = true;
          break;
        }
        n += hits.length;
      }
    }
  }

  // 定位到的命中滚进可见区：横向也跟过去，超长行才看得到匹配处
  useEffect(() => {
    if (activeHit < 0) return;
    const box = logsRef.current;
    const el = box && (box.querySelector('mark.on') || box.querySelector('.log.hit-on'));
    if (el) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeHit, q]);

  // 从全局搜索跳进来：把搜索条打开并定位到目标行（按目标行之前的命中数设置序号）
  const initialFindApplied = useRef('');
  useEffect(() => {
    if (!initialFind || !initialFind.q || !data.lines.length) return;
    const key = String(resetToken) + '|' + initialFind.line + '|' + initialFind.q;
    if (initialFindApplied.current === key) return;
    initialFindApplied.current = key;
    const needle = initialFind.q.toLowerCase();
    let count = 0;
    const end = Math.min(initialFind.line == null ? 0 : initialFind.line, parsed.length);
    for (let i = 0; i < end; i += 1) {
      const t = parsed[i].text.toLowerCase();
      let at = t.indexOf(needle);
      while (at >= 0) {
        count += 1;
        at = t.indexOf(needle, at + needle.length);
      }
    }
    setFind({ open: true, q: initialFind.q, idx: count });
    setFocusTick((n) => n + 1);
  }, [initialFind, resetToken, data.lines.length, parsed]);

  return (
    <div className="rlogs">
      <div className="dhead">
        <div style={{ minWidth: 0 }}>
          {command.name ? (
            <div className="cmd-name" title={command.name}>
              {command.name}
            </div>
          ) : null}
          <div className="ttl" title={command.text}>
            {command.text}
          </div>
          <div className="dmeta">
            <span className="meta mono cwd" title={command.cwd}>
              {command.cwd}
            </span>
            {data.run && data.run.pid ? (
              <span className="meta">
                pid <b>{data.run.pid}</b>
              </span>
            ) : null}
            {data.run ? (
              data.run.status === 'running' || (data.run.status === 'detached' && data.run.alive) ? (
                <span className="meta">
                  {data.run.status === 'detached' ? '已分离 · ' : ''}已运行{' '}
                  <b>{fmtDuration(data.run.startedAt)}</b>
                </span>
              ) : (
                <span className="meta">
                  {fmtDateTime(data.run.startedAt)} · <b>{runExitLabel(data.run)}</b>
                </span>
              )
            ) : null}
          </div>
        </div>
        <div className="dacts">
          <button
            className="btn sm ghost"
            onClick={() => {
              setFind((f) => ({ ...f, open: true }));
              setFocusTick((n) => n + 1);
            }}
            title="搜索日志（Ctrl+F）"
          >
            搜索
          </button>
          <button className="btn sm ghost x" onClick={onClose} title="关闭">
            {IC.x}
          </button>
        </div>
      </div>

      {latest && (
        <div className="druns">
          <span className="lab">运行记录</span>
          <button className={runId === null ? 'active' : ''} onClick={() => setRunId(null)}>
            最新 · {fmtDateTime(latest.startedAt)}
            <span className="e">{latest.status === 'running' ? '运行中' : runExitLabel(latest)}</span>
          </button>
          {runs.slice(1).map((r) => (
            <button
              key={r.id}
              className={runId === r.id ? 'active' : ''}
              onClick={() => setRunId(r.id)}
            >
              {fmtDateTime(r.startedAt)}
              <span className="e">{runExitLabel(r)}</span>
            </button>
          ))}
        </div>
      )}

      {find.open ? (
        <div className="findbar">
          <input
            ref={findRef}
            value={find.q}
            placeholder="搜索日志"
            onChange={(e) => setFind({ open: true, q: e.target.value, idx: 0 })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                setFind((f) => ({ ...f, idx: f.idx + (e.shiftKey ? -1 : 1) }));
              }
            }}
          />
          <span className={'findn' + (q && !hitTotal ? ' none' : '')}>
            {q ? (hitTotal ? activeHit + 1 + '/' + hitTotal : '无匹配') : ''}
          </span>
          <button
            className="btn sm ghost"
            disabled={!hitTotal}
            title="上一个（Shift+Enter）"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setFind((f) => ({ ...f, idx: f.idx - 1 }))}
          >
            ↑
          </button>
          <button
            className="btn sm ghost"
            disabled={!hitTotal}
            title="下一个（Enter）"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setFind((f) => ({ ...f, idx: f.idx + 1 }))}
          >
            ↓
          </button>
          <button
            className="btn sm ghost"
            title="关闭搜索（Esc）"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setFind({ open: false, q: '', idx: 0 })}
          >
            {IC.x}
          </button>
        </div>
      ) : null}

      <div className="logs" ref={logsRef} onScroll={onScroll}>
        {loading && data.lines.length === 0 ? (
          <div className="loading" style={{ padding: '40px 20px' }}>
            <span className="spinner" />
            正在读取日志…
          </div>
        ) : error ? (
          <div className="loading" style={{ color: 'var(--red-text)' }}>
            {error}
          </div>
        ) : data.lines.length === 0 ? (
          <div className="loading">这次运行还没有输出</div>
        ) : (
          <>
            {data.truncated && (
              <div className="log">
                <span className="t" />
                <span className="lv warn">warn</span>
                <span className="msg">日志过大，仅显示最后 512 KB</span>
              </div>
            )}
            {data.lines.map((l, i) => {
              const hits = lineHits.get(i);
              const on = hits && hits.some((h) => h.on);
              return (
                <div className={'log' + (hits ? ' hit' + (on ? ' hit-on' : '') : '')} key={i}>
                  <span className="t">{l.t}</span>
                  <span className={'lv ' + l.level}>{l.level}</span>
                  <span className="msg">{renderAnsi(parsed[i], hits)}</span>
                </div>
              );
            })}
          </>
        )}
      </div>

      <div className="dfoot">
        <span className="note tabular">
          {data.lines.length} 行 · {runs.length} 次运行记录
        </span>
        <button className="btn sm" onClick={onClose}>
          关闭
        </button>
        {canStop ? (
          <button
            className="btn sm stop"
            disabled={busy}
            title={isLive ? '停止进程' : '结束已分离的进程（进程树一并终止）'}
            onClick={() => act(onStop)}
          >
            {IC.stop}停止
          </button>
        ) : (
          <button className="btn sm start" disabled={busy} onClick={() => act(onStart)}>
            {IC.play}启动
          </button>
        )}
      </div>
    </div>
  );
}

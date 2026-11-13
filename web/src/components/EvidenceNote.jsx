import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api.js';
import { parseNote } from '../lib/evidence.js';
import { highlightLines } from '../lib/hlighter.js';

/**
 * 备注里的证据坐标 → 可悬停查看的代码。
 *
 * AI 巡检只会在 note 里留下「类别 相对路径:行号」这种坐标（提示词里钉死的结构），
 * 代码内容在悬停时才向主进程要一段，所以备注本身保持单行、不随代码变动而失效。
 *
 * 兜底原则：解析不出来（人工复核备注、空备注、写歪的格式）一律原样当纯文本，
 * 不猜路径、不猜行号——猜错比不显示更糟。
 */

const POP_W = 520;
/** 浮层高度上限（与 CSS 的 max-height 对齐，实际值再按锚点这侧的剩余空间收窄） */
const POP_MAX_H = 460;
const OPEN_DELAY = 180;
const CLOSE_DELAY = 160;

/** 同一坐标只读一次：列表 5s 轮询、来回 hover 都不该反复打主进程 */
const cache = new Map();
const inflight = new Map();

function loadSnippet(projectId, item, full) {
  const key = [projectId, item.path, item.from, item.to, full ? 'full' : 'part'].join('|');
  if (cache.has(key)) return Promise.resolve(cache.get(key));
  if (inflight.has(key)) return inflight.get(key);
  const p = api
    .fileSnippet(projectId, item.path, item.from, item.to, full)
    .then((d) => {
      cache.set(key, d);
      inflight.delete(key);
      return d;
    })
    .catch((e) => {
      inflight.delete(key);
      throw e;
    });
  inflight.set(key, p);
  return p;
}

/** 退化结果 → 一句人话。行号漂移单独说，因为那是最容易误导人的一种 */
function describe(data) {
  if (!data) return '';
  if (data.restricted) return '该文件不提供预览（密钥/凭据/依赖目录）';
  if (data.directory) return '这是一个目录，不是文件';
  if (data.binary) return '二进制文件，不显示内容';
  if (data.tooLarge) return '文件过大（' + Math.round((data.bytes || 0) / 1024) + ' KB），不显示内容';
  if (data.lineOutOfRange) return '文件现在只有 ' + data.totalLines + ' 行，这条证据指向的行已不存在（代码已变动）';
  if (!data.exists) return '文件不存在，可能已改名或删除';
  return '';
}

const baseName = (p) => String(p || '').split(/[\\/]/).pop();

function EvidencePop({ item, projectId, pos, onEnter, onLeave }) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const [full, setFull] = useState(false);
  const [hl, setHl] = useState(null);

  useEffect(() => {
    let alive = true;
    setState({ loading: true, data: null, error: null });
    loadSnippet(projectId, item, full)
      .then((data) => alive && setState({ loading: false, data, error: null }))
      .catch((e) => alive && setState({ loading: false, data: null, error: e.message }));
    return () => {
      alive = false;
    };
  }, [projectId, item, full]);

  // 高亮是纯装饰：引擎没加载出来、语言认不出、hljs 抛错，都只是保持纯文本，绝不挡住代码本身
  useEffect(() => {
    const lines = state.data && state.data.lines;
    if (!lines || !lines.length) {
      setHl(null);
      return undefined;
    }
    let alive = true;
    highlightLines(lines.map((l) => l.text).join('\n'), item.path)
      .then((rows) => {
        if (alive) setHl(rows);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [state.data, item.path]);

  const data = state.data;
  const note = describe(data);
  const lines = (data && data.lines) || [];

  return (
    <div
      className="ev-pop"
      style={{ left: pos.left, top: pos.top, width: pos.width, maxHeight: pos.maxHeight, transform: pos.transform }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <div className="ev-pop-hd">
        <span className="ev-kind">{item.kind || '证据'}</span>
        <span className="ev-pop-path" title={item.path}>
          {item.path}
          <b>
            :{item.from}
            {item.to !== item.from ? '-' + item.to : ''}
          </b>
        </span>
      </div>

      {state.loading ? (
        <div className="ev-pop-empty">
          <span className="spinner" />
          正在读取…
        </div>
      ) : state.error ? (
        <div className="ev-pop-empty err">{state.error}</div>
      ) : note ? (
        <div className="ev-pop-empty">{note}</div>
      ) : lines.length === 0 ? (
        <div className="ev-pop-empty">（空文件）</div>
      ) : (
        <div className="ev-code">
          {lines.map((ln, i) => {
            const hit = data.hit && ln.n >= data.hit.from && ln.n <= data.hit.to;
            return (
              <div className={'ev-line' + (hit ? ' hit' : '')} key={ln.n}>
                <span className="ev-ln">{ln.n}</span>
                {hl && hl[i] ? (
                  /* hljs 已把源码里的 < > & 转义，class 名也来自 hljs 内部，无注入面 */
                  <span className="ev-tx" dangerouslySetInnerHTML={{ __html: hl[i] }} />
                ) : (
                  <span className="ev-tx">{ln.text || ' '}</span>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="ev-pop-ft">
        <span className="ev-pop-meta">
          {data && data.totalLines ? data.totalLines + ' 行' : ''}
          {full && data && lines.length < data.totalLines ? '（只显示前 ' + lines.length + ' 行）' : ''}
        </span>
        {lines.length > 0 && !data.lineOutOfRange ? (
          <button
            className="btn sm ghost ev-pop-btn"
            onClick={() => setFull(!full)}
            title={full ? '只看命中处' : '显示整个文件（超过 600 行截断）'}
          >
            {full ? '只看命中处' : '展开整个文件'}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function EvidenceChip({ item, projectId }) {
  const ref = useRef(null);
  const openTimer = useRef(0);
  const closeTimer = useRef(0);
  const [pos, setPos] = useState(null);

  useEffect(
    () => () => {
      clearTimeout(openTimer.current);
      clearTimeout(closeTimer.current);
    },
    []
  );

  /**
   * 锚点位置 → 浮层位置。
   *
   * 高度不能靠测量：内容异步加载，还有「展开整个文件」按钮会把它从 17 行撑到 600 行，
   * 量出来下一秒就过时。所以改用「把 max-height 压到锚点这一侧的剩余空间」——
   * 内容再长也只是内部滚动，永远不会越过视口边缘。
   *
   * 翻转判据也必须用真实剩余空间比大小，不能拍一个固定阈值：
   * 浮层上限是 460px，若判「下方 300px 够用」又不翻转，底部就会缺 160px。
   */
  function place() {
    const el = ref.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const GAP = 8;
    const EDGE = 12;
    const width = Math.min(POP_W, window.innerWidth - EDGE * 2);
    const left = Math.max(EDGE, Math.min(r.left, window.innerWidth - width - EDGE));
    const spaceBelow = window.innerHeight - r.bottom - GAP - EDGE;
    const spaceAbove = r.top - GAP - EDGE;
    // 优先向下（贴着视线走向）；只有下方明显不如上方宽裕（不足八成）才翻上去。
    // 不用固定像素阈值：窗口高度、锚点位置、浮层上限三者一变，固定值就说不通。
    const flip = spaceBelow < spaceAbove * 0.8;
    const room = flip ? spaceAbove : spaceBelow;
    return {
      left,
      top: flip ? r.top - GAP : r.bottom + GAP,
      width,
      maxHeight: Math.max(120, Math.min(POP_MAX_H, room)),
      transform: flip ? 'translateY(-100%)' : undefined
    };
  }

  function cancelClose() {
    clearTimeout(closeTimer.current);
  }

  function scheduleOpen() {
    cancelClose();
    // 不判断 pos 是否已存在：从 A 滑到 B 时 pos 还留着 A 的坐标，
    // 早退会让浮层停在 A 的位置上。
    openTimer.current = setTimeout(() => setPos(place()), OPEN_DELAY);
  }

  function scheduleClose() {
    clearTimeout(openTimer.current);
    closeTimer.current = setTimeout(() => setPos(null), CLOSE_DELAY);
  }

  // 打开期间任何滚动/缩放都会让浮层脱离锚点，直接收起，别让它飘在错的地方。
  // 用捕获阶段是想连「右面板内部滚动」也收起来（非捕获只认文档级滚动，面板滚动时锚点会跑掉）；
  // 但浮层自己代码区的滚动不能把自己的浮层关掉，所以按 target 排除掉 .ev-pop 内部。
  useEffect(() => {
    if (!pos) return undefined;
    const close = () => setPos(null);
    const onScroll = (e) => {
      if (e.target instanceof Element && e.target.closest('.ev-pop')) return;
      close();
    };
    window.addEventListener('resize', close);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [pos]);

  const label = item.from === item.to ? String(item.from) : item.from + '-' + item.to;

  return (
    <>
      <span
        className="ev-chip"
        ref={ref}
        onMouseEnter={scheduleOpen}
        onMouseLeave={scheduleClose}
        onFocus={scheduleOpen}
        onBlur={scheduleClose}
        tabIndex={0}
        title={item.path + ':' + label}
      >
        <span className="ev-kind">{item.kind || '证据'}</span>
        <span className="ev-file">{baseName(item.path)}</span>
        <span className="ev-loc">:{label}</span>
      </span>
      {pos
        ? createPortal(
            <EvidencePop
              item={item}
              projectId={projectId}
              pos={pos}
              onEnter={cancelClose}
              onLeave={scheduleClose}
            />,
            document.body
          )
        : null}
    </>
  );
}

/**
 * 备注区：能解析出证据坐标就渲染成可悬停的 chip，否则原样输出纯文本。
 * 人工复核填的备注（任务完成、证据已过时被覆盖）走的就是纯文本这条路，属于正常终态。
 */
export default function EvidenceNote({ note, projectId }) {
  const parsed = useMemo(() => parseNote(note), [note]);

  if (!parsed.ok) return <div className="rd-note">{note}</div>;

  return (
    <div className="rd-note">
      {parsed.head ? <span className="ev-head">{parsed.head} · 证据：</span> : null}
      {parsed.items.map((it, i) => (
        <span key={i}>
          {i > 0 ? <span className="ev-sep">, </span> : null}
          {it.type === 'loc' ? (
            <EvidenceChip item={it} projectId={projectId} />
          ) : (
            <span className="ev-plain">{it.text}</span>
          )}
        </span>
      ))}
    </div>
  );
}

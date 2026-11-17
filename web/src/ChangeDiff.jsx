import { useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import ImageLightbox from './components/ImageLightbox.jsx';
import MarkdownText from './components/MarkdownText.jsx';
import { CHG } from './constants.js';
import { fmtDateTime } from './format.js';
import { IC } from './icons.jsx';
import { keepLineBreaks } from './lib/commit-message.js';
import { highlightLines } from './lib/hlighter.js';
import { PanelClose } from './ui.jsx';

function classifyDiffLine(line) {
  if (line.startsWith('@@')) return 'hunk';
  if (
    line.startsWith('+++') ||
    line.startsWith('---') ||
    line.startsWith('diff ') ||
    line.startsWith('index ') ||
    line.startsWith('new file') ||
    line.startsWith('deleted file') ||
    line.startsWith('similarity ') ||
    line.startsWith('rename ') ||
    line.startsWith('old mode') ||
    line.startsWith('new mode')
  ) {
    return 'meta';
  }
  if (line.startsWith('+')) return 'add';
  if (line.startsWith('-')) return 'del';
  return '';
}

/** 统一 diff 的行首标记；未跟踪文件是正文原样，没有这一层 */
const SIGNED = /^[+\- ]/;

/**
 * 把 diff 行切成「可高亮的连续片段」。
 *
 * meta / hunk 行（`--- a/x`、`+++ b/x`、`@@ -1,3 +1,4 @@`、`diff --git`）和 `\ No newline` 这类杂行
 * 不参与高亮：它们是 git 的元信息，按源码着色只会串出关键字/字符串的杂色。
 * 它们同时是片段边界 —— 跨 hunk 的语法状态本来就不连续（中间被省略的代码行没给），
 * 整段一次性高亮会让后面的 hunk 把前一个 hunk 的块注释状态带过来。
 */
function codeSegments(lines, untracked) {
  const segs = [];
  let cur = null;
  lines.forEach((line, i) => {
    const kind = untracked ? '' : classifyDiffLine(line);
    const signed = untracked || SIGNED.test(line);
    if (kind === 'meta' || kind === 'hunk' || !signed) {
      cur = null;
      return;
    }
    if (!cur) {
      cur = { at: i, texts: [] };
      segs.push(cur);
    }
    cur.texts.push(untracked ? line : line.slice(1));
  });
  return segs;
}

/**
 * 差异正文 + 代码高亮。
 *
 * 高亮是纯装饰：引擎没加载出来、语言认不出、行数对不上，都只是保持现在的纯文本着色，
 * 绝不挡住 diff 本身。行首的 +/-/空格 单独用 .diff-sign 渲染并保留强色，
 * 行底色（绿/红 tint）也不动 —— 增删对比的读法和高亮前完全一致。
 *
 * 滚动交在外层 .diff-scroll，pre 自己按内容撑到「最长那一行」的宽度：
 * 否则 pre 只有可视宽度那么宽，长行横向滚动后右侧的绿/红底色会断掉。
 */
function DiffText({ text, untracked, path }) {
  const lines = useMemo(() => text.split('\n'), [text]);
  const [hl, setHl] = useState(null);

  useEffect(() => {
    setHl(null);
    const segs = codeSegments(lines, untracked);
    if (!segs.length) return undefined;
    let alive = true;
    Promise.all(segs.map((s) => highlightLines(s.texts.join('\n'), path)))
      .then((parts) => {
        if (!alive || parts.every((p) => !p)) return;
        const rows = new Array(lines.length).fill(null);
        segs.forEach((s, si) => {
          const part = parts[si];
          // 行数对不上说明结果不可信（正常不会发生）：这一段退回纯文本
          if (!part || part.length !== s.texts.length) return;
          s.texts.forEach((_, k) => {
            rows[s.at + k] = part[k];
          });
        });
        setHl(rows);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [lines, untracked, path]);

  return (
    <div className="diff-scroll">
      <pre className="diff-body">
        {lines.map((line, i) => {
          const kind = untracked ? '' : classifyDiffLine(line);
          const code = hl ? hl[i] : null;
          if (code == null) {
            return (
              <span className={'diff-line' + (kind ? ' ' + kind : '')} key={i}>
                {line || ' '}
              </span>
            );
          }
          const sign = untracked ? '' : line.slice(0, 1);
          return (
            <span className={'diff-line' + (kind ? ' ' + kind : '')} key={i}>
              {sign ? <span className="diff-sign">{sign}</span> : null}
              {/* hljs 已转义源码里的 < > &，class 名也来自库内部，无注入面 */}
              <span dangerouslySetInnerHTML={{ __html: code || ' ' }} />
            </span>
          );
        })}
      </pre>
    </div>
  );
}

/**
 * 二进制图片的预览：能取到哪一侧就画哪一侧，两侧并排便于对比。
 * 两侧都取不到（超限 / 读取失败）时退回一句提示，不显示空白。
 */
function DiffImages({ image, path, before, after }) {
  const [zoom, setZoom] = useState(null);
  const sides = [
    { key: 'old', label: before, src: image.old },
    { key: 'new', label: after, src: image.new }
  ].filter((s) => s.src);
  if (!sides.length) {
    const mb = Math.round((image.maxBytes || 0) / 1024 / 1024);
    return <div className="diff-empty">图片读取失败{mb ? '或超过 ' + mb + 'MB' : ''}，不显示内容</div>;
  }
  // 只有一侧时点明是新增还是删除，避免把「另一侧取不到」误读成对比失败
  const only = image.old ? '（已删除）' : '（新增）';
  return (
    <div className="diff-scroll">
      <div className="diff-image">
        {sides.map((s) => (
          <figure className="dimg" key={s.key}>
            <figcaption>{s.label + (sides.length === 1 ? only : '')}</figcaption>
            <button
              type="button"
              className="dimg-box"
              onClick={() => setZoom({ src: s.src, label: s.label })}
              title="点击放大查看"
            >
              <img src={s.src} alt={path + ' ' + s.label} />
            </button>
          </figure>
        ))}
      </div>
      {zoom ? (
        <ImageLightbox
          src={zoom.src}
          alt={path + ' ' + zoom.label}
          title={path}
          caption={zoom.label}
          onClose={() => setZoom(null)}
        />
      ) : null}
    </div>
  );
}

/** 差异正文：已跟踪 / 提交 → 统一 diff 着色；未跟踪 → 文件正文；图片 → 直接画图 */
function DiffBlock({ state, path }) {
  if (!state || state.loading) {
    return (
      <div className="diff-empty">
        <span className="spinner" />
        正在读取…
      </div>
    );
  }
  if (state.error) return <div className="diff-empty" style={{ color: 'var(--red-text)' }}>{state.error}</div>;
  const d = state.data || {};
  if (d.image) {
    return (
      <DiffImages
        image={d.image}
        path={path}
        before={d.untracked ? '' : d.sha ? '提交前' : 'HEAD'}
        after={d.untracked ? '未跟踪文件' : d.sha ? '提交后' : '工作区'}
      />
    );
  }
  if (d.binary) return <div className="diff-empty">二进制文件，不显示内容</div>;
  if (d.directory) return <div className="diff-empty">未跟踪的目录</div>;

  const untracked = !!d.untracked;
  const text = untracked ? d.content || '' : d.diff || '';
  return (
    <>
      <div className="diff-head">
        {untracked ? '未跟踪文件内容' : d.sha ? 'diff · ' + d.sha.slice(0, 7) : 'diff · HEAD → 工作区'}
        {d.truncated ? <span className="warn"> · 已截断</span> : null}
      </div>
      {text ? (
        <DiffText text={text} untracked={untracked} path={path} />
      ) : (
        <div className="diff-empty">（空内容）</div>
      )}
    </>
  );
}

/** 提交正文：读取中 / 读失败 / markdown；正文为空时什么都不渲染，空态文案由调用方给 */
function CommitBody({ state }) {
  if (!state || state.loading) {
    return (
      <div className="diff-empty">
        <span className="spinner" />
        正在读取提交说明…
      </div>
    );
  }
  if (state.error) return <div className="diff-empty" style={{ color: 'var(--red-text)' }}>{state.error}</div>;
  const body = String(state.body || '').trim();
  if (!body) return null;
  return <MarkdownText className="msg-body">{keepLineBreaks(body)}</MarkdownText>;
}

/** 提交说明的元信息行：短 sha（悬停看全）+ 作者 + 提交时间 */
function CommitMeta({ commit }) {
  return (
    <div className="msg-meta">
      <span className="gsha" title={commit.sha}>
        {commit.shortSha}
      </span>
      {commit.author ? <span className="msg-author">{commit.author}</span> : null}
      {commit.committedAt ? <span>{fmtDateTime(commit.committedAt)}</span> : null}
    </div>
  );
}

/** 提交里单个文件的改动量；二进制不显示数字 */
function CommitFileStat({ file }) {
  if (file.binary) {
    return (
      <span className="gstat">
        <span className="bin">二进制</span>
      </span>
    );
  }
  return (
    <span className="gstat">
      {file.added != null ? <span className="add">+{file.added}</span> : null}
      {file.removed != null ? <span className="del">-{file.removed}</span> : null}
    </span>
  );
}

/**
 * 提交里的文件行 + 展开后的 diff。
 * 展开状态由 CommitDetail 统一持有，同一时刻只允许一个文件展开。
 */
function CommitFileRow({ file, open, diff, onToggle }) {
  const st = CHG[file.status] || { label: file.status, cls: '' };
  return (
    <div className="cfile">
      <div
        className={'grow gfile cfile-head' + (open ? ' open' : '')}
        onClick={onToggle}
        role="button"
        tabIndex={0}
        title={file.origPath ? file.origPath + ' → ' + file.path : file.path}
      >
        <span className={'gtw' + (open ? ' open' : '')}>{IC.chev}</span>
        <span className={'st ' + st.cls}>{st.label}</span>
        <span className="gpath">{file.path}</span>
        {file.origPath ? <span className="gren">← {file.origPath}</span> : null}
        <CommitFileStat file={file} />
      </div>
      {open ? (
        <div className="cfile-diff">
          <DiffBlock state={diff} path={file.path} />
        </div>
      ) : null}
    </div>
  );
}

/**
 * 右面板：提交详情。
 * 上半是提交说明（标题 / 元信息 / markdown 正文），下半是本次改动的文件清单；
 * 点文件行按需拉取并展开 diff，展开另一个文件时上一个自动收起。
 */
function CommitDetail({ commit, state, projectId, onClose }) {
  const [openPath, setOpenPath] = useState(null);
  const [diffs, setDiffs] = useState({});

  const loading = !state || state.loading;
  const body = String((state && state.body) || '').trim();
  const files = (state && state.files) || [];

  const toggleFile = (file) => {
    if (openPath === file.path) {
      setOpenPath(null);
      return;
    }
    setOpenPath(file.path);
    const prev = diffs[file.path];
    if (prev && !prev.error) return;
    setDiffs((m) => ({ ...m, [file.path]: { loading: true } }));
    api
      .gitCommitDiff(projectId, commit.sha, file.path)
      .then((res) => setDiffs((m) => ({ ...m, [file.path]: { loading: false, data: res } })))
      .catch((e) => setDiffs((m) => ({ ...m, [file.path]: { loading: false, error: e.message } })));
  };

  return (
    <div className="gview gview-commit">
      <div className="gview-head">
        <span className="gview-src">提交 {commit.shortSha || ''}</span>
        <span className="gview-note">{commit.author || ''}</span>
        <span style={{ marginLeft: 'auto' }} />
        {onClose ? <PanelClose onClick={onClose} /> : null}
      </div>

      <div className="cview-msg">
        <h2 className="msg-title">{commit.subject}</h2>
        <CommitMeta commit={commit} />
        <CommitBody state={state} />
        {!loading && !state.error && !body ? (
          <div className="gview-none">该提交只有标题行，没有正文说明</div>
        ) : null}
      </div>

      <div className="cview-files">
        {loading ? (
          <div className="gstate sm">
            <span className="spinner" />
            正在读取文件清单…
          </div>
        ) : state.error ? (
          <div className="gstate sm">{state.error}</div>
        ) : files.length === 0 ? (
          <div className="gstate sm">该提交没有文件改动</div>
        ) : (
          files.map((f) => (
            <CommitFileRow
              key={f.path}
              file={f}
              open={openPath === f.path}
              diff={diffs[f.path]}
              onToggle={() => toggleFile(f)}
            />
          ))
        )}
      </div>
    </div>
  );
}

/**
 * 右面板：提交详情或「当前改动」里的单文件 diff。
 * 提交详情包含说明（markdown）与文件清单，单文件 diff 直接在文件行下展开。
 * 未选中时给一句引导；git 不可用时说明原因，避免看起来像「点了没反应」。
 */
export default function ChangeDiff({ sel, content, unavailable, commitFiles, projectId, onClose }) {
  if (!sel) {
    return (
      <div className="rp-hintrow">
        <div className="rpanel-hint">
          {unavailable
            ? '无法读取改动：git 不可用、项目不是仓库或读取失败'
            : '点击中间的提交树里的提交或文件，在这里查看提交说明与改动内容'}
        </div>
        {onClose ? <PanelClose onClick={onClose} /> : null}
      </div>
    );
  }

  if (sel.kind === 'commit-info') {
    return (
      <CommitDetail
        key={sel.sha}
        commit={sel}
        state={(commitFiles && commitFiles[sel.sha]) || null}
        projectId={projectId}
        onClose={onClose}
      />
    );
  }

  const file = (content && content.file) || {};
  const st = CHG[file.status] || null;

  return (
    <div className="gview">
      <div className="gview-head">
        {st ? <span className={'st ' + st.cls}>{st.label}</span> : null}
        <span className="gview-path" title={file.origPath ? file.origPath + ' → ' + sel.path : sel.path}>
          {sel.path}
        </span>
        {file.origPath ? <span className="gren">← {file.origPath}</span> : null}
        <span className="gview-src">当前改动</span>
        <span className="gstat">
          {file.binary ? (
            <span className="bin">二进制</span>
          ) : (
            <>
              {file.added != null ? <span className="add">+{file.added}</span> : null}
              {file.removed != null ? <span className="del">-{file.removed}</span> : null}
            </>
          )}
        </span>
        <span style={{ marginLeft: 'auto' }} />
        {onClose ? <PanelClose onClick={onClose} /> : null}
      </div>
      <DiffBlock state={content} path={sel.path} />
    </div>
  );
}

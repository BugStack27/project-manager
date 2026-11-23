import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { highlightLines } from '../lib/hlighter.js';
import MarkdownBody from './MarkdownBody.jsx';

/**
 * 文件 / 目录引用的悬停窗。
 *
 * 文件：就地显示内容，带行号与语法高亮。与需求备注的证据浮层同一套：内容走 fileSnippet
 * （只读、只认项目根内、密钥/二进制/超限只回标记），高亮走 lib/hlighter.js 的按需加载引擎，
 * 代码区直接复用 .ev-code 的行样式与 hljs 配色。
 * 目录：改走 projectDir 列一级条目（名称 / 类型 / 大小，限 200 条），不递归、不读文件内容。
 * 每次出卡重新读一次 —— 文件与目录都会变，缓存会让悬浮窗说旧话；引擎加载失败就保持纯文本。
 *
 * markdown 文件（.md / .markdown）改由 MarkdownBody 渲染：悬停是为了看文档写了什么，
 * 逐行源码反而难读。不引 MarkdownText 是为了避开它与 HoverCardLayer 的循环依赖（见 doc §4）。
 *
 * 卡本身可接收鼠标（内部要滚动内容），所以由 HoverCardLayer 传入 enter/leave 来接管收起时机。
 */

const MD_RE = /\.(md|markdown)$/i;

/** 退化结果 → 一句人话：这些情况主进程只回标记，不回内容 */
function describe(data) {
  if (!data) return '';
  if (data.restricted) return '该文件不提供预览（密钥/凭据/依赖目录）';
  if (data.directory) return '这是一个目录，不是文件';
  if (data.binary) return '二进制文件，不显示内容';
  if (data.tooLarge) return '文件过大（' + Math.round((data.bytes || 0) / 1024) + ' KB），不显示内容';
  if (!data.exists) return '文件不存在，可能已改名或删除';
  return '';
}

const baseName = (p) => String(p || '').split(/[\\/]/).filter(Boolean).pop();

/** 条目大小 → 人话；目录没有大小，调用方自己写「目录」 */
function sizeText(n) {
  if (n === null || n === undefined) return '';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10 * 1024 ? 1 : 0) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

export default function FileHoverCard({
  projectId,
  path,
  directory = false,
  left,
  top,
  width,
  maxHeight,
  transform,
  hint,
  onEnter,
  onLeave
}) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const [hl, setHl] = useState(null);
  const isMarkdown = !directory && MD_RE.test(path);

  useEffect(() => {
    let alive = true;
    setState({ loading: true, data: null, error: null });
    setHl(null);
    // 文件用 full=true 从第 1 行读到上限；line/end 传 1 只为满足契约
    const req = directory ? api.projectDir(projectId, path) : api.fileSnippet(projectId, path, 1, 1, true);
    req
      .then((data) => alive && setState({ loading: false, data, error: null }))
      .catch((e) => alive && setState({ loading: false, data: null, error: e.message }));
    return () => {
      alive = false;
    };
  }, [projectId, path, directory]);

  // 高亮是纯装饰：引擎没加载出来、语言认不出、hljs 抛错，都只是保持纯文本
  // markdown 走渲染视图，不需要也给不起行号对齐的高亮结果
  useEffect(() => {
    const lines = state.data && state.data.lines;
    if (isMarkdown || !lines || !lines.length) {
      setHl(null);
      return undefined;
    }
    let alive = true;
    highlightLines(lines.map((l) => l.text).join('\n'), path)
      .then((rows) => {
        if (alive) setHl(rows);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [state.data, path, isMarkdown]);

  const data = state.data;
  const note = directory ? '' : describe(data);
  const lines = (data && data.lines) || [];
  const truncated = !directory && !!data && data.totalLines > lines.length;
  const entries = (directory && data && data.entries) || [];
  const footerHint = hint || (directory ? '点击 chip 打开文件夹' : '点击 chip 打开文件');

  return (
    <div
      className="fhover"
      style={{ left, top, width, maxHeight, transform }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      role="tooltip"
    >
      <div className="fhover-hd">
        <span className="fhover-name" title={path}>{baseName(path)}</span>
        <span className="fhover-path" title={path}>{path}</span>
      </div>

      {state.loading ? (
        <div className="fhover-empty"><span className="spinner" />正在读取…</div>
      ) : state.error ? (
        <div className="fhover-empty err">{state.error}</div>
      ) : directory ? (
        entries.length === 0 ? (
          <div className="fhover-empty">（空文件夹）</div>
        ) : (
          <div className="fhover-dir">
            {entries.map((e) => (
              <div className="fhover-dir-row" key={e.name}>
                <span className={'fhover-dir-ico' + (e.directory ? ' dir' : '')}>{e.directory ? '▸' : '·'}</span>
                <span className="fhover-dir-name" title={e.name}>{e.name}</span>
                <span className="fhover-dir-size">{e.directory ? '目录' : sizeText(e.size)}</span>
              </div>
            ))}
          </div>
        )
      ) : note ? (
        <div className="fhover-empty">{note}</div>
      ) : lines.length === 0 ? (
        <div className="fhover-empty">（空文件）</div>
      ) : isMarkdown ? (
        <div className="fhover-md">
          <MarkdownBody>{lines.map((ln) => ln.text).join('\n')}</MarkdownBody>
        </div>
      ) : (
        <div className="ev-code fhover-code">
          {lines.map((ln, i) => (
            <div className="ev-line" key={ln.n}>
              <span className="ev-ln">{ln.n}</span>
              {hl && hl[i] ? (
                /* hljs 已把源码里的 < > & 转义，class 名也来自 hljs 内部，无注入面 */
                <span className="ev-tx" dangerouslySetInnerHTML={{ __html: hl[i] }} />
              ) : (
                <span className="ev-tx">{ln.text || ' '}</span>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="fhover-ft">
        <span>
          {directory
            ? (data ? data.total + ' 项' : '') +
              (data && data.truncated ? '（只显示前 ' + entries.length + ' 项）' : '')
            : (data && data.totalLines ? data.totalLines + ' 行' : '') +
              (truncated ? '（只显示前 ' + lines.length + ' 行）' : '')}
        </span>
        {footerHint ? <span>{footerHint}</span> : null}
      </div>
    </div>
  );
}

import { useMemo } from 'react';
import Markdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * markdown 渲染的最底层：只把字符串变成 `.md-body` 排版（GFM + 表格滚动 + 链接分流），不认引用 chip。
 *
 * 单独成层是为了断开 `HoverCardLayer → FileHoverCard → MarkdownText → HoverCardLayer` 的循环：
 * 环在 dev 热更新下会让 hover 状态出现两份实例（清单行悬停失效、正文 chip 正常），见 doc §4。
 */

/**
 * react-markdown 只放行 http(s)/mailto 之类白名单协议，pm-ref: / pm-req: / pm-file: / pm-skill:
 * 会被它清成空串 —— chip 靠 href 传名字与 id，所以这里显式放行自己的协议，其余一律沿用默认变换
 * （正文可能由外部 AI 写入，白名单不能整体放开）。
 */
export function urlTransform(url) {
  const s = String(url || '');
  return /^pm-(ref|req|file|skill):/.test(s) ? s : defaultUrlTransform(s);
}

/**
 * 正文链接一律交给系统浏览器打开：只给 http/https 加新窗口属性（配合主进程 will-navigate 兜底），
 * 其余协议（mailto: / 相对路径 / file: 等）保持原样不外开 —— file: 之类会把渲染进程引到本地文件上。
 */
export function anchorFor(props) {
  return /^https?:\/\//i.test(String(props.href || '')) ? (
    <a {...props} target="_blank" rel="noreferrer noopener" />
  ) : (
    <a {...props} />
  );
}

// 数组提到模块级，避免每次渲染都给 react-markdown 一个新引用
const remarkPlugins = [remarkGfm];

/** 默认组件表：表格套滚动容器、链接按协议分流；调用方传的 components 覆盖同名项。node 是 react-markdown 的内部字段，不能落到 DOM 上 */
const baseComponents = {
  table: ({ node, children, ...props }) => (
    <div className="md-table-scroll">
      <table {...props}>{children}</table>
    </div>
  ),
  a: ({ node, ...props }) => anchorFor(props)
};

export default function MarkdownBody({ children, className, components }) {
  const merged = useMemo(() => ({ ...baseComponents, ...components }), [components]);
  return (
    <div className={'md-body' + (className ? ' ' + className : '')}>
      <Markdown components={merged} remarkPlugins={remarkPlugins} urlTransform={urlTransform}>
        {children}
      </Markdown>
    </div>
  );
}

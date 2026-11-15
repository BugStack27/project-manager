import { useMemo } from 'react';
import Markdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  linkifyRefs,
  readRefHref,
  linkifyReqRefs,
  readReqHref,
  findReqRef,
  linkifyFileRefs,
  readFileHref,
  findFileRef
} from '../lib/req-refs.js';
import { findSkill, linkifySkills, readSkillHref } from '../lib/skill-refs.js';
import { hoverProps } from './HoverCardLayer.jsx';
import SkillChip from './SkillChip.jsx';

/**
 * react-markdown 只放行 http(s)/mailto 之类白名单协议，pm-ref: / pm-req: / pm-file: / pm-skill:
 * 会被它清成空串 —— chip 靠 href 传名字与 id，所以这里显式放行自己的协议，其余一律沿用默认变换
 * （正文可能由外部 AI 写入，白名单不能整体放开）。
 */
function urlTransform(url) {
  const s = String(url || '');
  return /^pm-(ref|req|file|skill):/.test(s) ? s : defaultUrlTransform(s);
}

/**
 * 正文链接一律交给系统浏览器打开：只给 http/https 加新窗口属性（配合主进程 will-navigate 兜底），
 * 其余协议（mailto: / 相对路径 / file: 等）保持原样不外开 —— file: 之类会把渲染进程引到本地文件上。
 */
function anchorFor(props) {
  return /^https?:\/\//i.test(String(props.href || '')) ? (
    <a {...props} target="_blank" rel="noreferrer noopener" />
  ) : (
    <a {...props} />
  );
}

/**
 * 跨项目引用的 chip：正文里的 `@{项目名}` 在渲染前已被换成 pm-ref: 链接，
 * 这里把它接管成按钮 —— 点一下跳到那个项目的需求中心，而不是当外链丢给浏览器。
 * 悬停出与侧栏项目行同一张信息卡（见 HoverCardLayer），不必跳过去才知道那个项目现在什么样；
 * 出了卡就不再挂原生 title，两套提示一起弹很影响观感。
 * 解析不到项目时保留原名字并标成失效态：名字打错比静默消失更容易被发现。
 */
function RefChip({ name, projectId, onOpen }) {
  const label = '@' + name;
  if (projectId && typeof onOpen === 'function') {
    return (
      <button
        type="button"
        className="ref-chip"
        onClick={() => onOpen(projectId)}
        {...hoverProps.project(projectId)}
      >
        {label}
      </button>
    );
  }
  return (
    <span className="ref-chip miss" title={'没有找到项目「' + name + '」：检查名字是否写错，或重新输入 @ 选一个'}>
      {label}
    </span>
  );
}

/**
 * 本项目需求引用的 chip：`@{#序号}` → pm-req: 链接。点一下跳到那条需求的详情。
 * 悬停出信息窗（标题 / 状态 / 正文摘要，见 RequirementHoverCard），出卡即撤掉原生 title。
 * 解析不到（序号写错 / 已归档删除）时标失效态，保留 `#序号` 原文。
 */
function ReqChip({ seq, reqRef, onOpen }) {
  const title = reqRef && reqRef.exists ? reqRef.title || '' : '';
  const label = '#' + seq + (title ? ' · ' + title : '');
  const hover = hoverProps.requirement(reqRef);
  if (reqRef && reqRef.exists) {
    return (
      <button
        type="button"
        className="ref-chip req-chip"
        onClick={() => {
          if (typeof onOpen === 'function') onOpen(reqRef.requirementId);
        }}
        {...hover}
        title={hover ? undefined : '打开需求 #' + seq + (title ? '「' + title + '」' : '') + '（状态：' + (reqRef.status || '未知') + '）'}
      >
        {label}
      </button>
    );
  }
  return (
    <span className="ref-chip req-chip miss" title={'没有找到本项目需求 #' + seq + '：检查序号是否写错，或该需求已归档/删除'}>
      {'#' + seq}
    </span>
  );
}

const baseName = (p) => String(p || '').split(/[\\/]/).pop();

// remark-gfm 整包开启 GFM（表格 / 删除线 / 任务列表 / 自动链接 / 脚注）；
// 数组提到模块级，避免每次渲染都给 react-markdown 一个新引用
const remarkPlugins = [remarkGfm];

/**
 * 本项目文件引用的 chip：`@{file:路径}` → pm-file: 链接。点一下用系统默认程序打开该文件。
 * 悬停出内容窗（行号 + 语法高亮，见 FileHoverCard），出卡即撤掉原生 title。
 * 不存在 / 越界 / 密钥类文件标失效态（密钥只显示路径不打开），保留原文。
 */
function FileChip({ path, fileRef, projectId, onOpen }) {
  const ok = fileRef && fileRef.exists && !fileRef.restricted;
  const hover = hoverProps.file(fileRef, projectId);
  const tip = !fileRef
    ? '文件：' + path
    : fileRef.restricted
      ? '该文件不提供打开（密钥/凭据/依赖目录）：' + path
      : fileRef.exists
        ? (fileRef.directory ? '目录：' : '打开文件：') + (fileRef.absPath || path)
        : '文件不存在（可能已改名或删除）：' + path;
  if (ok) {
    return (
      <button
        type="button"
        className="ref-chip file-chip"
        onClick={() => {
          if (typeof onOpen === 'function') onOpen(path);
        }}
        {...hover}
        title={hover ? undefined : tip}
      >
        {baseName(path)}
      </button>
    );
  }
  return (
    <span className={'ref-chip file-chip' + (fileRef && fileRef.exists ? '' : ' miss')} title={tip}>
      {baseName(path)}
    </span>
  );
}

/**
 * 右面板里所有 markdown 正文的统一入口：`.md-body` 的排版定义在 panel.css，
 * 各处只传额外的语义类（正文 / 提交说明），不要自己再写一套标签样式。
 *
 * `refs` / `reqRefs` / `fileRefs` / `skills` 传了才启用对应引用与技能关联（服务端给的解析结果），
 * 不传时行为与以前完全一致。`projectId` 只给文件引用用：悬停时按项目 id 就地读内容，
 * 不传就不出文件内容窗（原生 title 仍在）。技能 chip 的外观与说明见 `SkillChip.jsx`（与往返记录共用）。
 * GFM 语法由 remark-gfm 统一开启；表格套一层 `.md-table-scroll` 滚动容器，右面板窄列时不撑破排版。
 */
export default function MarkdownText({
  children,
  className,
  refs,
  reqRefs,
  fileRefs,
  skills,
  projectId,
  onOpenProject,
  onOpenRequirement,
  onOpenFile
}) {
  const linkRefs = Array.isArray(refs);
  const linkReqRefs = Array.isArray(reqRefs);
  const linkFileRefs = Array.isArray(fileRefs);
  const linkSkills = Array.isArray(skills);

  // 多轮替换互不干扰：`@{x}` / `@{#n}` / `@{file:x}` / `{UseSkill:x}` 的词法不重叠，
  // 替换产物里的 `@` 已被 percent-encode，不会被下一轮再吃进去
  const source = useMemo(() => {
    if (typeof children !== 'string') return children;
    let out = children;
    if (linkRefs) out = linkifyRefs(out, refs);
    if (linkReqRefs) out = linkifyReqRefs(out);
    if (linkFileRefs) out = linkifyFileRefs(out);
    if (linkSkills) out = linkifySkills(out, skills);
    return out;
  }, [children, refs, reqRefs, fileRefs, skills, linkRefs, linkReqRefs, linkFileRefs, linkSkills]);

  const components = useMemo(
    () => ({
      // 表格交给外层容器横向滚动：右面板可窄至 240px，列多时只滚表格、不撑宽整个正文
      table: ({ node, children, ...props }) => (
        <div className="md-table-scroll">
          <table {...props}>{children}</table>
        </div>
      ),
      a: ({ node, href, children: label, ...props }) => {
        if (linkSkills) {
          const sk = readSkillHref(href);
          if (sk) return <SkillChip name={sk.name} skill={findSkill(skills, sk.name)} />;
        }
        if (linkReqRefs) {
          const rq = readReqHref(href);
          if (rq) return <ReqChip seq={rq.seq} reqRef={findReqRef(reqRefs, rq.seq)} onOpen={onOpenRequirement} />;
        }
        if (linkFileRefs) {
          const fr = readFileHref(href);
          if (fr) return <FileChip path={fr.path} fileRef={findFileRef(fileRefs, fr.path)} projectId={projectId} onOpen={onOpenFile} />;
        }
        const ref = linkRefs ? readRefHref(href) : null;
        if (ref) {
          return <RefChip name={ref.name} projectId={ref.projectId} onOpen={onOpenProject} />;
        }
        return anchorFor({ href, children: label, ...props });
      }
    }),
    [linkRefs, linkReqRefs, linkFileRefs, linkSkills, reqRefs, fileRefs, skills, projectId, onOpenProject, onOpenRequirement, onOpenFile]
  );

  return (
    <div className={'md-body' + (className ? ' ' + className : '')}>
      <Markdown components={components} remarkPlugins={remarkPlugins} urlTransform={urlTransform}>
        {source}
      </Markdown>
    </div>
  );
}
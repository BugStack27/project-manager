import { Fragment, useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { PROJECT_STACK_LABELS } from './constants.js';
import { avatarColor, avatarInk, initials } from './format.js';
import { loadIdes, preferredIde, rememberOpenedIde, rememberProjectIde } from './ides.js';
import {
  AndroidIcon,
  DockerIcon,
  ElectronIcon,
  GoIcon,
  GradleIcon,
  IC,
  IntellijPluginIcon,
  JavaFxIcon,
  JavaIcon,
  KotlinIcon,
  MavenIcon,
  NpmIcon,
  ObsidianIcon,
  PythonIcon,
  RustIcon,
  SpringIcon
} from './icons.jsx';
import { highlightRuns } from './lib/pinyin.js';

/* ── 通用组件 ─────────────────────────────────── */

/**
 * 搜索命中高亮：命中下标一律由匹配内核给出（`lib/pinyin.js` 的 highlightRuns 已合并连续段），
 * 这里只负责渲染。拼音命中没有对应的原文子串，调用方自己 indexOf 是标不出来的。
 */
export function Highlight({ text, positions }) {
  return (
    <>
      {highlightRuns(text, positions).map((run, i) =>
        run.mark ? <mark key={i}>{run.text}</mark> : <Fragment key={i}>{run.text}</Fragment>
      )}
    </>
  );
}

export function Modal({ children, onClose, wide, className }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal">
      <div className="scrim" onClick={onClose} />
      <div className={'card' + (wide ? ' wide' : '') + (className ? ' ' + className : '')}>{children}</div>
    </div>
  );
}

export function Toast({ toast }) {
  if (!toast) return null;
  return (
    <div className={'toast' + (toast.kind === 'warn' ? ' warn' : '')} key={toast.id}>
      <i />
      <span>{toast.msg}</span>
    </div>
  );
}

export function Avatar({ name, color, size }) {
  // 字色跟着底色走：色板后半圈是浅色，白字在浅底上读不出来
  const style = { background: color, color: avatarInk(color) };
  if (size) {
    style.width = size;
    style.height = size;
    style.fontSize = Math.round(size * 0.42);
  }
  return (
    <span className="pav" style={style}>
      {initials(name)}
    </span>
  );
}

/** 真实图标按需加载：多个入口共用同一份结果，加载失败也只请求一次 */
const EXTRACTABLE = new Set(['android', 'intellij-plugin', 'electron', 'javafx', 'spring-boot']);
const projectIconData = new Map(); // key → { icon, mono } | Promise | null

function useProjectIconData(project) {
  const enabled = !!project && EXTRACTABLE.has(project.kind);
  const key = enabled ? project.kind + '|' + project.id + '|' + project.path : '';
  const [state, setState] = useState(() => {
    const hit = key ? projectIconData.get(key) : null;
    return hit && typeof hit.then !== 'function' ? hit : null;
  });

  useEffect(() => {
    if (!key) {
      setState(null);
      return undefined;
    }
    let pending = projectIconData.get(key);
    if (pending === undefined) {
      pending = api
        .projectIcon(project.id)
        .then((res) => ({ icon: (res && res.icon) || null, mono: (res && res.mono) || null }))
        .catch(() => null)
        .then((result) => {
          projectIconData.set(key, result);
          return result;
        });
      projectIconData.set(key, pending);
    } else if (pending === null || typeof pending.then !== 'function') {
      setState(pending);
      return undefined;
    }
    let alive = true;
    pending.then((result) => {
      if (alive) setState(result);
    });
    return () => {
      alive = false;
    };
  }, [key]);

  return state;
}

/** 技术栈图标：跟在项目名后面，只显示一个主类型，完整列表放在 tooltip 与行提示里 */
const STACK_ICONS = {
  android: AndroidIcon,
  'obsidian-plugin': ObsidianIcon,
  'obsidian-theme': ObsidianIcon,
  'obsidian-vault': ObsidianIcon,
  intellij: IntellijPluginIcon,
  electron: ElectronIcon,
  javafx: JavaFxIcon,
  'spring-boot': SpringIcon,
  kotlin: KotlinIcon,
  java: JavaIcon,
  go: GoIcon,
  rust: RustIcon,
  python: PythonIcon,
  gradle: GradleIcon,
  maven: MavenIcon,
  npm: NpmIcon,
  docker: DockerIcon
};

/** 主类型优先级：平台 / 框架 > 语言 > 构建工具 > 包管理器 > 运行环境 */
const STACK_ORDER = [
  'android',
  'obsidian-plugin',
  'obsidian-theme',
  'obsidian-vault',
  'intellij',
  'electron',
  'javafx',
  'spring-boot',
  'kotlin',
  'gradle',
  'maven',
  'java',
  'go',
  'rust',
  'python',
  'npm',
  'docker'
];

function primaryStack(stacks) {
  const list = Array.isArray(stacks) ? stacks : [];
  return STACK_ORDER.find((id) => list.includes(id)) || null;
}

function stackTitle(stacks) {
  return (stacks || [])
    .map((id) => PROJECT_STACK_LABELS[id])
    .filter(Boolean)
    .join(' · ');
}

/** 项目图标：仓库里有专属图标就显示图标，没有就回退首字母 */
export function ProjectIcon({ project, color, size }) {
  const box = size || 20;
  const data = useProjectIconData(project);

  if (data && data.icon) {
    return (
      <span
        className={
          'pav pav-img' + (data.mono === 'dark' ? ' pav-mono-dark' : data.mono === 'light' ? ' pav-mono-light' : '')
        }
        style={{ width: box, height: box }}
        aria-hidden="true"
      >
        <img src={data.icon} alt="" />
      </span>
    );
  }
  return <Avatar name={project ? project.name : ''} color={color} size={size} />;
}

/** 项目名称后的技术栈图标：展开侧栏时显示，收起后随名称一起隐藏 */
export function ProjectStackIcon({ project, size = 12 }) {
  const stack = primaryStack(project && project.stacks);
  const Icon = stack ? STACK_ICONS[stack] : null;
  if (!Icon) return null;
  return (
    <span className="pstack" title={stackTitle(project.stacks)} aria-hidden="true">
      <Icon size={size} />
    </span>
  );
}

/** 完整技术栈列表：悬浮卡片等处展示全部类型 */
export function ProjectStackList({ project, size = 11 }) {
  const stacks = ((project && project.stacks) || []).filter((id) => STACK_ICONS[id]);
  if (!stacks.length) return null;
  return (
    <span className="pstack-list">
      {stacks.map((id) => {
        const Icon = STACK_ICONS[id];
        return (
          <span className="pstack-item" key={id}>
            <Icon size={size} />
            {PROJECT_STACK_LABELS[id]}
          </span>
        );
      })}
    </span>
  );
}

/**
 * 右抽屉的关闭按钮。
 * 抽屉没有标题栏，所以它由各内容挂在自己第一行的末尾（需求详情 / 日志 / 改动），
 * 永远挨着内容，不用回头找页栏右上角那个开关。
 */
export function PanelClose({ onClick }) {
  return (
    <button className="btn sm icon ghost rp-x" onClick={onClick} title="关闭（Esc）" aria-label="关闭">
      {IC.x}
    </button>
  );
}

/** 中区顶部状态栏：标题（可带图标）+ 返回按钮 + 右侧操作槽（四页共用，由 App 渲染）
 *  titleSlot 用于把标题位置换成可交互控件（如视图下拉），不传时退回「图标 + 纯文本」。 */
export function PageBar({ title, icon, titleSlot, onBack, children }) {
  return (
    // 页栏永远横贯到底 → 始终要给右端的窗口控制按钮留出 overlay 宽度
    <div className="pagebar has-overlay">
      <div className="pagebar-in">
        {onBack ? (
          <button
            className="pagebar-back"
            onClick={onBack}
            title="返回上一页（Alt+←）"
            aria-label="返回上一页（Alt+←）"
          >
            {IC.back}
          </button>
        ) : null}
        {titleSlot || (
          <span className="pagebar-title">
            {icon ? <span className="ico">{icon}</span> : null}
            {title}
          </span>
        )}
        <div className="pagebar-tools">{children}</div>
      </div>
    </div>
  );
}

/** 已安装列表里挑一个可用 id：给定项没有就退回第一个 */
function pickInstalled(list, ideId) {
  return list.some((i) => i.id === ideId) ? ideId : list[0] ? list[0].id : null;
}

/**
 * 「在 IDE 中打开」拆分组按钮。
 * 主键直接用本项目记住的 IDE，右侧箭头切换；数据与报错都在组件内自理，
 * 免得把 notify 从 App 一路透传到需求 / 启动台 / 修改记录三个页面。
 * 渲染位置在中区顶部状态栏的右侧操作槽。
 * 选择按项目记：切项目后主键回到该项目自己的 IDE，没选过的才沿用全局上次使用。
 */
export function IdeButton({ project }) {
  const [ides, setIdes] = useState([]);
  const [picked, setPicked] = useState(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const boxRef = useRef(null);

  useEffect(() => {
    let alive = true;
    setOpen(false);
    setError(null);
    loadIdes()
      .then((res) => {
        if (!alive) return;
        const list = res.ides || [];
        setIdes(list);
        setPicked(pickInstalled(list, preferredIde(project && project.id, project && project.ideId, res.lastIdeId)));
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [project && project.id]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (boxRef.current && boxRef.current.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // 失败提示不长期占位，4 秒后自己消失
  useEffect(() => {
    if (!error) return undefined;
    const t = setTimeout(() => setError(null), 4000);
    return () => clearTimeout(t);
  }, [error]);

  const current = ides.find((i) => i.id === picked) || ides[0] || null;
  const currentId = current ? current.id : null;

  async function run(ideId) {
    if (!project || !ideId || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.openInIde(project.id, ideId);
      setPicked(ideId);
      rememberOpenedIde(project.id, ideId);
      setOpen(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  /** 菜单里选 IDE 只切换选中项，不直接打开：打开必须点主键，避免误点就把窗口拉起来。
   *  选中即落库到项目，下次切回这个项目还是它。 */
  async function choose(ideId) {
    setPicked(ideId);
    setOpen(false);
    setError(null);
    try {
      await api.setProjectIde(project.id, ideId);
      rememberProjectIde(project.id, ideId);
    } catch (e) {
      setError(e.message);
    }
  }

  async function rescan() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await loadIdes(true);
      const list = res.ides || [];
      setIdes(list);
      setPicked((cur) => {
        const want = list.some((i) => i.id === cur)
          ? cur
          : preferredIde(project && project.id, project && project.ideId, res.lastIdeId);
        return pickInstalled(list, want);
      });
      if (!list.length) setError('未检测到已安装的 IDE');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ide" ref={boxRef}>
      {error ? (
        <span className="ide-err" title={error}>
          {error}
        </span>
      ) : null}
      <div className="ide-split">
        <button
          className="btn sm ide-main"
          disabled={!current || busy}
          title={current ? '在 ' + current.name + ' 中打开 ' + project.path : '未检测到已安装的 IDE'}
          onClick={() => run(currentId)}
        >
          {current && current.icon ? <img className="ide-ico" src={current.icon} alt="" /> : IC.code}
          <span className="lbl">{current ? current.name : '未检测到 IDE'}</span>
        </button>
        <button
          className="btn sm ide-caret"
          disabled={!ides.length || busy}
          onClick={() => setOpen((v) => !v)}
          title="选择其它 IDE"
          aria-label="选择其它 IDE"
        >
          {IC.chevDown}
        </button>
      </div>
      {open ? (
        <div className="ide-menu" role="menu">
          {ides.map((i) => (
            <button
              key={i.id}
              className={i.id === currentId ? 'on' : ''}
              role="menuitemradio"
              aria-checked={i.id === currentId}
              onClick={() => choose(i.id)}
            >
              <span className="ck">{i.id === currentId ? IC.check : null}</span>
              {i.icon ? <img className="ide-ico" src={i.icon} alt="" /> : <span className="ide-ico" />}
              <span className="nm">{i.name}</span>
            </button>
          ))}
          {ides.length ? <div className="sep" /> : null}
          <button role="menuitem" onClick={rescan}>
            <span className="ck">{IC.refresh}</span>
            <span className="nm">重新扫描</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * 项目信息条。status 不传时按需求进度展示（需求中心默认口径）；
 * 修改记录 / 启动台传入各自的状态，避免把「未完成需求数」带到无关页面。
 */
export function ContextBar({ project, projects, status }) {
  /* 一个项目可以同时有多条未完成，这里只给总数，分布收进 tooltip */
  const pending = project.pendingCount || 0;
  const spread = [
    project.reviewCount ? '待审核 ' + project.reviewCount : '',
    project.doingCount ? '进行中 ' + project.doingCount : '',
    project.todoCount ? '未开始 ' + project.todoCount : ''
  ]
    .filter(Boolean)
    .join(' · ');
  // 待审核是唯一「卡在用户这儿」的状态，才值得用警示色；其余是中性计数
  const tone = project.reviewCount > 0 ? 'busy' : 'muted';
  const chip = status ? (
    <span className={'quota ' + (status.tone || 'muted')} title={status.title || status.text}>
      <i />
      {status.text}
    </span>
  ) : pending > 0 ? (
    <span className={'quota ' + tone} title={spread}>
      <i />
      {'未完成 ' + pending}
    </span>
  ) : null;

  return (
    <div className="ctx">
      <div className="who">
        <ProjectIcon project={project} color={avatarColor(projects, project.id)} size={34} />
        <div>
          <div className="pname">
            <span className="nm">{project.name}</span>
            {chip}
          </div>
          <div className="ppath" title={project.path}>
            {project.path}
          </div>
        </div>
      </div>
    </div>
  );
}

export function Empty({ title, desc, icon, children }) {
  return (
    <div className="empty">
      <div className="ico">{icon || IC.emptyDoc}</div>
      <h3>{title}</h3>
      <p>{desc}</p>
      {children && <div className="actions">{children}</div>}
    </div>
  );
}

/** 两步确认的危险操作按钮：点一下变确认文案，5 秒内再点才真执行；传 icon 时平时只显示图标，确认时才展开文案 */
export function DangerButton({ label, confirmLabel, onConfirm, disabled, icon }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return undefined;
    const t = setTimeout(() => setArmed(false), 5000);
    return () => clearTimeout(t);
  }, [armed]);

  const text = armed ? confirmLabel || '确认' : label;
  return (
    <button
      type="button"
      className={'btn sm ' + (armed ? 'danger-solid' : icon ? 'icon ghost danger' : 'danger')}
      disabled={disabled}
      title={icon ? text : undefined}
      aria-label={icon ? text : undefined}
      onClick={() => {
        if (armed) onConfirm();
        else setArmed(true);
      }}
    >
      {icon && !armed ? icon : text}
    </button>
  );
}


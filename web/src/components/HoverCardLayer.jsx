import { useEffect, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { avatarColor } from '../format.js';
import { skillMissing } from '../lib/skill-refs.js';
import ProjectHoverCard from './ProjectHoverCard.jsx';
import SkillHoverCard, { loadSkillIndex, skillCardData } from './SkillHoverCard.jsx';

/**
 * 引用项目 / 技能的悬停信息窗：全界面共用一张卡。
 *
 * 项目卡直接复用侧栏项目行那张（ProjectHoverCard），同一个项目在两处看到的是同一套字段与口径；
 * 卡片 portal 到 body —— 右面板收起态带 transform，会让 fixed 变成相对面板定位，与证据浮层同一条理由。
 *
 * 用模块级状态而不是 Context：chip 散在正文、往返记录、提问卡与下方清单里，
 * 走 Context 就得让每一处都在 Provider 之下，漏一处就静默失灵。
 * 这里挂载一个 <HoverCardLayer/> 就够了，谁都能直接呼叫。
 */

/** 停留 240ms 再出卡，与侧栏项目行同一节奏，避免鼠标扫过正文时一路闪 */
const OPEN_DELAY = 240;
const GAP = 8;
const EDGE = 8;
const CARD_W = 286;
/** 卡片高度估算：只决定往锚点哪一侧放，不做精确对齐（内容高度本来随条数变） */
const EST_H = { project: 300, skill: 170 };

let cur = null;
let timer = 0;
/** 每次开关推进一次：延迟到点时号不一致，说明鼠标早已离开，这次开卡作废 */
let seq = 0;
const subs = new Set();

/* useSyncExternalStore 的两个函数必须稳定，否则每次渲染都重新订阅 */
function subscribe(cb) {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
}

const getSnapshot = () => cur;

function emit(next) {
  cur = next;
  subs.forEach((f) => f());
}

/** 锚点 → 卡片坐标：默认落在下方，下方放不下且上方更宽裕就翻上去 */
function place(el, kind) {
  const r = el.getBoundingClientRect();
  const h = EST_H[kind] || EST_H.skill;
  const left = Math.max(EDGE, Math.min(r.left, window.innerWidth - CARD_W - EDGE));
  const spaceBelow = window.innerHeight - r.bottom - GAP;
  const spaceAbove = r.top - GAP;
  const flip = spaceBelow < h && spaceAbove > spaceBelow;
  const top = flip ? r.top - GAP - h : r.bottom + GAP;
  return { left, top: Math.max(EDGE, Math.min(top, window.innerHeight - EDGE - h)) };
}

function hide() {
  seq += 1;
  clearTimeout(timer);
  if (cur) emit(null);
}

function later(my, el, make) {
  timer = setTimeout(() => {
    if (seq !== my || !el.isConnected) return;
    const next = make();
    if (next) emit(Object.assign({ anchor: el }, next, place(el, next.kind)));
  }, OPEN_DELAY);
}

/** 技能归属要显示 Agent 名字，而技能条目里只有 id：清单与注册表都在这一侧读回来 */
let index = null;
let indexLoading = null;

function ensureIndex() {
  if (index) return Promise.resolve(index);
  if (!indexLoading) {
    indexLoading = loadSkillIndex()
      .then((i) => {
        index = i;
        indexLoading = null;
        return i;
      })
      .catch(() => {
        // 读失败不记住失败：下一次悬浮重新取，否则这次误判会一直留着
        indexLoading = null;
        return null;
      });
  }
  return indexLoading;
}

function bind(kind, payload) {
  return {
    onMouseEnter: (e) => {
      const el = e.currentTarget;
      const my = (seq += 1);
      clearTimeout(timer);
      if (cur) emit(null);
      if (kind === 'project') {
        later(my, el, () => ({ kind, projectId: payload }));
        return;
      }
      ensureIndex().then((idx) => {
        if (seq !== my || !idx) return;
        const sk = skillCardData(payload, idx);
        if (!sk) return;
        later(my, el, () => ({ kind: 'skill', skill: sk }));
      });
    },
    onMouseLeave: hide
  };
}

/**
 * chip 直接用：`<button {...hoverProps.project(id)}>`。
 * 绑上了就以信息窗为准，chip 自己的原生 `title` 必须让位（两套同时弹很影响观感）；
 * 绑不上的那些（解析不到项目、技能目录已不在）继续用原生提示说明原因。
 */
export const hoverProps = {
  project: (projectId) => (projectId ? bind('project', projectId) : null),
  skill: (sk) => (sk && !skillMissing(sk) ? bind('skill', sk) : null)
};

/**
 * 唯一的卡片。项目对象按 id 从 props 里现查：侧栏那份 5s 轮询会把计数与 git 状态刷进来，
 * 卡片跟着一起变新，不必自己再拉一次。
 */
export function HoverCardLayer({ projects, archivedProjects, dirtyFiles, behindMap }) {
  useSyncExternalStore(subscribe, getSnapshot);

  // fixed 定位的卡一旦锚点跑位就悬在半空：滚动 / 缩放直接收起（与侧栏项目行同一处理）
  useEffect(() => {
    const off = () => hide();
    window.addEventListener('resize', off);
    document.addEventListener('scroll', off, true);
    return () => {
      window.removeEventListener('resize', off);
      document.removeEventListener('scroll', off, true);
    };
  }, []);

  // 切需求 / 关面板会把 chip 连根拔掉，这时浏览器不再补发 mouseleave，
  // 卡片会留在原地：开着的时候盯一下锚点还在不在文档里
  useEffect(() => {
    if (!cur) return undefined;
    const t = setInterval(() => {
      if (cur && cur.anchor && !cur.anchor.isConnected) hide();
    }, OPEN_DELAY);
    return () => clearInterval(t);
  }, [cur]);

  if (!cur) return null;

  if (cur.kind === 'skill') {
    return createPortal(<SkillHoverCard skill={cur.skill} left={cur.left} top={cur.top} />, document.body);
  }

  const all = [].concat(projects || [], archivedProjects || []);
  const project = all.find((p) => p && p.id === cur.projectId);
  if (!project) return null;

  return createPortal(
    <ProjectHoverCard
      project={project}
      color={avatarColor(all, project.id)}
      dirty={(dirtyFiles && dirtyFiles[project.id]) || 0}
      behind={(behindMap && behindMap[project.id]) || 0}
      left={cur.left}
      top={cur.top}
    />,
    document.body
  );
}

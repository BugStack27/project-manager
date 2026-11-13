import { useEffect, useState } from 'react';

const KEY = 'pm.ui.layout';
/* 右抽屉是覆盖层，宽度独立于中区：380 是需求详情能读的下限，720 再宽就盖满中区了 */
const LIMITS = { left: [180, 360], right: [380, 720] };
const DEFAULTS = { leftW: 244, leftCollapsed: false, rightW: 480, rightCollapsed: false };
/** 抽屉上限随视口收一档：窗口太窄时不至于把中区完全盖死 */
const RIGHT_MAX_RATIO = 0.6;
const RIGHT_MAX_ABS = 720;

/** 左栏收起后的图标窄栏宽度 */
export const RAIL_W = 48;

function maxW(side) {
  if (side !== 'right') return LIMITS[side][1];
  const ratioMax = Math.round(window.innerWidth * RIGHT_MAX_RATIO);
  return Math.min(RIGHT_MAX_ABS, Math.max(LIMITS.right[0], ratioMax));
}

/** 宽度夹到合法区间，非法值回落到默认值 */
export function clampW(n, side) {
  const [min] = LIMITS[side];
  const v = Number(n);
  const base = Number.isFinite(v) ? v : DEFAULTS[side + 'W'];
  return Math.min(Math.max(base, min), maxW(side));
}

function load() {
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) || 'null');
    if (!raw || typeof raw !== 'object') return null;
    // 旧存档的右面板宽度是挤压时代存下来的（240–560，常见 320）：它小于抽屉下限说明是老数据，
    // 顺手把「当时因为挤才收起」的收起状态一并复位 —— 抽屉不再挤压，没有理由替用户保持关闭
    const legacy = Number(raw.rightW) < LIMITS.right[0];
    return {
      leftW: clampW(raw.leftW, 'left'),
      rightW: clampW(raw.rightW, 'right'),
      leftCollapsed: !!raw.leftCollapsed,
      rightCollapsed: legacy ? false : !!raw.rightCollapsed
    };
  } catch (_) {
    return null;
  }
}

/** 三栏壳层布局：左栏 / 右面板的宽度与收起状态，持久化到 localStorage */
export function useLayout() {
  const [layout, setLayout] = useState(() => {
    const saved = load();
    if (saved) return saved;
    // 覆盖式抽屉不挤压中区，窄屏也不必默认收起；旧存档里小于 380 的宽度由 clampW 夹回
    return { ...DEFAULTS };
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(layout));
    } catch (_) {
      /* 写入失败（隐私模式等）时忽略，不影响使用 */
    }
  }, [layout]);

  // 窗口变窄后按新的上限夹回，避免右面板挤出中区
  useEffect(() => {
    const onResize = () => {
      setLayout((l) => {
        const leftW = clampW(l.leftW, 'left');
        const rightW = clampW(l.rightW, 'right');
        return leftW === l.leftW && rightW === l.rightW ? l : { ...l, leftW, rightW };
      });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [setLayout]);

  return { layout, setLayout };
}

/** 分隔条拖拽：pointerdown 后按水平位移回调，拖拽期间锁住选中与光标 */
export function startDrag(e, onMove) {
  if (e.button != null && e.button !== 0) return;
  e.preventDefault();
  const startX = e.clientX;
  const el = e.currentTarget;
  try {
    el.setPointerCapture(e.pointerId);
  } catch (_) {
    /* 不支持 pointer capture 的环境忽略 */
  }
  document.body.classList.add('resizing');

  const move = (ev) => onMove(ev.clientX - startX);
  const end = () => {
    document.body.classList.remove('resizing');
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', end);
    el.removeEventListener('pointercancel', end);
  };
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}

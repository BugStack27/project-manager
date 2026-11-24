/* 全局快捷键：动作清单、绑定结构、本地持久化、按键匹配与冲突校验。
 *
 * 绑定结构 { mod, alt, shift, key }：
 *   mod = Ctrl 或 ⌘（沿用现有跨平台口径，两者视为同一个修饰键，不分别存）
 *   key = 归一化后的主键（单字符统一小写，其它保留 KeyboardEvent.key 原值）
 */

export const SHORTCUT_KEY = 'pm.ui.shortcuts';

/** 平台判断只影响展示，不影响匹配：Mac 显示 ⌘ / ⌥，其它平台显示 Ctrl / Alt */
const IS_MAC =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || '');

/** 键盘上的纯修饰键：录制时只按这些键不算一个完整组合 */
const MODIFIER_KEYS = new Set(['Alt', 'AltGraph', 'Control', 'Meta', 'Shift', 'CapsLock', 'Dead']);

/** 主键的可读名：箭头 / 空格 / 退格等直接转符号，其余用原值 */
const KEY_LABEL = {
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  Escape: 'Esc',
  ' ': 'Space',
  Backspace: '⌫',
  Delete: 'Del',
  Enter: 'Enter',
  Tab: 'Tab',
  Home: 'Home',
  End: 'End',
  PageUp: 'PgUp',
  PageDown: 'PgDn'
};

/** 动作清单：顺序即弹窗里的展示顺序；default 是恢复默认的落点 */
export const SHORTCUT_ACTIONS = [
  {
    id: 'back',
    label: '返回上一页',
    desc: '回到上一个页面，项目选中状态一并恢复',
    default: { mod: false, alt: true, shift: false, key: 'ArrowLeft' }
  },
  {
    id: 'cycleView',
    label: '切换视图页签',
    desc: '在需求中心、启动台、修改记录之间循环切换',
    default: { mod: true, alt: false, shift: false, key: 'Tab' }
  },
  {
    id: 'search',
    label: '全局搜索',
    desc: '搜索项目、需求、运行日志与提交',
    default: { mod: true, alt: false, shift: false, key: 'k' }
  },
  {
    id: 'switchProject',
    label: '切换项目',
    desc: '模糊搜索项目名称或拼音首字母，回车切到该项目',
    default: { mod: true, alt: false, shift: false, key: 'o' }
  },
  {
    id: 'run',
    label: '启动命令面板',
    desc: '跨项目搜索命令，回车启动 / 停止',
    default: { mod: true, alt: false, shift: false, key: 'p' }
  },
  {
    id: 'create',
    label: '新建需求 / 命令',
    desc: '需求中心弹出新建需求，启动台弹出新增命令',
    default: { mod: true, alt: false, shift: false, key: 'n' }
  },
  {
    id: 'projectSettings',
    label: '项目设置',
    desc: '打开当前选中项目的设置弹窗',
    default: { mod: true, alt: false, shift: false, key: ',' }
  },
  {
    id: 'shortcuts',
    label: '快捷键设置',
    desc: '打开这个弹窗，查看与修改快捷键',
    default: { mod: true, alt: false, shift: false, key: '/' }
  }
];

/** 动作 id → 显示名：冲突提示与弹窗标题共用 */
export const ACTION_LABEL = Object.fromEntries(SHORTCUT_ACTIONS.map((a) => [a.id, a.label]));

/** 主键归一化：字母不限大小写，其余键保留原样 */
export function normKey(key) {
  if (typeof key !== 'string' || !key) return '';
  return key.length === 1 ? key.toLowerCase() : key;
}

/** 校验并规整一个绑定；结构不合法时返回 null */
export function normalizeBinding(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const key = normKey(raw.key);
  if (!key || MODIFIER_KEYS.has(key)) return null;
  return { mod: !!raw.mod, alt: !!raw.alt, shift: !!raw.shift, key };
}

export const DEFAULT_BINDINGS = Object.fromEntries(
  SHORTCUT_ACTIONS.map((a) => [a.id, normalizeBinding(a.default)])
);

/** 从键盘事件取绑定；只按修饰键时 key 为空，录制方据此继续等待 */
export function bindingOf(e) {
  return {
    mod: !!(e.ctrlKey || e.metaKey),
    alt: !!e.altKey,
    shift: !!e.shiftKey,
    key: normKey(e.key)
  };
}

/** 是否只是按下了修饰键（还没等到主键） */
export function isModifierOnly(e) {
  return MODIFIER_KEYS.has(e.key) || !normKey(e.key);
}

/** 组合是否可用作快捷键：必须有 Ctrl/⌘ 或 Alt，避免纯字母 / 纯 Shift 误触 */
export function isAllowedBinding(binding) {
  if (!binding || !binding.key) return false;
  return !!(binding.mod || binding.alt);
}

/** 事件是否命中某个绑定 */
export function matchBinding(e, binding) {
  if (!binding) return false;
  // 中文输入法组合态不触发，否则候选词阶段的按键会被当成快捷键
  if (e.isComposing) return false;
  const mod = !!(e.ctrlKey || e.metaKey);
  if (mod !== !!binding.mod) return false;
  if (!!e.altKey !== !!binding.alt) return false;
  if (!!e.shiftKey !== !!binding.shift) return false;
  return normKey(e.key) === binding.key;
}

/** 两个绑定是否是同一个组合 */
export function sameBinding(a, b) {
  if (!a || !b) return false;
  return !!a.mod === !!b.mod && !!a.alt === !!b.alt && !!a.shift === !!b.shift && a.key === b.key;
}

/** 冲突检测：返回占用该组合的动作 id，没有冲突返回 null */
export function conflictOf(bindings, binding, exceptId) {
  for (const action of SHORTCUT_ACTIONS) {
    if (action.id === exceptId) continue;
    if (sameBinding(bindings[action.id], binding)) return action.id;
  }
  return null;
}

/** 绑定 → 按键胶囊文字数组，如 ['Ctrl', 'Shift', 'K'] */
export function formatBinding(binding) {
  if (!binding) return [];
  const out = [];
  if (binding.mod) out.push(IS_MAC ? '⌘' : 'Ctrl');
  if (binding.alt) out.push(IS_MAC ? '⌥' : 'Alt');
  if (binding.shift) out.push(IS_MAC ? '⇧' : 'Shift');
  const k = binding.key;
  const label = KEY_LABEL[k] || (k.length === 1 ? k.toUpperCase() : k);
  out.push(label);
  return out;
}

/**
 * 读取绑定：逐项回落到默认值，脏数据不抛错。
 * 正常使用不会写出重复组合（setBinding / resetOne / resetAll 都校验过）；
 * 手工改坏 localStorage 出现两项同组合时，整份回退默认——
 * 否则两项都会命中，而分发只执行第一个，后一项等于永久失效。
 */
export function loadBindings() {
  let raw = null;
  try {
    raw = JSON.parse(window.localStorage.getItem(SHORTCUT_KEY) || 'null');
  } catch (_) {
    raw = null;
  }
  const out = {};
  for (const action of SHORTCUT_ACTIONS) {
    out[action.id] = normalizeBinding(raw && raw[action.id]) || DEFAULT_BINDINGS[action.id];
  }
  const seen = new Set();
  for (const action of SHORTCUT_ACTIONS) {
    const b = out[action.id];
    const sig = (b.mod ? '1' : '0') + (b.alt ? '1' : '0') + (b.shift ? '1' : '0') + '|' + b.key;
    if (seen.has(sig)) return { ...DEFAULT_BINDINGS };
    seen.add(sig);
  }
  return out;
}

/** 写回 localStorage；隐私模式等写入失败时静默忽略，不影响本次使用 */
export function saveBindings(bindings) {
  try {
    window.localStorage.setItem(SHORTCUT_KEY, JSON.stringify(bindings));
  } catch (_) {
    /* 忽略 */
  }
}

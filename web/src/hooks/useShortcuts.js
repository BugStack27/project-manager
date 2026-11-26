import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ACTION_LABEL,
  DEFAULT_BINDINGS,
  SHORTCUT_ACTIONS,
  acceleratorOf,
  conflictOf,
  isAllowedBinding,
  isPunctuationKey,
  loadBindings,
  matchBinding,
  saveBindings
} from '../lib/shortcuts.js';

/**
 * 全局快捷键的唯一入口：读取 / 保存绑定，并把按键分发给对应动作。
 *
 * - 原本散在 useNavigation、CommandPalette、RunPalette 里的三处 keydown 监听统一收在这里，
 *   改键后立即生效，不需要各组件各读一遍配置。
 * - blocked（弹窗打开）或焦点在输入控件 / 可编辑区域时一律不触发：
 *   需求明确要求这些场景不抢键，也让录制弹窗里的按键不被全局动作截胡。
 * - handlers 每次渲染更新到 ref 里，监听器不必随回调变化重建。
 */
export function useShortcuts({ blocked, handlers }) {
  const [bindings, setBindings] = useState(loadBindings);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const blockedRef = useRef(blocked);
  blockedRef.current = blocked;

  useEffect(() => {
    saveBindings(bindings);
  }, [bindings]);

  // 标点组合（Ctrl+, / Ctrl+/）在中文输入法下 keydown 会被输入法吞掉：渲染进程连 keyup 都收不到，
  // 菜单加速键同样不触发，只有系统级热键能拿到。把这类组合报给主进程，由它在窗口聚焦时注册。
  useEffect(() => {
    if (!window.pm || !window.pm.setShortcutAccelerators) return;
    const list = SHORTCUT_ACTIONS.filter((a) => isPunctuationKey(bindings[a.id] && bindings[a.id].key)).map((a) => ({
      id: a.id,
      accelerator: acceleratorOf(bindings[a.id])
    }));
    window.pm.setShortcutAccelerators(list);
  }, [bindings]);

  // 系统热键触发：与 keydown 同一套门槛（弹窗打开、焦点在输入控件时不响应）。
  // 两条路都开也无妨——标点组合在输入法环境下只有主进程这条能到，正常环境下重复触发的是幂等的「打开某个弹窗」。
  useEffect(() => {
    if (!window.pm || !window.pm.onShortcut) return undefined;
    return window.pm.onShortcut((id) => {
      if (blockedRef.current) return;
      const t = document.activeElement;
      if (t && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      const fn = handlersRef.current && handlersRef.current[id];
      if (fn) fn();
    });
  }, []);

  /** 改键：校验格式与冲突，失败返回文案且不落库；成功返回 null */
  const setBinding = useCallback(
    (id, binding) => {
      if (!SHORTCUT_ACTIONS.some((a) => a.id === id)) return '未知操作';
      if (!isAllowedBinding(binding)) return '快捷键需要包含 Ctrl / ⌘ 或 Alt';
      const clash = conflictOf(bindings, binding, id);
      if (clash) return '该组合已被「' + ACTION_LABEL[clash] + '」占用';
      setBindings((cur) => ({ ...cur, [id]: binding }));
      return null;
    },
    [bindings]
  );

  /** 单项恢复默认：默认组合可能已被别的动作占用（先改走对方后又改了回来），失败返回文案 */
  const resetOne = useCallback(
    (id) => {
      const def = DEFAULT_BINDINGS[id];
      if (!def) return '未知操作';
      const clash = conflictOf(bindings, def, id);
      if (clash) return '默认组合已被「' + ACTION_LABEL[clash] + '」占用，可先改回对方或全部恢复默认';
      setBindings((cur) => ({ ...cur, [id]: def }));
      return null;
    },
    [bindings]
  );

  const resetAll = useCallback(() => setBindings({ ...DEFAULT_BINDINGS }), []);

  useEffect(() => {
    const onKey = (e) => {
      if (blocked) return;
      if (e.isComposing) return;
      const t = e.target;
      const inField =
        !!t &&
        (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
      // 三个命令面板打开即聚焦自己的输入框；它们原来的开关组合在输入框里也能用，
      // 这里只对这三条动作、且焦点确实在面板输入框（.cmdk-input）时放行，保持「可再次按下收起」。
      const inPaletteInput = inField && t.tagName === 'INPUT' && t.closest && t.closest('.cmdk-input');
      for (const action of SHORTCUT_ACTIONS) {
        if (!matchBinding(e, bindings[action.id])) continue;
        if (inField) {
          const ownPalette = action.id === 'search' || action.id === 'run' || action.id === 'switchProject';
          if (!(ownPalette && inPaletteInput)) return;
        }
        e.preventDefault();
        const fn = handlersRef.current && handlersRef.current[action.id];
        if (fn) fn();
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [bindings, blocked]);

  return { bindings, setBinding, resetOne, resetAll };
}

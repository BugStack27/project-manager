import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ACTION_LABEL,
  DEFAULT_BINDINGS,
  SHORTCUT_ACTIONS,
  conflictOf,
  isAllowedBinding,
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

  useEffect(() => {
    saveBindings(bindings);
  }, [bindings]);

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

import { useCallback, useEffect, useRef, useState } from 'react';
import { normalizePref, readPref, resolveApplied, writePref } from '../lib/theme.js';
import { SKIN_BG, normalizeSkin, readSkin, writeSkin } from '../lib/skin.js';

const DARK_QUERY = '(prefers-color-scheme: dark)';

function mql() {
  return typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(DARK_QUERY) : null;
}

function systemDark() {
  const mq = mql();
  return mq ? mq.matches : false;
}

/**
 * 主题运行时：偏好状态 + 系统媒体查询监听 + 应用到 <html> + 通知主进程。
 *
 * - 偏好是唯一真源（三种取值），生效主题由 resolveApplied 派生，不额外存一份。
 * - 首帧定色由 index.html 的内联脚本完成（那时 React 还没挂载）；
 *   这里挂载时再写一次是兜底：内联脚本万一没执行，也不会让暗色用户看到浅底。
 * - 切换瞬间加 theme-switching 类禁用过渡，避免 .pagebar/.toast/.datapop 这些
 *   backdrop-filter 层与半透明叠色区出现互相错位的中间态。
 */
export function useTheme() {
  const [pref, setPref] = useState(readPref);
  const [skin, setSkin] = useState(readSkin);
  const [dark, setDark] = useState(systemDark);
  const applied = resolveApplied(pref, dark);

  // 系统主题切换常驻监听：偏好是「跟随系统」时立即生效，否则只更新备用值
  useEffect(() => {
    const mq = mql();
    if (!mq) return undefined;
    const onChange = (e) => setDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // 已应用过的「主题:皮肤」签名：首次挂载不播放「切换」，避免启动时多一次无意义的类切换
  const appliedRef = useRef(null);

  useEffect(() => {
    const root = document.documentElement;
    const sig = applied + ':' + skin;
    const first = appliedRef.current === null;
    appliedRef.current = sig;

    // 皮肤只影响浅色，但无论明暗都写 data-skin（切回浅色时即时生效）
    root.dataset.skin = skin;
    if (first) {
      root.dataset.theme = applied;
    } else {
      root.classList.add('theme-switching');
      root.dataset.theme = applied;
      // 两帧：一帧让新值参与样式计算，一帧完成绘制，之后才恢复过渡
      requestAnimationFrame(() => {
        requestAnimationFrame(() => root.classList.remove('theme-switching'));
      });
    }

    // 主进程：窗口底色与 Windows 标题栏覆盖色不是 CSS 能管的。
    // 浅色把皮肤主底色一并报上去，标题栏才跟内容同色（深色忽略皮肤底色）。
    window.pm?.setAppearance?.(applied === 'dark', SKIN_BG[skin]);
  }, [applied, skin]);

  const setPrefSafe = useCallback((next) => {
    const v = normalizePref(next);
    setPref(v);
    writePref(v);
  }, []);

  const setSkinSafe = useCallback((next) => {
    const v = normalizeSkin(next);
    setSkin(v);
    writeSkin(v);
  }, []);

  return { pref, applied, skin, setPref: setPrefSafe, setSkin: setSkinSafe };
}

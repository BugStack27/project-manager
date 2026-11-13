import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { installScrollReveal } from './lib/scroll-reveal.js';
import { readSkin } from './lib/skin.js';
import './styles/index.css';

document.documentElement.dataset.platform = window.pm?.platform || 'web';
installScrollReveal();

// 兜底定色：index.html 的内联脚本已经写过一次（首帧无闪）。这里再写一次是为了
// 「内联脚本没执行」的情形（CSP、异常、外部打开构建产物）不至于让暗色用户停在浅底上。
// 真正的运行时逻辑在 hooks/useTheme.js，React 挂载后会接手。
if (!document.documentElement.dataset.theme) {
  let pref = 'system';
  try {
    pref = window.localStorage.getItem('pm.ui.theme') || 'system';
  } catch {
    /* 读不到就按跟随系统 */
  }
  const dark = pref === 'dark' || (pref !== 'light' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}
// 皮肤兜底：同理，内联脚本没执行时也不至于停在无皮肤（:root 经典浅色）上
if (!document.documentElement.dataset.skin) {
  document.documentElement.dataset.skin = readSkin();
}

// 包一层兜底：任何未捕获的渲染异常都换成「重新加载 + 导出诊断包」，而不是白屏
createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);

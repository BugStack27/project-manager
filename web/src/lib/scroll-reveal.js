// 滚动条「滚动时才浮现」：给正在滚动的容器挂 .scrolling，停手 IDLE_MS 后摘掉。
// 配色在 styles/scroll.css —— 原生 ::-webkit-scrollbar-thumb 不吃 CSS 过渡，
// 只能靠这个类做瞬间显隐（macOS 观感）。scroll 事件不冒泡，故在 document 上用捕获阶段统一接。
const IDLE_MS = 800;
const timers = new WeakMap();
let installed = false;

function onScroll(e) {
  const el = e.target;
  // document 级滚动的 target 是 document 本身，不是元素，跳过
  if (!(el instanceof Element)) return;
  el.classList.add('scrolling');
  clearTimeout(timers.get(el));
  timers.set(el, setTimeout(() => el.classList.remove('scrolling'), IDLE_MS));
}

export function installScrollReveal() {
  if (installed) return;
  installed = true;
  document.addEventListener('scroll', onScroll, { capture: true, passive: true });
}
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 桌面应用：产物由 Electron 主进程用 loadFile 打开，必须用相对 base
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true
  },
  build: {
    outDir: '../electron/renderer',
    emptyOutDir: true,
    // 500 kB 是 Vite 面向「网络分发」的默认阈值，判据是首屏下载量。
    // 本应用由 electron/main.js 用 loadFile 从本地磁盘打开，没有网络传输与缓存命中率问题；
    // 主包里的 React / react-markdown / pinyin-pro 词表都是启动时必须解析的依赖，
    // 拆 chunk 只改文件边界，不改启动期总字节数，因此不做分包。
    // 这里把 1100 kB 当作「回归警戒线」：当前主包 990.24 kB，留约 11% 余量；
    // 若后续引入新的大依赖把它顶破，应先查依赖来源，不要直接往上调阈值。
    chunkSizeWarningLimit: 1100
  }
});

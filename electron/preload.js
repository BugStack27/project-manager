'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * 主进程推来的事件可能早于 React 挂载到达（窗口刚重建 / did-finish-load 立即发送），
 * 预加载层先收进队列，订阅时补发：导航留最近 10 条，启动自动拉取结果只留最近一条。
 */
function bufferedChannel(channel, keep) {
  const subs = new Set();
  const queue = [];
  ipcRenderer.on(channel, (_e, payload) => {
    if (subs.size) {
      for (const cb of subs) {
        try { cb(payload); } catch (_) {}
      }
      return;
    }
    queue.push(payload);
    if (queue.length > keep) queue.shift();
  });
  return (cb) => {
    subs.add(cb);
    for (const payload of queue.splice(0, queue.length)) {
      try { cb(payload); } catch (_) {}
    }
    return () => subs.delete(cb);
  };
}

const onNavigateEvent = bufferedChannel('pm:navigate', 10);
const onAutoPullEvent = bufferedChannel('pm:auto-pull', 1);

/** 渲染端唯一原生入口：按方法名调用主进程的领域层 */
contextBridge.exposeInMainWorld('pm', {
  invoke: (method, params) => ipcRenderer.invoke('pm:invoke', method, params),
  platform: process.platform,
  /** 首帧已上屏：主进程据此才显示窗口，避免启动时先露出窗口底色 */
  signalReady: () => ipcRenderer.send('pm:renderer-ready'),
  /** 外观：把生效主题与浅色皮肤底色告知主进程，用于窗口底色与 Windows 标题栏覆盖色（无回执） */
  setAppearance: (dark, lightBg) => ipcRenderer.send('pm:appearance', !!dark, typeof lightBg === 'string' ? lightBg : null),
  /** 退出询问：主进程在 before-quit 里发来，渲染端画完用 answerQuit 回话 */
  onQuitAsk: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('pm:quit-ask', handler);
    return () => ipcRenderer.removeListener('pm:quit-ask', handler);
  },
  answerQuit: (mode) => ipcRenderer.invoke('pm:quit-answer', mode),
  /** 自动更新：动作通道，主进程推 pm:update 回报状态变化 */
  updater: {
    state: () => ipcRenderer.invoke('pm:update', 'state'),
    check: () => ipcRenderer.invoke('pm:update', 'check'),
    download: () => ipcRenderer.invoke('pm:update', 'download'),
    install: () => ipcRenderer.invoke('pm:update', 'install')
  },
  onUpdate: (cb) => {
    const handler = (_e, state) => {
      try {
        cb(state);
      } catch (_) {}
    };
    ipcRenderer.on('pm:update', handler);
    return () => ipcRenderer.removeListener('pm:update', handler);
  },
  /** 崩溃诊断：渲染端异常留痕 + 导出诊断包 */
  crash: {
    list: () => ipcRenderer.invoke('pm:crash', 'list'),
    record: (payload) => ipcRenderer.invoke('pm:crash', 'record', payload),
    export: () => ipcRenderer.invoke('pm:crash', 'export')
  },
  /** 标点快捷键（Ctrl+, 等）在中文输入法下到不了渲染进程，改由主进程注册系统热键兜底 */
  setShortcutAccelerators: (list) => ipcRenderer.send('pm:shortcut-accelerators', Array.isArray(list) ? list : []),
  onShortcut: (cb) => {
    const handler = (_e, id) => {
      try {
        cb(id);
      } catch (_) {}
    };
    ipcRenderer.on('pm:shortcut', handler);
    return () => ipcRenderer.removeListener('pm:shortcut', handler);
  },
  /** 启动自动拉取的结果：主进程在后台跑完后推 pm:auto-pull */
  onAutoPull: onAutoPullEvent,
  /** 通知/审计点击后的统一跳转：主进程推 pm:navigate，渲染端解析项目与页面 */
  onNavigate: onNavigateEvent
});

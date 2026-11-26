'use strict';

const { ipcMain } = require('electron');
const { createDispatcher } = require('./dispatch');

/**
 * hooks.quitAnswer：渲染端自绘的退出询问把用户选择回传过来。
 * 单独开一个通道而不是塞进 pm:invoke——退出不是领域操作，也不该进 dispatch 的能力表。
 */
function registerIpc(dispatch, hooks) {
  ipcMain.handle('pm:invoke', (_event, method, params) => dispatch(method, params));
  if (hooks && hooks.quitAnswer) {
    ipcMain.handle('pm:quit-answer', (_event, mode) => hooks.quitAnswer(mode));
  }
  // 更新与崩溃诊断是「动作」而不是「业务数据」：单独开通道，不进 dispatch 的能力表
  if (hooks && hooks.update) {
    ipcMain.handle('pm:update', (_event, action) => hooks.update(action));
  }
  if (hooks && hooks.crash) {
    ipcMain.handle('pm:crash', (_event, action, payload) => hooks.crash(action, payload));
  }
  // 外观：只改窗口底色与 Windows 标题栏覆盖色，是纯窗口层的动作，不进 dispatch 的能力表。
  // 用 on 而不是 handle —— 它没有返回值，渲染端也不需要回执。
  if (hooks && hooks.appearance) {
    ipcMain.on('pm:appearance', (_event, dark, lightBg) => hooks.appearance(!!dark, lightBg));
  }
  // 标点快捷键的系统热键登记：渲染端说哪些组合要兜底，主进程按窗口焦点注册 / 注销。无回执。
  if (hooks && hooks.shortcutAccelerators) {
    ipcMain.on('pm:shortcut-accelerators', (_event, list) => hooks.shortcutAccelerators(list));
  }
}

module.exports = { createDispatcher, registerIpc };

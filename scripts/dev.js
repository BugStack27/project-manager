'use strict';

const { spawn } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const WEB = path.join(ROOT, 'web');
const VITE_URL = 'http://localhost:5173';

const children = [];
let shuttingDown = false;

function run(label, cmd, args, cwd, env) {
  const child = spawn(cmd, args, {
    cwd,
    stdio: 'inherit',
    env: Object.assign({}, process.env, env || {})
  });
  child.on('error', (err) => {
    console.error('\n[' + label + '] 启动失败：' + err.message);
    shutdown(1);
  });
  child.on('exit', (code) => {
    if (!shuttingDown) {
      console.log('\n[' + label + '] 已退出 (code ' + code + ')，正在关闭其他进程…');
      shutdown(code || 0);
    }
  });
  children.push(child);
  return child;
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) {
    try { c.kill(); } catch (_) {}
  }
  setTimeout(() => process.exit(code || 0), 200);
}

console.log('\n  开发模式：Vite ' + VITE_URL + ' · Electron 窗口加载该地址（数据走 IPC）\n');

run('web', process.execPath, [path.join(WEB, 'node_modules', 'vite', 'bin', 'vite.js')], WEB);

// 让 Vite 先起来，再拉窗口
setTimeout(() => {
  let electronPath;
  try {
    electronPath = require(path.join(ROOT, 'node_modules', 'electron'));
  } catch (e) {
    console.error('\n[app] 未安装 electron，请先运行 npm install');
    shutdown(1);
    return;
  }
  run('app', electronPath, [ROOT], ROOT, { PM_DEV_URL: VITE_URL });
}, 1500);

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

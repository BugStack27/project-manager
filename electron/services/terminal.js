'use strict';

const { spawn } = require('child_process');

/**
 * 打开系统终端，工作目录设为项目目录。
 * 不依赖 electron：按平台候选顺序启动，前一个不可用（如未安装 Windows Terminal）时自动回退。
 */

function candidates(dir) {
  if (process.platform === 'win32') {
    return [
      { name: 'Windows Terminal', bin: 'wt.exe', args: ['-d', dir] },
      { name: 'PowerShell', bin: 'powershell.exe', args: ['-NoExit'], cwd: dir },
      { name: '命令提示符', bin: 'cmd.exe', args: ['/K'], cwd: dir }
    ];
  }
  if (process.platform === 'darwin') {
    return [{ name: 'Terminal', bin: 'open', args: ['-a', 'Terminal', dir] }];
  }
  return [
    { name: '终端', bin: 'x-terminal-emulator', args: [], cwd: dir },
    { name: 'GNOME Terminal', bin: 'gnome-terminal', args: ['--working-directory=' + dir] },
    { name: 'Konsole', bin: 'konsole', args: ['--workdir', dir] },
    { name: 'Xfce Terminal', bin: 'xfce4-terminal', args: ['--working-directory=' + dir] },
    { name: 'xterm', bin: 'xterm', args: [], cwd: dir }
  ];
}

/** 等到 spawn 事件才算成功；ENOENT 等错误由调用方换下一个候选 */
function launch(item) {
  return new Promise((resolve, reject) => {
    const child = spawn(item.bin, item.args, {
      cwd: item.cwd || undefined,
      detached: true,
      stdio: 'ignore',
      shell: false,
      windowsHide: false
    });
    child.once('error', reject);
    child.once('spawn', () => {
      child.removeListener('error', reject);
      child.on('error', (e) => console.error('[terminal] ' + item.bin + ' 运行失败：' + e.message));
      child.unref();
      resolve();
    });
  });
}

async function open(dir) {
  const errors = [];
  for (const item of candidates(String(dir || ''))) {
    try {
      await launch(item);
      return item.name;
    } catch (e) {
      errors.push(item.name + '：' + (e.code || e.message));
    }
  }
  const err = new Error('无法打开终端（已尝试 ' + errors.join('；') + '）');
  err.code = 'terminal_failed';
  err.status = 500;
  throw err;
}

module.exports = { open, candidates };

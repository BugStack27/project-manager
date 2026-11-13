'use strict';

/**
 * 运行宿主进程。
 *
 * 由 runner 以 `ELECTRON_RUN_AS_NODE=1` 拉起，用途只有一个：代持真实命令的 stdout/stderr。
 * 应用退出（分离）后，管道读端不再属于应用，命令才不会因为控制台管道断开（EPIPE）被带走。
 * 本进程的存活期 == 命令的存活期，因此「宿主 pid 是否存活」就是「服务是否仍在运行」。
 *
 * 入参：argv[2] = base64(JSON { text, cwd, logFile, stateFile })
 */

const fs = require('fs');
const { spawn } = require('child_process');

const spec = JSON.parse(Buffer.from(String(process.argv[2] || ''), 'base64').toString('utf8'));

function pad(n) {
  return String(n).padStart(2, '0');
}

function clock() {
  const d = new Date();
  return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}

/** 同步逐行追加：宿主被强杀时也不丢已产生的行，且不与其他写方抢缓冲 */
function writeLine(level, text) {
  const clean = String(text == null ? '' : text).replace(/\t/g, '  ');
  try {
    fs.appendFileSync(spec.logFile, clock() + '\t' + level + '\t' + clean + '\n');
  } catch (_) {}
}

/** 重启后靠它判断这次运行是「还在跑」还是「已结束」，写完整再 rename，避免读到半截 */
function writeState(state) {
  try {
    const tmp = spec.stateFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ hostPid: process.pid, ...state }));
    fs.renameSync(tmp, spec.stateFile);
  } catch (_) {}
}

/**
 * 控制通道只给应用传一行 pid。应用退出后管道关闭会抛 EPIPE，
 * 这里吞掉，否则宿主会跟着退出、把命令一起带走 —— 正是要避免的事。
 */
function tell(line) {
  try {
    process.stdout.write(line + '\n');
  } catch (_) {}
}
process.stdout.on('error', () => {});
process.stderr.on('error', () => {});

/** 按行切分输出，半行留到下次，避免日志里出现断行 */
function makeSink(level) {
  let buf = '';
  const write = (chunk) => {
    buf += chunk.toString('utf8');
    const parts = buf.split(/\r?\n/);
    buf = parts.pop();
    for (const line of parts) writeLine(level, line);
  };
  write.flush = () => {
    if (buf) writeLine(level, buf);
    buf = '';
  };
  return write;
}

const out = makeSink('info');
const err = makeSink('err');

writeLine('info', '$ ' + spec.text);
writeLine('info', 'cwd  ' + spec.cwd);

// 子进程不能继承 ELECTRON_RUN_AS_NODE：它只对本宿主（Electron 可执行文件）有意义
const env = {
  ...process.env,
  FORCE_COLOR: process.env.FORCE_COLOR ?? '3',
  CLICOLOR_FORCE: process.env.CLICOLOR_FORCE ?? '1',
  COLORTERM: process.env.COLORTERM ?? 'truecolor',
  TERM: process.env.TERM ?? 'xterm-256color'
};
delete env.ELECTRON_RUN_AS_NODE;

// 中文 Windows 上 cmd 默认输出 GBK，先切到 65001 再执行，避免日志乱码
const shellCmd = process.platform === 'win32' ? 'chcp 65001>nul && ' + spec.text : spec.text;

let child;
try {
  child = spawn(shellCmd, { cwd: spec.cwd, shell: true, windowsHide: true, env });
} catch (e) {
  writeLine('err', '启动失败：' + e.message);
  writeState({ pid: null, status: 'failed', exitCode: null, endedAt: new Date().toISOString() });
  process.exit(1);
}

writeState({ pid: child.pid || null, status: 'running', exitCode: null, endedAt: null });
if (child.pid) {
  writeLine('ok', '进程已启动 · pid ' + child.pid);
  tell('PID ' + child.pid);
} else {
  writeLine('info', '正在启动…');
}

let finished = false;

function finish(code, signal) {
  if (finished) return;
  finished = true;
  out.flush();
  err.flush();
  const exitCode = typeof code === 'number' ? code : null;
  const ok = exitCode === 0;
  writeLine(
    ok ? 'ok' : 'err',
    '进程已退出 (code ' + (exitCode === null ? '—' : exitCode) + (signal ? ' · ' + signal : '') + ')'
  );
  writeState({
    pid: child.pid || null,
    status: ok ? 'exited' : 'failed',
    exitCode,
    endedAt: new Date().toISOString()
  });
  process.exit(exitCode === null ? 1 : exitCode);
}

child.stdout.on('data', out);
child.stderr.on('data', err);
child.on('error', (e) => {
  writeLine('err', '进程错误：' + e.message);
  finish(null, null);
});
child.on('close', finish);

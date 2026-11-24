'use strict';

const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const store = require('./store');
const eventLog = require('./event-log');
const { actor } = eventLog;

const MAX_RUNS = 20;
const LOG_TAIL_BYTES = 512 * 1024;
/** 中转宿主：命令由它代持管道，应用退出（分离）后它继续跑 */
const HOST_SCRIPT = path.join(__dirname, 'run-host.js');

/** commandId -> entry */
const live = new Map();

function pad(n) {
  return String(n).padStart(2, '0');
}

function clock() {
  const d = new Date();
  return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}

function logAbsPath(run) {
  const rel = String(run.logFile || '').replace(/^runs\//, '');
  return path.join(store.RUNS_DIR, rel);
}

function stateAbsPath(run) {
  return logAbsPath(run).replace(/\.log$/, '.state.json');
}

function projectNameOf(command) {
  const p = store.get().projects.find((x) => x.id === command.projectId);
  return p ? p.name : '';
}

function commandData(command, extra) {
  return { projectName: projectNameOf(command), name: command.name || '', text: command.text, ...extra };
}

function durationMs(run) {
  const start = Date.parse(run.startedAt);
  const end = Date.parse(run.endedAt);
  return Number.isFinite(start) && Number.isFinite(end) && end >= start ? end - start : 0;
}

/**
 * 应用自己补写的行（停止提示等）。正常输出与退出行都由宿主写，
 * 宿主被 taskkill /F 强杀时写不出任何东西，所以这两行只能由这里补。
 */
function appendLine(run, level, text) {
  const clean = String(text == null ? '' : text).replace(/\t/g, '  ');
  try {
    fs.appendFileSync(logAbsPath(run), clock() + '\t' + level + '\t' + clean + '\n');
  } catch (_) {}
}

function readState(run) {
  try {
    return JSON.parse(fs.readFileSync(stateAbsPath(run), 'utf8'));
  } catch (_) {
    return null;
  }
}

/** 宿主 pid 存活即「服务仍在运行」；EPERM 说明进程存在但无权操作，同样算活 */
function isAlivePid(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

/**
 * 分离出去、宿主仍活着的最后一次运行（应用重启后 live 里没有它，只能靠库里的 hostPid 认）。
 * 用最后一次运行而不是全量搜索：同一命令后续又启动过，旧的分离记录就该让位。
 */
function detachedRun(command) {
  const runs = command.runs || [];
  const last = runs.length ? runs[runs.length - 1] : null;
  return last && last.status === 'detached' && isAlivePid(last.hostPid) ? last : null;
}

/**
 * 应用侧补写 state.json：宿主被 /F 强杀时来不及写，重启后 recover 只能读这个文件补退出码。
 * 与 run-host.js 一样用 tmp + rename，避免半截 JSON。
 */
function writeState(run, status, exitCode, endedAt) {
  const payload = {
    hostPid: run.hostPid || null,
    pid: run.pid || null,
    status,
    exitCode: exitCode === undefined ? null : exitCode,
    endedAt: endedAt || new Date().toISOString()
  };
  const file = stateAbsPath(run);
  try {
    fs.writeFileSync(file + '.tmp', JSON.stringify(payload));
    fs.renameSync(file + '.tmp', file);
  } catch (_) {}
}

/**
 * 终止宿主进程树。Windows 走 taskkill /T /F（异步等结果），POSIX 按进程组发 SIGTERM。
 * 与托管中的 stop 用同一条命令，区别只在 pid 来源：那边的 pid 来自 child 句柄，这边来自库里的 hostPid。
 */
function terminateHostTree(hostPid, cb) {
  if (process.platform === 'win32') {
    execFile('taskkill', ['/PID', String(hostPid), '/T', '/F'], { windowsHide: true }, cb);
    return;
  }
  try {
    process.kill(-hostPid, 'SIGTERM');
  } catch (_) {
    try {
      process.kill(hostPid, 'SIGTERM');
    } catch (e) {
      cb(e);
      return;
    }
  }
  cb(null);
}

function finalize(entry, code, signal) {
  if (entry.finalized) return;
  entry.finalized = true;

  const run = entry.run;
  if (run.status === 'running') {
    if (entry.stopping) run.status = 'stopped';
    else if (entry.spawnError) run.status = 'failed';
    else run.status = code === 0 ? 'exited' : 'failed';
  }
  run.exitCode = typeof code === 'number' ? code : null;
  run.endedAt = new Date().toISOString();

  // 手动停止时宿主多半被强杀、写不出退出行，由这里补；
  // 但命令恰好在 taskkill 生效前自行结束的话宿主已经写过，state 里能看到，不重复补。
  if (entry.stopping) {
    const st = readState(run);
    if (!st || st.status === 'running') {
      const code2 = run.exitCode === null ? '—' : run.exitCode;
      appendLine(run, 'ok', '进程已退出 (code ' + code2 + (signal ? ' · ' + signal : '') + ')');
    }
  }

  live.delete(entry.commandId);
  try { store.save(); } catch (e) { console.error('[runner] 保存运行状态失败:', e.message); }
  const extra = {
    runId: run.id,
    exitCode: run.exitCode,
    signal: signal || null,
    durationMs: durationMs(run),
    status: run.status
  };
  let type = entry.stopping ? 'command.stopped' : 'command.exited';
  if (entry.spawnError) {
    type = 'command.spawn_failed';
    extra.message = entry.spawnErrorMessage || '启动失败';
  }
  eventLog.append({
    type,
    projectId: entry.command.projectId,
    commandId: entry.command.id,
    actor: actor.system('runner'),
    data: commandData(entry.command, extra)
  });
  trimRuns(entry.command);
}

function trimRuns(command) {
  if (!Array.isArray(command.runs) || command.runs.length <= MAX_RUNS) return;
  const removed = command.runs.slice(0, command.runs.length - MAX_RUNS);
  command.runs = command.runs.slice(-MAX_RUNS);
  for (const run of removed) {
    if (live.has(command.id) && live.get(command.id).run.id === run.id) continue;
    try { fs.unlinkSync(logAbsPath(run)); } catch (_) {}
    try { fs.unlinkSync(stateAbsPath(run)); } catch (_) {}
  }
  try { store.save(); } catch (_) {}
}

function start(command) {
  if (live.has(command.id)) {
    const err = new Error('该命令已在运行中，先停止再启动');
    err.code = 'already_running';
    err.status = 409;
    throw err;
  }

  const run = {
    id: store.uid('run'),
    startedAt: new Date().toISOString(),
    endedAt: null,
    status: 'running',
    exitCode: null,
    pid: null,
    hostPid: null,
    logFile: 'runs/' + store.uid('log') + '.log'
  };

  const entry = {
    commandId: command.id,
    command,
    run,
    child: null,
    stopping: false,
    spawnError: false,
    finalized: false
  };

  store.ensureDirs();
  // 项目扩展信息里的环境变量：并入宿主 env，由宿主透传给命令子进程；
  // 走 spawn env 而不是 argv，避免 Windows 命令行长度上限
  const project = store.get().projects.find((p) => p.id === command.projectId);
  const projectEnv = {};
  if (!command.noProjectEnv && project && project.extras && Array.isArray(project.extras.env)) {
    project.extras.env.forEach((v) => {
      if (v && v.key) projectEnv[v.key] = String(v.value == null ? '' : v.value);
    });
  }
  const envCount = Object.keys(projectEnv).length;

  const spec = {
    text: command.text,
    cwd: command.cwd,
    logFile: logAbsPath(run),
    stateFile: stateAbsPath(run)
  };

  let child;
  try {
    // detached + ELECTRON_RUN_AS_NODE：宿主脱离本进程的会话，应用退出后仍能代持管道
    child = spawn(process.execPath, [HOST_SCRIPT, Buffer.from(JSON.stringify(spec)).toString('base64')], {
      env: { ...process.env, ...projectEnv, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
      windowsHide: true
    });
  } catch (e) {
    entry.spawnError = true;
    entry.spawnErrorMessage = e.message;
    appendLine(run, 'err', '启动失败：' + e.message);
    command.runs.push(run);
    finalize(entry, null, null);
    return run;
  }

  entry.child = child;
  run.hostPid = child.pid || null;
  live.set(command.id, entry);
  command.runs.push(run);
  // 应用只是观察者：宿主不该把 Electron 的事件循环拴住
  child.unref();

  try { store.save(); } catch (e) { console.error('[runner] 保存启动状态失败:', e.message); }
  eventLog.append({
    type: 'command.started',
    projectId: command.projectId,
    commandId: command.id,
    actor: actor.system('runner'),
    data: commandData(command, { runId: run.id, envCount })
  });

  // 宿主 stdout 只有一行 PID：真实命令进程号，日志输出不经过这里
  let outBuf = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (c) => {
    outBuf += c;
    let i;
    while ((i = outBuf.indexOf('\n')) >= 0) {
      const line = outBuf.slice(0, i).replace(/\r$/, '');
      outBuf = outBuf.slice(i + 1);
      const m = /^PID (\d+)$/.exec(line);
      if (m) run.pid = Number(m[1]);
    }
  });
  child.stderr.on('data', (c) => process.stderr.write('[runner] ' + c));

  child.on('error', (e) => {
    entry.spawnError = true;
    entry.spawnErrorMessage = e.message;
    appendLine(run, 'err', '启动失败：' + e.message);
    finalize(entry, null, null);
  });

  child.on('close', (code, signal) => finalize(entry, code, signal));

  return run;
}

function stop(command) {
  const entry = live.get(command.id);
  if (!entry) return stopDetached(command);
  if (!entry.child) {
    const err = new Error('该命令当前没有在运行');
    err.code = 'not_running';
    err.status = 409;
    throw err;
  }
  if (entry.stopping) return entry.run;

  entry.stopping = true;
  appendLine(entry.run, 'warn', '收到停止信号，正在终止进程树…');

  const pid = entry.child.pid;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
    } else {
      // 宿主是 detach 出来的进程组组长，按组杀才能带走真正的命令
      try {
        process.kill(-pid, 'SIGTERM');
      } catch (_) {
        entry.child.kill('SIGTERM');
      }
    }
  } catch (e) {
    appendLine(entry.run, 'err', '终止失败：' + e.message);
  }

  return entry.run;
}

/**
 * 停止已分离的命令：应用侧没有 live 句柄，靠库里的 hostPid 杀掉宿主进程树。
 * 没有 close 事件可等，状态必须在这里主动收敛并补 state，否则会永远停在 detached。
 */
function stopDetached(command) {
  const run = detachedRun(command);
  if (!run) {
    const err = new Error('该命令当前没有在运行');
    err.code = 'not_running';
    err.status = 409;
    throw err;
  }

  appendLine(run, 'warn', '收到停止信号，正在终止进程树…');

  // 先收敛再看结果：taskkill /F 对存活进程基本必成功，界面上不该出现「已停止但跑着」的中间态
  const endedAt = new Date().toISOString();
  run.status = 'stopped';
  run.endedAt = endedAt;
  run.exitCode = null;
  writeState(run, 'stopped', null, endedAt);
  appendLine(run, 'ok', '进程已退出 (code —)');
  try { store.save(); } catch (_) {}

  const hostPid = run.hostPid;
  terminateHostTree(hostPid, (e) => {
    // 失败但进程确实没了（多半是刚自己结束）：收敛结果仍然成立，不翻案
    if (!e || !isAlivePid(hostPid)) {
      eventLog.append({
        type: 'command.stopped',
        projectId: command.projectId,
        commandId: command.id,
        actor: actor.system('runner'),
        data: commandData(command, { runId: run.id, exitCode: null, status: 'stopped' })
      });
      return;
    }
    appendLine(run, 'err', '终止失败：' + (e.message || e.code));
    // 真没杀掉就得如实退回，否则界面会停在「已手动停止」而进程还在占端口
    run.status = 'detached';
    run.endedAt = null;
    writeState(run, 'running', null);
    try { store.save(); } catch (_) {}
    eventLog.append({
      type: 'command.detached',
      projectId: command.projectId,
      commandId: command.id,
      actor: actor.system('runner'),
      data: commandData(command, { runId: run.id, hostPid, status: 'detached', reason: 'stop_failed' })
    });
  });

  return run;
}

/**
 * 退出时分离：不杀进程，只解除应用的托管关系。
 * 宿主已 detach 且独立持有管道，应用退出后它照常写日志。
 */
function detachAll() {
  const now = new Date().toISOString();
  const detached = [];
  for (const entry of live.values()) {
    entry.finalized = true; // 应用马上退出，close 回调不该再改这条运行记录
    entry.run.status = 'detached';
    entry.run.detachedAt = now;
    detached.push({ command: entry.command, run: entry.run });
    if (entry.child) {
      try { entry.child.stdout.destroy(); } catch (_) {}
      try { entry.child.stderr.destroy(); } catch (_) {}
      try { entry.child.unref(); } catch (_) {}
    }
  }
  const count = live.size;
  live.clear();
  try { store.save(); } catch (_) {}
  for (const { command, run } of detached) {
    eventLog.append({
      type: 'command.detached',
      projectId: command.projectId,
      commandId: command.id,
      actor: actor.system('runner'),
      data: commandData(command, { runId: run.id, hostPid: run.hostPid, status: 'detached' })
    });
  }
  return count;
}

/**
 * 退出提示用：当前在跑的命令。
 * 分离出去但宿主还活着的同样算「在跑」—— 退出时不提醒的话，用户会以为已经把服务停了。
 */
function runningList() {
  return store.get().commands.filter(isActive).map((c) => ({
    id: c.id,
    name: c.name || '',
    text: c.text,
    cwd: c.cwd
  }));
}

function isRunning(commandId) {
  return live.has(commandId);
}

/**
 * 命令是否仍在跑：本应用托管中，或分离出去但宿主还活着。
 * 编辑 / 删除 / 退出提示 / 恢复备份都用它，不能用 isRunning —— 分离的进程一样占端口、一样需要先停下。
 */
function isActive(command) {
  return live.has(command.id) || !!detachedRun(command);
}

function runningPid(commandId) {
  const entry = live.get(commandId);
  if (!entry) return null;
  return entry.run.pid || (entry.child ? entry.child.pid : null);
}

/**
 * 服务重启后的收尾：
 * - 库里仍是 running 的：宿主还活着说明上次是分离 / 崩溃退出，进程仍在跑 → 记为 detached；
 *   否则按原有口径标记为中断。
 * - 已是 detached 的：宿主已结束就把退出码与结束时间回填。
 */
function recover() {
  const db = store.get();
  let touched = false;
  const recovered = [];
  for (const command of db.commands) {
    for (const run of command.runs) {
      if (run.status === 'running') {
        if (run.hostPid && isAlivePid(run.hostPid)) {
          run.status = 'detached';
          run.detachedAt = new Date().toISOString();
          appendLine(run, 'warn', '应用退出后进程仍在运行（已分离）');
        } else {
          run.status = 'interrupted';
          run.endedAt = new Date().toISOString();
          appendLine(run, 'warn', '服务重启，本次运行的进程已丢失');
        }
        touched = true;
        recovered.push({ command, run });
      } else if (run.status === 'detached') {
        const st = readState(run);
        if (st && st.status !== 'running') {
          const nextExit = st.exitCode === undefined ? run.exitCode : st.exitCode;
          const nextEnded = st.endedAt || run.endedAt || null;
          if (run.exitCode !== nextExit || run.endedAt !== nextEnded) {
            run.exitCode = nextExit;
            run.endedAt = nextEnded;
            touched = true;
            recovered.push({ command, run });
          }
        }
      }
    }
  }
  if (touched) {
    store.save();
    for (const { command, run } of recovered) {
      eventLog.append({
        type: 'command.recovered',
        projectId: command.projectId,
        commandId: command.id,
        actor: actor.system('runner'),
        data: commandData(command, { runId: run.id, status: run.status, exitCode: run.exitCode, endedAt: run.endedAt })
      });
    }
  }
}

function readLog(command, runId) {
  const runs = command.runs || [];
  const run = runId ? runs.find((r) => r.id === runId) : runs[runs.length - 1];
  if (!run) return null;
  const file = logAbsPath(run);
  if (!fs.existsSync(file)) return { run, lines: [], truncated: false };

  let text = '';
  let truncated = false;
  try {
    const size = fs.statSync(file).size;
    if (size > LOG_TAIL_BYTES) {
      // 超长日志只回最后一段，避免面板被几 MB 的输出拖死
      const fd = fs.openSync(file, 'r');
      const buf = Buffer.alloc(LOG_TAIL_BYTES);
      fs.readSync(fd, buf, 0, buf.length, size - buf.length);
      fs.closeSync(fd);
      text = buf.toString('utf8');
      const nl = text.indexOf('\n');
      if (nl >= 0) text = text.slice(nl + 1);
      truncated = true;
    } else {
      text = fs.readFileSync(file, 'utf8');
    }
  } catch (_) {
    return { run, lines: [], truncated: false };
  }

  const lines = [];
  for (const raw of text.split('\n')) {
    if (!raw) continue;
    const i = raw.indexOf('\t');
    const j = raw.indexOf('\t', i + 1);
    if (i < 0 || j < 0) {
      lines.push({ t: '', level: 'info', text: raw });
      continue;
    }
    lines.push({ t: raw.slice(0, i), level: raw.slice(i + 1, j), text: raw.slice(j + 1) });
  }
  return { run, lines, truncated };
}

module.exports = {
  start,
  stop,
  detachAll,
  runningList,
  isRunning,
  isActive,
  runningPid,
  isAlivePid,
  recover,
  readLog,
  MAX_RUNS
};

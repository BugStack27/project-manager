'use strict';

const { spawn } = require('child_process');

/**
 * cloudflared 临时隧道的进程托管。
 *
 * 只做一件事：把本机 7318 端口挂到一个 `https://xxx.trycloudflare.com` 上，并保证这个地址活着。
 * 临时隧道没有 SLA：进程退出、断连超过 5 分钟、边缘回收都会让地址失效，所以这里必须
 * 既看守进程也看守链路 —— 只看进程存活是不够的（进程活着但隧道已死是常态）。
 *
 * 启动方（main.js）负责把拿到的地址广播给手机；这里只产地址，不关心谁在用。
 */

/** cloudflared 把地址打在 stderr 的框里；取整段输出里第一个匹配就够 */
const URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;
/** 自检间隔与容错：连续两次失败才判定隧道已死，避免一次网络抖动就重启 */
const HEALTH_EVERY_MS = 30 * 1000;
const HEALTH_TIMEOUT_MS = 8 * 1000;
const HEALTH_MAX_FAILS = 2;
/** 重启退避：隧道几乎立刻能重开，但若是 cloudflared 本身崩了，别把它刷成忙等 */
const BACKOFF_MS = [1000, 2000, 5000, 10000, 30000, 60000];
/** 扫 URL 时只保留尾部，避免 cloudflared 的日志把内存吃满 */
const TAIL_BYTES = 4096;

function createTunnel({ port, binary, log, onState }) {
  let child = null;
  let stopped = true;
  let url = '';
  let buffer = '';
  let healthTimer = null;
  let healthFails = 0;
  let restartTimer = null;
  let attempt = 0;
  let checking = false;

  const state = {
    running: false,
    url: '',
    error: null,
    startedAt: null,
    restarts: 0
  };

  function emit() {
    if (typeof onState === 'function') {
      try {
        onState({ ...state });
      } catch (_) {
        /* 回调出错不能影响隧道本身 */
      }
    }
  }

  function setError(code, message) {
    state.error = { code, message };
    if (typeof log === 'function') log('[tunnel] ' + message);
    emit();
  }

  function clearTimer() {
    if (healthTimer) clearInterval(healthTimer);
    healthTimer = null;
    if (restartTimer) clearTimeout(restartTimer);
    restartTimer = null;
  }

  /** 端到端自检：打的是公网地址，能通说明「边缘 → 隧道 → 本机」整条链都活着 */
  async function checkHealth() {
    if (!url || checking || stopped) return;
    checking = true;
    try {
      const res = await fetch(url + '/remote/hello', {
        signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS)
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      healthFails = 0;
      if (state.error) {
        state.error = null;
        emit();
      }
    } catch (e) {
      healthFails += 1;
      if (healthFails >= HEALTH_MAX_FAILS) {
        healthFails = 0;
        setError('tunnel_unreachable', '隧道地址已失效，正在重连：' + (e && e.message ? e.message : '自检失败'));
        restartNow();
      }
    } finally {
      checking = false;
    }
  }

  function handleChunk(chunk) {
    buffer = (buffer + chunk).slice(-TAIL_BYTES);
    if (url) return;
    const match = URL_RE.exec(buffer);
    if (!match) return;
    url = match[0];
    state.url = url;
    state.running = true;
    state.error = null;
    state.startedAt = new Date().toISOString();
    attempt = 0;
    healthFails = 0;
    if (typeof log === 'function') log('[tunnel] 地址就绪：' + url);
    emit();
    if (healthTimer) clearInterval(healthTimer);
    healthTimer = setInterval(checkHealth, HEALTH_EVERY_MS);
    // 刚拿到地址时先自检一次：地址到手但路由没铺好是常见情况，等 1 秒再打
    setTimeout(checkHealth, 1000);
  }

  function spawnOnce() {
    const bin = binary || (process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
    url = '';
    buffer = '';
    state.running = false;
    state.url = '';
    try {
      child = spawn(bin, ['tunnel', '--url', 'http://127.0.0.1:' + port, '--no-autoupdate'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      });
    } catch (e) {
      state.error = { code: 'tunnel_spawn_failed', message: '无法启动 cloudflared：' + e.message };
      emit();
      return;
    }

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', handleChunk);
    child.stderr.on('data', handleChunk);

    child.on('error', (e) => {
      if (e && e.code === 'ENOENT') {
        stopped = true;
        setError('cloudflared_missing', '没找到 cloudflared，请先安装（winget install Cloudflare.cloudflared）');
        return;
      }
      setError('tunnel_error', 'cloudflared 启动失败：' + (e && e.message ? e.message : '未知错误'));
    });

    child.on('exit', (code) => {
      child = null;
      state.running = false;
      state.url = '';
      url = '';
      if (healthTimer) clearInterval(healthTimer);
      healthTimer = null;
      if (stopped) {
        emit();
        return;
      }
      // 自己被回收（含 5 分钟断连被清理）也要重开：地址会变，广播交给上层
      state.restarts += 1;
      const wait = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
      attempt += 1;
      setError('tunnel_exited', '隧道已断开，' + Math.round(wait / 1000) + ' 秒后重连（退出码 ' + code + '）');
      restartTimer = setTimeout(() => {
        if (!stopped) spawnOnce();
      }, wait);
    });
  }

  function restartNow() {
    clearTimer();
    if (child) {
      try {
        child.kill();
      } catch (_) {
        /* 已经没了就不用管 */
      }
      child = null;
    }
    if (!stopped) spawnOnce();
  }

  return {
    /** 启动（幂等）：已经在跑就直接返回当前状态 */
    start() {
      if (!stopped && child) return { ...state };
      stopped = false;
      attempt = 0;
      spawnOnce();
      return { ...state };
    },

    stop() {
      stopped = true;
      clearTimer();
      if (child) {
        try {
          child.kill();
        } catch (_) {
          /* 忽略：进程可能已经退出 */
        }
        child = null;
      }
      state.running = false;
      state.url = '';
      state.startedAt = null;
      url = '';
      attempt = 0;
      emit();
      return { ...state };
    },

    snapshot() {
      return { ...state };
    },

    /** 隧道地址变化时上层要立刻广播，这里给一个「当前是否已有地址」的判据 */
    hasUrl() {
      return !!url;
    }
  };
}

module.exports = { createTunnel, URL_RE };

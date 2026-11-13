'use strict';

/**
 * 自动更新（electron-updater）。
 *
 * 三层判断，任何一层不满足都只降级、不抛错：
 *   1. 非打包态（npm run dev / electron .）→ unsupported，界面直说「开发版不检查更新」
 *   2. 没配更新源（resources/ 下没有 app-update.yml，也没有 PM_UPDATE_URL）→ unconfigured
 *   3. 有源但网络或验签失败 → error，把原始原因带回界面，不吞
 *
 * 更新源怎么配：package.json 的 build.publish 填 GitHub 镜像仓（provider=github，owner/repo 改成
 * 你自己的），electron-builder 打包时会把 app-update.yml 一并产出，运行时由 electron-updater 自己读，
 * 代码里不硬编码 URL。临时换源（自建静态目录 / 对象存储）用 PM_UPDATE_URL + generic provider。
 *
 * 为什么 autoDownload = false：这台机器上可能正在跑 npm install 或 docker，静默拉几十兆不合适。
 * 下载必须由用户点，状态机因此只有 6 个相位，界面可以直说现在在干什么。
 *
 * 为什么 install 要先自己清理再 quitAndInstall：应用有「有命令在跑时退出要问分离/停止」的逻辑
 * （main.js 的 before-quit），更新器拉起安装程序时如果撞上这个询问，用户会被卡在弹窗上永远装不上。
 * 所以安装前先把退出流程跑完（停进程、存库、关 MCP），再交给更新器。
 */

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

/** 首次检查延后：启动瞬间在抢 IO（读库、扫 IDE、起 MCP），别在这时候发网络请求 */
const FIRST_CHECK_DELAY = 8000;
const CHECK_EVERY = 6 * 60 * 60 * 1000;

let autoUpdater = null;
let timer = null;
let emit = () => {};
let onBeforeInstall = null;

/**
 * phase：
 *   idle / checking / available / downloading / downloaded / up-to-date / error / unsupported / unconfigured
 * 注意 available 与 downloaded 是两个停点：前者只拿到版本号，后者安装包已经落盘。
 */
const state = {
  phase: 'idle',
  current: null,
  version: null,
  percent: 0,
  error: null,
  checkedAt: null
};

function snapshot() {
  return { ...state, current: app.getVersion() };
}

function set(patch) {
  Object.assign(state, patch);
  try {
    emit(snapshot());
  } catch (_) {}
}

/** generic 源的临时覆盖：只在配了 http(s) 时才认，避免环境变量写错把更新器指到 file: */
function feedUrl() {
  const url = String(process.env.PM_UPDATE_URL || '').trim();
  return /^https?:\/\//i.test(url) ? url : '';
}

function hasAppUpdateYml() {
  try {
    return fs.existsSync(path.join(process.resourcesPath, 'app-update.yml'));
  } catch (_) {
    return false;
  }
}

/** electron-updater 的报错偏底层（ENOENT app-update.yml / net::ERR_…），翻成用户能懂的一句话 */
function friendly(e) {
  const msg = (e && e.message) || String(e || '未知错误');
  if (/app-update\.yml/i.test(msg)) return '未配置更新源（打包时缺少 app-update.yml）';
  if (/net::|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNREFUSED|ECONNRESET/i.test(msg)) {
    return '无法连接更新服务器：' + msg;
  }
  if (/sha512|signature|checksum/i.test(msg)) return '安装包校验失败（可能是下载不完整或签名不匹配）';
  return msg;
}

function wire() {
  autoUpdater.on('checking-for-update', () => set({ phase: 'checking', error: null }));
  autoUpdater.on('update-available', (info) =>
    set({ phase: 'available', version: (info && info.version) || null, error: null })
  );
  autoUpdater.on('update-not-available', () =>
    set({ phase: 'up-to-date', version: null, checkedAt: Date.now() })
  );
  autoUpdater.on('download-progress', (p) =>
    set({
      phase: 'downloading',
      percent: Math.max(0, Math.min(100, Math.round((p && p.percent) || 0)))
    })
  );
  autoUpdater.on('update-downloaded', (info) =>
    set({ phase: 'downloaded', version: (info && info.version) || state.version, percent: 100 })
  );
  autoUpdater.on('error', (e) => set({ phase: 'error', error: friendly(e) }));
}

/**
 * opts.send：状态变化推给渲染端（主进程只给一个函数，避免这里 import BrowserWindow）
 * opts.beforeInstall：安装前的应用自身退出清理
 */
function init(opts) {
  const o = opts || {};
  emit = typeof o.send === 'function' ? o.send : () => {};
  onBeforeInstall = typeof o.beforeInstall === 'function' ? o.beforeInstall : null;
  state.current = app.getVersion();

  if (!app.isPackaged) {
    set({ phase: 'unsupported', error: '开发版不检查更新' });
    return;
  }
  if (!feedUrl() && !hasAppUpdateYml()) {
    set({ phase: 'unconfigured', error: '未配置更新源：打包时缺少 app-update.yml' });
    return;
  }

  try {
    // 延迟到确实要用的分支再 require：开发态不需要这堆依赖进内存
    const mod = require('electron-updater');
    autoUpdater = mod.autoUpdater;
  } catch (e) {
    set({ phase: 'error', error: '更新模块加载失败：' + ((e && e.message) || '') });
    return;
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.logger = null;
  if (feedUrl()) {
    try {
      autoUpdater.setFeedURL({ provider: 'generic', url: feedUrl() });
    } catch (e) {
      set({ phase: 'error', error: '更新源地址无效：' + feedUrl() });
      return;
    }
  }

  wire();
  set({ phase: 'idle' });
  schedule(FIRST_CHECK_DELAY);
}

/** 只在成功后接力下一轮：失败已进 error 相位，等用户点「检查更新」重试，不无脑重试 */
function schedule(delay) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(async () => {
    try {
      await check();
    } catch (_) {}
    schedule(CHECK_EVERY);
  }, delay);
  if (timer.unref) timer.unref();
}

async function check() {
  if (!autoUpdater) return snapshot();
  if (state.phase === 'checking' || state.phase === 'downloading') return snapshot();
  try {
    set({ phase: 'checking', error: null });
    await autoUpdater.checkForUpdates();
    state.checkedAt = Date.now();
  } catch (e) {
    set({ phase: 'error', error: friendly(e) });
  }
  return snapshot();
}

async function download() {
  if (!autoUpdater) return snapshot();
  if (state.phase !== 'available') return snapshot();
  try {
    set({ phase: 'downloading', percent: 0, error: null });
    await autoUpdater.downloadUpdate();
  } catch (e) {
    set({ phase: 'error', error: friendly(e) });
  }
  return snapshot();
}

async function install() {
  if (!autoUpdater || state.phase !== 'downloaded') return { ok: false, state: snapshot() };
  if (onBeforeInstall) {
    try {
      await onBeforeInstall();
    } catch (_) {}
  }
  // 让本次 IPC 先把「正在重启」回给界面，再真的退出
  setImmediate(() => {
    try {
      autoUpdater.quitAndInstall(false, true);
    } catch (e) {
      set({ phase: 'error', error: friendly(e) });
    }
  });
  return { ok: true, state: snapshot() };
}

function dispose() {
  if (timer) clearTimeout(timer);
  timer = null;
}

module.exports = { init, check, download, install, state: snapshot, dispose };

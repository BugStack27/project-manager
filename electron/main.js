'use strict';

/**
 * Electron 主进程。
 * - 建窗口 + 起本地 MCP HTTP 服务（127.0.0.1，供 AI 助手接入），所有数据与系统能力都在这里。
 */

const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const { app, BrowserWindow, Menu, Tray, dialog, shell, screen, ipcMain, nativeTheme, net } = require('electron');
const store = require('./services/store');
const archive = require('./services/archive');
const eventLog = require('./services/event-log');
const runner = require('./services/runner');
const notify = require('./services/notify');
const mobileLink = require('./services/mobile-link');
const reviewBadge = require('./services/review-badge');
const crash = require('./services/crash');
const updater = require('./services/updater');
const { createDomain } = require('./services/domain');
/** 巡检间隔只有一处定义：领域层用它向界面解释「上次检查是什么时候」，主进程按同一个值驱动 */
const { CHECK_INTERVAL: REMOTE_CHECK_INTERVAL_MS } = require('./services/domain/remote-check');
const { createDispatcher, registerIpc } = require('./ipc');
const { startMcpHttp } = require('./mcp-http');
const { createTunnel } = require('./services/tunnel');
const cloudflaredBin = require('./services/cloudflared');
const { createPromptStore } = require('./prompts');
const skillScan = require('./services/skill-scan');

const APP_ROOT = path.join(__dirname, '..');
const DEV_URL = process.env.PM_DEV_URL || '';

// Windows 原生遮挡检测在最小化/恢复时延迟判定「可见」，期间不出帧，露出窗口底色（约 1–2 秒白屏）。
// 自绘标题栏（titleBarStyle:'hidden' + titleBarOverlay）更易触发；关掉后恢复即出帧。
//
// 另外两个开关治的是另一半：窗口被最小化 / 被判为不可见后，渲染进程会被降为后台优先级，
// 已光栅化的图块也会被回收，恢复时整页重新光栅化，期间只显示窗口底色（实测约 1 秒）。
// 保持渲染进程前台优先级并让合成器继续持有图块，首帧就能在恢复瞬间拿回来。
if (process.platform === 'win32') {
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
}

/** 进程启动时刻：启动窗上屏耗时以此为准，别拿 whenReady 之后的时间糊弄 */
const PROCESS_START = Date.now();

/** 启动自动拉取的延时：让首帧与 git 状态预热先跑完，再开始联网拉取 */
const AUTO_PULL_DELAY_MS = 2500;
/** 首次远程巡检的延时：排在启动拉取之后，别让两拨 fetch 同时开跑 */
const REMOTE_CHECK_FIRST_DELAY_MS = 8000;

let mainWindow = null;
let splashWindow = null;
/** 启动窗真正出现在屏幕上的时间：主窗口至少等它展示 300ms，避免一闪而过反而像闪屏 */
let splashShownAt = 0;
let splashShown = false;
let splashShownResolve = null;
let tray = null;
let mcp = null;
/** MCP 启动失败快照（{ code, port, message }）：服务没起来时界面顶部提示条据此显示原因，起来后清空 */
let mcpFail = null;
/** 公网隧道（cloudflared）控制器：进程级资源，与 mcp 同一层 */
let tunnelCtl = null;
/** 上一次广播给手机的隧道地址：只在地址真的变了时才推 keepalive */
let tunnelPushedUrl = '';
let quitting = false;
/** 远程巡检定时器：退出时要清掉 */
let remoteTimer = null;
/** 退出询问弹窗是否已打开：托盘连点、second-instance 都不该再弹一个 */
let quitPending = false;
/** 渲染端自绘退出询问的等待回调；非空表示弹窗正开着 */
let quitAsk = null;

/* ── 数据目录与迁移 ──────────────────────────── */

function dataDir() {
  const custom = String(process.env.PM_DATA_DIR || '').trim();
  if (custom) return path.resolve(custom);
  return path.join(app.getPath('userData'), 'data');
}

/** 首次启动时把仓库里的 data/ 复制过来，避免历史项目与运行日志丢失 */
function migrateLegacyData(target) {
  if (fs.existsSync(path.join(target, 'db.json'))) return;
  const candidates = [
    process.env.PM_LEGACY_DATA,
    path.join(process.cwd(), 'data'),
    path.join(APP_ROOT, 'data')
  ].filter(Boolean);

  for (const src of candidates) {
    const dbFile = path.join(src, 'db.json');
    if (!fs.existsSync(dbFile)) continue;
    try {
      fs.mkdirSync(target, { recursive: true });
      fs.copyFileSync(dbFile, path.join(target, 'db.json'));
      const runs = path.join(src, 'runs');
      if (fs.existsSync(runs)) fs.cpSync(runs, path.join(target, 'runs'), { recursive: true });
      console.log('[main] 已迁移历史数据：' + src + ' → ' + target);
    } catch (e) {
      console.error('[main] 迁移失败：' + e.message);
    }
    return;
  }
}

/* ── 提示词存放目录（仅内部使用，不对外暴露） ── */

/**
 * 提示词热更新目录。与 data 分开：它是「可编辑的配置」而不是「数据」。
 * 首次启动由 createPromptStore.seed() 从内置 prompts/ 复制一份，之后改这里即可生效。
 */
function promptDir() {
  const custom = String(process.env.PM_PROMPT_DIR || '').trim();
  if (custom) return path.resolve(custom);
  return path.join(app.getPath('userData'), 'prompts');
}

/* ── 技能扫描缓存目录（可再生，不进 data/） ── */

/**
 * 技能清单是「本机环境快照」，不是用户数据：它会被反复重扫覆盖，也不该跟着 db.json
 * 一起备份或拷贝到别的机器（绝对路径换台机器就失效）。所以单独放 cache/。
 */
function cacheDir() {
  return path.join(app.getPath('userData'), 'cache');
}

/* ── GUI ────────────────────────────────────── */

/**
 * 应用自身的页面 URL（dev 走 Vite，prod 走打包后的 index.html）。
 * `will-navigate` 需要靠它区分「应用内导航」与「被外部链接带跑」。
 */
function appBaseUrl() {
  return DEV_URL || pathToFileURL(path.join(__dirname, 'renderer', 'index.html')).href;
}

/**
 * 去掉 hash 与 query 后比较：Vite dev 下 HMR 客户端会带上时间戳 query，
 * 应用内路由也可能带 hash，这些都属于应用自身导航，不该被拦。
 * 同时去掉 base 末尾斜杠：PM_DEV_URL 带尾斜杠时不会把自身子路径误判成外部。
 */
function isAppUrl(url) {
  if (typeof url !== 'string' || !url) return false;
  const base = appBaseUrl();
  const norm = (s) => s.split('#')[0].split('?')[0].replace(/\/+$/, '');
  const b = norm(base);
  return norm(url) === b || norm(url).startsWith(b + '/');
}

/** 只有 http/https 才交给系统浏览器；file: 等一律不外开，避免渲染进程读到本地文件 */
function openExternalSafely(url) {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
    shell.openExternal(url);
    return true;
  }
  return false;
}

/**
 * 独立启动窗：主窗口加载期间先给用户一张卡片。
 * 透明背景只画卡片，避免无边框窗口在 Windows 上的灰底和圆角不一致；不抢焦点、不进任务栏。
 */
function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 320,
    height: 220,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
  });
  splashWindow.loadFile(path.join(__dirname, 'splash.html'), {
    query: { v: app.getVersion(), theme: initialDark() ? 'dark' : 'light' }
  });
  const show = () => {
    if (!splashWindow || splashWindow.isDestroyed() || splashWindow.isVisible()) return;
    splashWindow.showInactive();
    splashShownAt = Date.now();
    splashShown = true;
    if (splashShownResolve) {
      splashShownResolve();
      splashShownResolve = null;
    }
    console.log('[window] splash shown after ' + (splashShownAt - PROCESS_START) + 'ms');
  };
  splashWindow.once('ready-to-show', show);
  // 透明窗口的 ready-to-show 偶尔不派发：短兜底，别让启动窗缺席
  setTimeout(show, 200);
  splashWindow.on('closed', () => {
    splashWindow = null;
  });
}

/**
 * 等启动窗真正上屏再继续初始化。
 * 读库 / 建 IPC / 起 MCP 是一整段重活，会长时间占住主线程；不等它，
 * ready-to-show 会排在这些工作后面处理，启动窗反而最后才出现。
 */
function waitSplashShown(limitMs) {
  if (splashShown) return Promise.resolve();
  return new Promise((resolve) => {
    splashShownResolve = resolve;
    setTimeout(resolve, limitMs);
  });
}

function closeSplash() {
  if (splashWindow && !splashWindow.isDestroyed()) splashWindow.destroy();
  splashWindow = null;
}

/**
 * 窗口层配色：CSS 管不到「窗口底色」和 Windows 系统绘制的窗口控制按钮区，
 * 只能由主进程跟着渲染端报上来的生效主题同步。取值与 styles/theme-dark.css 的 --bg 一致。
 */
const CHROME = {
  light: { bg: '#FDFDFE', symbol: '#3C3C43' },
  dark: { bg: '#1C1C1E', symbol: '#F5F5F7' }
};

/**
 * 初始猜测用系统主题：渲染端还没跑起来时只有这一个信息源。默认偏好就是「跟随系统」，
 * 绝大多数情况下与随后报上来的值一致；不一致时会被 setAppearance 立刻纠正。
 */
function initialDark() {
  try {
    return nativeTheme.shouldUseDarkColors === true;
  } catch (_) {
    return false;
  }
}

/** 最近一次生效主题。null 表示渲染端还没报过，此时以系统主题为准 */
let appearanceDark = null;
/** 最近一次报来的浅色皮肤底色（hex）。null 时用 CHROME.light 兜底 */
let appearanceLightBg = null;

/** 渲染端报来生效主题与浅色皮肤底色：更新窗口底色与标题栏覆盖色。失败不抛，配色问题不该影响可用性 */
function applyAppearance(dark, lightBg) {
  appearanceDark = !!dark;
  // 只接受合法 hex，避免渲染端异常值污染窗口配色
  if (typeof lightBg === 'string' && /^#[0-9a-fA-F]{6}$/.test(lightBg)) appearanceLightBg = lightBg;
  const c = appearanceDark ? CHROME.dark : { bg: appearanceLightBg || CHROME.light.bg, symbol: CHROME.light.symbol };
  if (!mainWindow || mainWindow.isDestroyed()) return { ok: true };
  try {
    mainWindow.setBackgroundColor(c.bg);
  } catch (_) {
    /* 忽略 */
  }
  // titleBarOverlay 只在 win32 建窗时启用过；其它平台调用会抛错，必须判平台 + 判存在
  if (process.platform === 'win32' && typeof mainWindow.setTitleBarOverlay === 'function') {
    try {
      mainWindow.setTitleBarOverlay({ color: c.bg, symbolColor: c.symbol, height: 44 });
    } catch (_) {
      /* 忽略 */
    }
  }
  return { ok: true };
}

/**
 * 窗口真正上屏后再刷一次覆盖色。
 * 渲染端在「首屏就绪」时就会报主题，而窗口要等 pm:renderer-ready 之后才 show —— 实测报上来时
 * isVisible() 还是 false。Windows 对隐藏窗口设置的标题栏覆盖色不生效（三个系统按钮会停在建窗时的配色），
 * 所以每次 show 之后必须再刷一次；托盘恢复也走同一条路。
 */
function syncChromeOnShow() {
  applyAppearance(appearanceDark === null ? initialDark() : appearanceDark, appearanceLightBg);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 980,
    minHeight: 620,
    backgroundColor: CHROME[initialDark() ? 'dark' : 'light'].bg,
    title: '项目管理台',
    // 打包版 exe / 安装包的图标由 build/icon.ico 改写 PE 资源；这里给开发态与 Linux 窗口
    // 复用同一字形（electron/assets 在 files 白名单内，会进 asar）。
    icon: path.join(__dirname, 'assets', 'app-icon.png'),
    show: false,
    autoHideMenuBar: true,
    // 去掉原生标题栏；Windows 上用系统绘制的窗口控制按钮（最小化/最大化/关闭，固定在窗口右上角）
    titleBarStyle: 'hidden',
    ...(process.platform === 'win32'
      ? {
          titleBarOverlay: {
            color: CHROME[initialDark() ? 'dark' : 'light'].bg,
            symbolColor: CHROME[initialDark() ? 'dark' : 'light'].symbol,
            height: 44
          }
        }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // 最小化/被遮挡时不降级渲染：降级会回收已光栅化的图块，恢复时整页重新光栅化，
      // 期间窗口只显示底色（实测约 1s 的「白屏」）。本应用是常驻的桌面控制台，
      // 隐藏时那点后台开销远小于每次恢复都白一下。
      backgroundThrottling: false,
      spellcheck: false
    }
  });

  // 窗口延迟到渲染端首屏真正就绪后显示：ready-to-show / did-finish-load 都会早于「完整首屏」
  // 绘制，show 出来先露出窗口底色（启动白屏）。渲染端在首屏数据加载完并画完后发
  // pm:renderer-ready；3s 兜底防止渲染端异常时窗口永远不显示。
  const createdAt = Date.now();
  let revealed = false;
  const reveal = (why) => {
    if (revealed || !mainWindow || mainWindow.isDestroyed()) return;
    revealed = true;
    // 启动窗至少展示 300ms：本地加载常在一两百毫秒内完成，一闪而过反而像闪屏
    const wait = Math.max(0, 300 - (Date.now() - splashShownAt));
    setTimeout(() => {
      closeSplash();
      if (!mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.show();
      mainWindow.focus();
      syncChromeOnShow();
      console.log('[window] shown via ' + why + ' after ' + (Date.now() - createdAt) + 'ms');
    }, wait);
  };
  const onRendererReady = (e) => {
    if (mainWindow && e.sender === mainWindow.webContents) reveal('renderer-ready');
  };
  ipcMain.on('pm:renderer-ready', onRendererReady);
  const readyFallback = setTimeout(() => reveal('fallback'), 3000);

  mainWindow.on('close', (e) => {
    // 点关闭 ≠ 退出：隐藏到系统托盘，后台任务与 MCP 服务继续运行。
    // 真正退出走托盘菜单「退出」→ app.quit()，此时 quitting 已置 true，不拦截。
    if (!quitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  // 托盘恢复：隐藏期间系统主题可能变过，show 出来再对齐一次
  mainWindow.on('show', () => setTimeout(syncChromeOnShow, 0));

  mainWindow.on('closed', () => {
    clearTimeout(readyFallback);
    ipcMain.removeListener('pm:renderer-ready', onRendererReady);
    mainWindow = null;
  });

  // 页面内不允许开新窗口；外链交给系统浏览器
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafely(url);
    return { action: 'deny' };
  });

  // 同窗口导航同样要拦：正文由外部 AI 写入，链接点击会把整个窗口导航到外部页面，
  // 用户只能退出重启应用才能恢复。应用自身 URL 放行，其余一律 preventDefault。
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isAppUrl(url)) return;
    event.preventDefault();
    openExternalSafely(url);
  });

  if (DEV_URL) mainWindow.loadURL(DEV_URL);
  else mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  if (tray) refreshReviewBadge();
}

/** 恢复/显示并聚焦主窗口；窗口已销毁（异常路径）时重建 */
function showMainWindow() {
  // 启动窗还在：首屏没就绪，等 reveal 统一收尾，过早 show 会露出未完成界面
  if (splashWindow) return;
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

/**
 * 通知/审计的统一跳转：把目标交给渲染端，由 App 处理项目与页面落点。
 * 窗口可能藏在托盘、正在加载，甚至已被销毁；三种情况都要能落下去。
 */
function navigateTo(target) {
  const payload = target && typeof target === 'object' ? target : {};
  const send = () => {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
    mainWindow.webContents.send('pm:navigate', payload);
  };

  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  showMainWindow();
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.webContents.isLoading()) mainWindow.webContents.once('did-finish-load', send);
  else send();
}

/* ── 托盘图标 ─────────────────────────────────
 * 托盘是 16 逻辑像素的位图，但按 DPI 缩放时 shell 要的是不同物理尺寸
 * （125% → 20px、150% → 24px、200% → 32px）。拿一张 16px 位图让它拉伸就是二次模糊，
 * 所以 assets/tray 里放的是逐尺寸原生栅格化的 RGBA PNG（scripts/make-tray-icons.js 生成），
 * 运行时按主屏 scaleFactor 挑最接近的一张。
 */
/**
 * 托盘与待审核角标：资源由 scripts/make-tray-icons.js 逐尺寸生成，
 * review-badge 负责按平台更新图标 / tooltip / Dock badge / 任务栏 overlay。
 */
let badgeTimer = null;

function refreshReviewBadge() {
  if (!tray) return;
  reviewBadge.update({
    app,
    tray,
    win: mainWindow,
    scale: screen.getPrimaryDisplay().scaleFactor,
    setMenu: (data) => {
      if (!tray) return;
      const items = [];
      if (data.count) {
        items.push({ label: '待审核 ' + data.count + ' 条', enabled: false });
        items.push({
          label: '打开待审核',
          submenu: data.projects.map((p) => ({
            label: p.name + ' · ' + p.count,
            click: () =>
              navigateTo({
                page: 'req',
                projectId: p.projectId,
                requirementId: p.requirementId
              })
          }))
        });
      } else {
        items.push({ label: '没有待审核需求', enabled: false });
      }
      items.push(
        { type: 'separator' },
        { label: '显示主窗口', click: showMainWindow },
        { type: 'separator' },
        { label: '退出', click: () => app.quit() }
      );
      tray.setContextMenu(Menu.buildFromTemplate(items));
    }
  });
}

/** 需求/项目事件后 100ms 防抖刷新，避免批量操作反复重建菜单 */
function scheduleReviewBadge() {
  if (badgeTimer) return;
  badgeTimer = setTimeout(() => {
    badgeTimer = null;
    refreshReviewBadge();
  }, 100);
}

function createTray() {
  const scale = screen.getPrimaryDisplay().scaleFactor;
  tray = new Tray(reviewBadge.trayIcon(reviewBadge.chooseSize(scale), 0));
  tray.on('click', showMainWindow);
  screen.on('display-metrics-changed', refreshReviewBadge);
  refreshReviewBadge();
  eventLog.subscribe((ev) => {
    if (ev.type.startsWith('requirement.') || ev.type.startsWith('project.')) scheduleReviewBadge();
  });
}

function buildNativeBridge() {
  return {
    pickFolder: async (initial) => {
      const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
      const opts = {
        title: '选择项目文件夹',
        properties: ['openDirectory', 'createDirectory'],
        defaultPath: initial || undefined
      };
      const res = parent ? await dialog.showOpenDialog(parent, opts) : await dialog.showOpenDialog(opts);
      const picked = !res.canceled && res.filePaths && res.filePaths[0];
      return picked ? { path: picked, canceled: false } : { path: null, canceled: true };
    },
    pickScript: async (initial) => {
      const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
      const opts = {
        title: '选择脚本文件',
        properties: ['openFile'],
        defaultPath: initial || undefined,
        filters: [
          {
            name: '脚本',
            extensions: process.platform === 'win32' ? ['bat', 'cmd', 'ps1'] : ['sh', 'bash', 'zsh']
          },
          { name: '所有文件', extensions: ['*'] }
        ]
      };
      const res = parent ? await dialog.showOpenDialog(parent, opts) : await dialog.showOpenDialog(opts);
      const picked = !res.canceled && res.filePaths && res.filePaths[0];
      // 工作目录跟着脚本走：选中后表单直接填脚本所在目录
      return picked
        ? { path: picked, dir: path.dirname(picked), canceled: false }
        : { path: null, dir: null, canceled: true };
    },
    /** shell.openPath 成功返回空串，失败返回错误文案 */
    reveal: (dir) => shell.openPath(dir),
    /** 交给系统浏览器打开；只放行 http/https（与窗口内拦外链同一口径） */
    openUrl: (url) => openExternalSafely(url),
    /** 版本信息给界面显示：domain 层不引 electron，统一从这里注入 */
    appInfo: () => ({
      version: app.getVersion(),
      packaged: app.isPackaged,
      platform: process.platform
    }),
    /**
     * 读 Windows 快捷方式目标（IDE 自动发现用：装在哪都能跟用户看到的启动项对上）。
     * 非 Windows 或损坏的 .lnk 一律返回 null，由服务层退回路径白名单。
     */
    readShortcut: (lnk) => {
      if (process.platform !== 'win32') return null;
      try {
        return shell.readShortcutLink(lnk);
      } catch (_) {
        return null;
      }
    },
    /**
     * 数据恢复后自动重启：store 已锁写，走 app.exit 跳过 before-quit → shutdown 的保存路径。
     * 延迟是为了让 IPC 响应先回到渲染端（界面能显示「正在重启」）。
     */
    relaunch: (delayMs) => {
      setTimeout(() => {
        try {
          quitting = true;
          if (tray) {
            tray.destroy();
            tray = null;
          }
          app.relaunch();
          app.exit(0);
        } catch (e) {
          console.error('[main] 自动重启失败：' + e.message);
          // 已恢复的 db.json 留在磁盘上，下次手动启动会加载它，不会回到旧库
          app.exit(1);
        }
      }, Math.max(0, delayMs || 0));
    }
  };
}

/**
 * 退出清理。mode='detach' 时不杀进程，只解除托管关系（进程与日志都留在后台）；
 * 默认 'stop' 会先结束所有运行中的命令。
 */
async function shutdown(mode) {
  try { notify.stop(); } catch (_) {}
  try { mobileLink.stop(); } catch (_) {}
  // 隧道先停：它是唯一的公网入口，退出过程中不该再接受外部请求
  try { if (tunnelCtl) tunnelCtl.stop(); } catch (_) {}
  if (badgeTimer) {
    clearTimeout(badgeTimer);
    badgeTimer = null;
  }
  try {
    if (mode === 'detach') {
      runner.detachAll();
    } else {
      const db = store.get();
      for (const c of db.commands) {
        if (runner.isActive(c)) {
          try { runner.stop(c); } catch (_) {}
        }
      }
    }
    store.save();
  } catch (_) {}

  // 停止进程的 close 回调要跑完，运行状态才来得及落库
  if (mode !== 'detach') await new Promise((r) => setTimeout(r, 300));

  if (mcp) {
    try { await mcp.close(); } catch (_) {}
    mcp = null;
  }
}

/**
 * 有命令在跑时的退出询问，返回 'detach' | 'stop' | 'cancel'。
 * 优先让渲染端画（与界面同一套主题），渲染端不可用或 8 秒没响应才退回系统弹窗 ——
 * 退出是关键时刻，宁可弹得朴素一点，也不能因为界面没反应而退不出去。
 */
async function askQuitMode(running) {
  const answer = await askQuitInRenderer(running);
  if (answer) return answer;
  return askQuitModeNative(running);
}

/** 渲染端自绘：发一次 pm:quit-ask，等渲染端用 pm:quit-answer 回话；返回 null 表示要兜底 */
function askQuitInRenderer(running) {
  return new Promise((resolve) => {
    const win = mainWindow;
    if (!win || win.isDestroyed() || win.webContents.isDestroyed() || win.webContents.isLoading()) {
      resolve(null);
      return;
    }
    let timer = null;
    let settled = false;
    const finish = (mode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      quitAsk = null;
      // 超时回落时渲染端可能还挂着弹窗，通知它收起，免得和系统弹窗同时出现
      if (!mode) {
        try {
          win.webContents.send('pm:quit-ask', { dismiss: true });
        } catch (_) {}
      }
      resolve(mode || null);
    };
    timer = setTimeout(() => finish(null), 8000);
    quitAsk = finish;
    win.webContents.send('pm:quit-ask', {
      count: running.length,
      items: running.slice(0, 5).map((c) => ({ name: c.name || '', text: c.text })),
      total: running.length
    });
  });
}

/** 兜底：渲染端弹不出来时用系统消息框，按钮顺序与自绘保持一致 */
function askQuitModeNative(running) {
  const lines = running.slice(0, 5).map((c) => '· ' + (c.name || c.text));
  if (running.length > lines.length) lines.push('· 等共 ' + running.length + ' 个命令');
  const opts = {
    // 不传 type：Windows 上 question 会画成蓝底白 i 的信息图标，与「要你选一个」的语义不符
    message: '有 ' + running.length + ' 个命令正在运行',
    detail:
      lines.join('\n') +
      '\n\n分离：应用退出，进程继续在后台运行（可在下次启动时看到「已分离」）。' +
      '\n停止：先结束这些进程再退出。',
    buttons: ['分离子进程并退出', '停止进程并退出', '取消'],
    defaultId: 0,
    cancelId: 2,
    noLink: true
  };
  const p = mainWindow && !mainWindow.isDestroyed()
    ? dialog.showMessageBox(mainWindow, opts)
    : dialog.showMessageBox(opts);
  return p.then(({ response }) => (response === 0 ? 'detach' : response === 1 ? 'stop' : 'cancel'));
}

function beginShutdown(mode) {
  quitting = true;
  // 巡检定时器要一起停：否则退出瞬间可能又起一轮 fetch，白白拖慢退出
  if (remoteTimer) {
    clearInterval(remoteTimer);
    remoteTimer = null;
  }
  // 先移除托盘图标，避免退出后图标残留
  if (tray) {
    tray.destroy();
    tray = null;
  }
  shutdown(mode).finally(() => app.exit(0));
}

/* ── 启动自动拉取 ─────────────────────────────── */

/**
 * 窗口上屏后再在后台拉一遍代码，绝不挡 splash 与首帧。
 * 延时是为了避开渲染端启动时的仓库探测（useGit 会预热各项目的 git 状态）；
 * 只有真的拉到东西或失败时才推给界面，全绿时保持安静。
 */
function scheduleStartupAutoPull(dispatch) {
  setTimeout(async () => {
    try {
      const res = await dispatch('autoPullNow', { trigger: 'launch' });
      const s = res && res.ok ? res.data : null;
      if (!s || (!s.pulled && !s.failed)) return;
      if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
      mainWindow.webContents.send('pm:auto-pull', s);
    } catch (e) {
      console.error('[main] 启动自动拉取失败：' + (e && e.message));
    }
  }, AUTO_PULL_DELAY_MS);
}

/* ── 远程更新巡检 ─────────────────────────────── */

/**
 * 定期 fetch 一轮并把「落后上游多少」写进领域层缓存，侧栏据此点灯。
 * 为什么不在 gitSummary 里顺手做：那个接口每 30 秒被轮询一次，联网会把侧栏拖住；
 * 这里只按 interval 跑，gitSummary 永远只读缓存。
 * 开关在领域层判断（代码同步设置里的 remoteCheck），主进程只管按表调用。
 */
function scheduleRemoteCheck(dispatch) {
  const run = () => {
    // dispatch 自己会把异常收成 { ok:false }，所以失败要看返回值而不是 catch
    dispatch('remoteCheckNow', { trigger: 'timer' }).then((res) => {
      if (res && res.ok === false) console.error('[main] 远程更新巡检失败：' + res.message);
    });
  };
  // 首次比自动拉取晚一点：两者都会 fetch，先让启动阶段的网络请求排队过去
  setTimeout(run, REMOTE_CHECK_FIRST_DELAY_MS);
  remoteTimer = setInterval(run, REMOTE_CHECK_INTERVAL_MS);
}

function startGui() {
  // 崩溃留痕要在建窗口之前就绪：读库、扫 IDE 这些早期路径同样要能留下现场。
  // setPath('crashDumps') 也必须在 ready 之前，所以放在这里而不是 whenReady 里。
  crash.init({
    dataDir: dataDir(),
    collect: () => {
      const db = store.get();
      return {
        projects: db.projects.length,
        requirements: db.requirements.length,
        commands: db.commands.length,
        running: runner.runningList().length,
        dataDir: store.DATA_DIR,
        mcp: mcp ? { port: mcp.port } : null
      };
    }
  });

  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }

  app.on('second-instance', () => {
    showMainWindow();
  });
  
  app.whenReady().then(async () => {
    app.setAppUserModelId('io.github.bugstack27.project-manager');
    if (process.platform !== 'darwin') Menu.setApplicationMenu(null);

    // 先弹启动窗：后面的读库 / 扫 IDE / 起 MCP 都在它背后进行。
    // 必须等它真正上屏再继续，否则主线程被初始化堵住，窗口会拖到日志之后才出现。
    createSplashWindow();
    await waitSplashShown(300);

    const dir = dataDir();
    migrateLegacyData(dir);
    store.configure(dir);
    store.load();
    // 归档目录从「需求/ 平铺」改成「archive/<项目>/」：老数据启动时迁一次，失败不阻断启动
    try {
      const moved = archive.migrateLegacy();
      if (moved.moved) console.log('[main] 已迁移归档需求 ' + moved.moved + ' 份到 archive/');
    } catch (e) {
      console.error('[main] 归档目录迁移失败：' + e.message);
    }
    eventLog.init();
    runner.recover();

    const prompts = createPromptStore({
      builtinDir: path.join(APP_ROOT, 'prompts'),
      userDir: promptDir(),
      log: console.log
    });
    prompts.seed();

    /**
     * 技能扫描：放到 setImmediate 里跑，不占启动主路径（目录多时也不拖首屏）。
     * 失败只记日志 —— 技能清单只是补全与需求关联的辅助数据，扫不到不该影响应用启动。
     * 重扫入口：界面按钮与 `GET /skills/rescan`。
     */
    skillScan.configure(cacheDir());
    setImmediate(() => {
      try {
        const db = store.get();
        const agents = Array.isArray(db.agents) ? db.agents : [];
        const snap = skillScan.rescan({ agentDirs: skillScan.agentDirList(agents), agents });
        console.log('[main] 技能扫描：' + snap.skills.length + ' 项 / ' + snap.roots.length + ' 个目录');
      } catch (e) {
        console.error('[main] 技能扫描失败：' + e.message);
      }
    });

    const baseDispatch = createDispatcher(createDomain(buildNativeBridge()));

    /**
     * MCP 状态快照。url 非空 = 服务可用；error 只在「服务没起来」时给，
     * 渲染端据此在窗口顶部提示条上显示原因与端口（不必打开 MCP 弹窗或翻日志）。
     */
    const mcpState = () => ({
      port: mcp ? mcp.port : null,
      url: mcp ? mcp.url : null,
      error: mcp ? null : mcpFail
    });

    /**
     * 启动（或重试启动）本地 MCP 服务：失败不抛出，把原因存进 mcpFail 交给界面。
     * 端口固定不顺延，重试前用户必须自己放掉占用端口的程序 —— 成功即清空失败快照。
     */
    async function startMcpService() {
      if (mcp) return mcpState();
      try {
        mcp = await startMcpHttp(dispatch, console.log, prompts);
        mcpFail = null;
      } catch (e) {
        mcpFail = {
          code: e.code || null,
          port: e.port || null,
          message: e.message || '未知错误'
        };
        console.error(
          '[main] MCP 服务启动失败：' + mcpFail.message + (mcpFail.port ? '（端口 ' + mcpFail.port + '）' : '')
        );
      }
      return mcpState();
    }

    /** cloudflared 的路径与下载状态：第一次需要时才下载，之后复用同一份 */
    let cloudflaredPath = '';
    let cloudflaredError = null;
    let cloudflaredPending = null;

    /**
     * 安装包内置的 cloudflared。cloudflared 只有 GitHub 一个下载源，国内直连不稳，
     * 发版时就带一份进 resources/cloudflared，首次开启手机端通信不必赌网络。
     */
    function bundledCloudflared() {
      if (!app.isPackaged) return '';
      return path.join(process.resourcesPath, 'cloudflared', cloudflaredBin.localName());
    }

    /**
     * 确保有可用的 cloudflared：自带 > 下载过 > PATH > 静默下载。
     * 不弹窗、不询问 —— 这个二进制的存在与否不该成为一个需要用户决策的问题。
     */
    async function ensureCloudflared() {
      if (cloudflaredPath) return cloudflaredPath;
      if (!cloudflaredPending) {
        cloudflaredPending = cloudflaredBin
          .ensure({
            dir: path.join(app.getPath('userData'), 'bin'),
            bundled: bundledCloudflared(),
            log: console.log,
            /**
             * 首选 Electron 的 net.fetch：走 Chromium 网络栈，系统代理与系统证书都跟着走。
             * Node 自带的 fetch（undici）不读系统代理与系统证书库，开了代理 / 加速工具的机器上
             * 只会报 `fetch failed`；cloudflared.js 里还有一条 https + 系统证书库的回落通道。
             */
            fetchImpl: (url, opts) => net.fetch(url, opts)
          })
          .then((bin) => {
            cloudflaredPath = bin;
            cloudflaredError = null;
            return bin;
          })
          .catch((e) => {
            cloudflaredError = { code: e.code || 'cloudflared_missing', message: e.message };
            console.error('[tunnel] ' + e.message);
            return '';
          })
          .finally(() => {
            cloudflaredPending = null;
          });
      }
      return cloudflaredPending;
    }

    /**
     * 公网隧道快照。error 只在拿不到地址、链路自检失败或 cloudflared 缺失时给。
     * preparing 表示正首次下载 cloudflared（几十兆，界面据此显示「准备中」而不是报错）。
     */
    function tunnelState() {
      const rt = tunnelCtl
        ? tunnelCtl.snapshot()
        : { running: false, url: '', error: null, startedAt: null, restarts: 0 };
      return {
        ...rt,
        error: rt.error || cloudflaredError,
        preparing: !!cloudflaredPending,
        port: mcp ? mcp.port : null
      };
    }

    /** 起隧道（幂等）：MCP 没起来、或 cloudflared 拿不到时直接回原因，不留空壳地址 */
    async function startTunnel() {
      if (!mcp) {
        return {
          ...tunnelState(),
          error: { code: 'mcp_down', message: 'MCP 服务没起来，隧道先用不了' }
        };
      }
      const bin = await ensureCloudflared();
      if (!bin) return tunnelState();
      if (!tunnelCtl) {
        tunnelCtl = createTunnel({
          port: mcp.port,
          binary: bin,
          log: console.log,
          onState: (st) => {
            // 地址一变就推一次心跳：手机不必等到下一分钟才知道新地址
            if (st.url && st.url !== tunnelPushedUrl) {
              tunnelPushedUrl = st.url;
              try {
                mobileLink.forceKeepalive();
              } catch (_) {
                /* 通道没开时无需强推 */
              }
            }
          }
        });
      }
      return tunnelCtl.start();
    }

    function stopTunnel() {
      tunnelPushedUrl = '';
      if (tunnelCtl) tunnelCtl.stop();
      return tunnelState();
    }

    /**
     * 隧道唯一跟着「手机端通信」这个开关走：
     * 开着就保证有一条公网地址（没有就下 cloudflared、再起隧道），关着就彻底断开。
     */
    async function syncTunnel() {
      const res = await baseDispatch('mobileSessionInfo', {});
      const on = !!(res && res.ok && res.data && res.data.settings && res.data.settings.enabled);
      if (!on) return stopTunnel();
      return startTunnel();
    }

    // MCP 状态与提示词读写不进 domain：它们属于进程级资源，不是业务数据
    const dispatch = async (method, params) => {
      if (method === 'mcpInfo') return { ok: true, data: mcpState() };
      // 重试启动：同属进程级资源，所以留在这一层而不进 domain 的能力表
      if (method === 'mcpRetry') return { ok: true, data: await startMcpService() };
      // 公网隧道同样是进程级资源（cloudflared 子进程），与 mcpInfo 同一取舍
      if (method === 'tunnelInfo') return { ok: true, data: tunnelState() };
      /** 下载失败后手动重试：清掉失败快照与路径缓存，重走一遍检测 + 下载 */
      if (method === 'tunnelRetry') {
        cloudflaredError = null;
        cloudflaredPath = '';
        return { ok: true, data: await syncTunnel() };
      }
      /**
       * 给手机的接入点：隧道地址 + 令牌，由手机端的心跳取走。
       * 手机端通信关着时地址给空串 —— 拿到一个必然 401 的地址比拿不到更糟。
       */
      if (method === 'endpointInfo') {
        const mres = await baseDispatch('mobileSessionInfo', {});
        const mobileOn = !!(mres && mres.ok && mres.data && mres.data.settings && mres.data.settings.enabled);
        const info = await baseDispatch('remoteInfo', {});
        const rem = info && info.ok ? info.data.remote : null;
        const st = tunnelCtl ? tunnelCtl.snapshot() : null;
        const url = mobileOn && st && st.url ? st.url : '';
        return { ok: true, data: { url, token: (rem && rem.token) || '' } };
      }
      if (method === 'scoutPrompt') {
        const stub = prompts.read('scout-stub');
        return { ok: true, data: { stub: stub ? stub.text : '' } };
      }
      // 执行 agent 的接入说明：与巡检那段分开取，谁缺了都不挡另一个
      if (method === 'workerPrompt') {
        const stub = prompts.read('worker-stub');
        return { ok: true, data: { stub: stub ? stub.text : '' } };
      }
      // 手机端通道是进程级资源（PushGo 轮询与在线状态），与 mcpInfo 同一取舍：
      // 只暴露 info / rotate 两个动作，业务状态仍由 domain 的 mobile* 方法读写
      /**
       * 页面级提醒：手机端通信开着、但频道在当前网关上不存在时，顶部提示条要能直接看到，
       * 不必点进弹窗。只读进程内状态，不触发任何网络。
       */
      if (method === 'mobileAlert') {
        const res = await baseDispatch('mobileSessionInfo', {});
        const on = !!(res && res.ok && res.data && res.data.settings && res.data.settings.enabled);
        if (!on) return { ok: true, data: { needsRepair: false, message: '' } };
        const st = mobileLink.statusView();
        return {
          ok: true,
          data: { needsRepair: st.errorCode === 'channel_not_found', message: st.error || '' }
        };
      }
      if (method === 'mobileInfo') {
        try {
          return { ok: true, data: await mobileLink.info() };
        } catch (e) {
          return { ok: false, status: e.status || 500, code: e.code || 'mobile_info_failed', message: e.message };
        }
      }
      if (method === 'mobileRotate') {
        try {
          return { ok: true, data: await mobileLink.rotate() };
        } catch (e) {
          return { ok: false, status: e.status || 500, code: e.code || 'mobile_rotate_failed', message: e.message };
        }
      }
      // 手机端通信开关一变，远程面与隧道立刻跟着对齐（首次可能要下 cloudflared，后台做）
      if (method === 'saveMobileSettings') {
        const res = await baseDispatch(method, params);
        syncTunnel().catch((e) => console.error('[tunnel] 同步失败：' + e.message));
        return res;
      }
      return baseDispatch(method, params);
    };
    registerIpc(dispatch, {
      // 渲染端自绘弹窗的选择回传；没有待处理询问时静默丢弃（比如弹窗已超时回落原生）
      quitAnswer: (mode) => {
        if (quitAsk) quitAsk(mode);
        return { ok: true };
      },
      // 更新是进程级资源，不是业务数据，所以不进 dispatch 的能力表（与 mcpInfo 同一取舍）
      update: (action) => {
        if (action === 'state') return updater.state();
        if (action === 'check') return updater.check();
        if (action === 'download') return updater.download();
        if (action === 'install') return updater.install();
        return { ok: false, error: 'unknown_action' };
      },
      // 外观只动窗口层，消息没有回执，因此用 on 通道而非 invoke
      appearance: (dark, lightBg) => applyAppearance(dark, lightBg),
      crash: (action, payload) => {
        if (action === 'list') return { ok: true, items: crash.list() };
        if (action === 'record') {
          crash.record('renderer', payload || {});
          return { ok: true };
        }
        if (action === 'export') return crash.exportPack({ win: mainWindow });
        return { ok: false, error: 'unknown_action' };
      }
    });

    // 失败不抛：窗口照常起来，界面顶部提示条给出原因与端口，并留一个「重试」
    await startMcpService();

    console.log('[main] 数据目录：' + dir);
    createWindow();
    createTray();
    notify.start({ navigateTo });
    // 手机端通道：开关关着时只读一次设置就静默返回，不会联网
    try {
      mobileLink.start({ dispatch, log: console.log });
    } catch (e) {
      console.error('[main] 手机端通道启动失败：' + e.message);
    }
    // 手机端通信开着就把隧道接上（缺 cloudflared 会先在后台下，下完自动起）
    try {
      await syncTunnel();
    } catch (e) {
      console.error('[main] 隧道启动失败：' + e.message);
    }
    scheduleStartupAutoPull(dispatch);
    scheduleRemoteCheck(dispatch);

    /**
     * 自动更新：只有打包版才真的会检查，开发态停在 unsupported。
     * 安装前的退出清理必须自己先跑完 —— 否则 quitAndInstall 会撞上 before-quit 里
     * 「有命令在跑：分离还是停止」的询问，用户被卡在弹窗上，更新永远装不上。
     */
    updater.init({
      send: (state) => {
        if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
        mainWindow.webContents.send('pm:update', state);
      },
      beforeInstall: async () => {
        quitting = true;
        if (tray) {
          tray.destroy();
          tray = null;
        }
        await shutdown('stop');
      }
    });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    // 常规「关闭」已被 close 拦截为隐藏到托盘，窗口不会真销毁；
    // 此事件仅在异常路径兜底触发，非退出流程下保持托盘驻留，不整体退出
    if (quitting && process.platform !== 'darwin') app.quit();
  });

  // 有运行中的命令就先问一句：分离 / 停止 / 取消。没有则按原路径直接退出。
  app.on('before-quit', (e) => {
    if (quitting) return;
    e.preventDefault();
    if (quitPending) return; // 弹窗已开着，重复的退出请求直接忽略
    const running = runner.runningList();
    if (!running.length) {
      beginShutdown('stop');
      return;
    }
    quitPending = true;
    // 从托盘退出时窗口可能藏着，对话框没有落脚点，先把它带到前台
    showMainWindow();
    askQuitMode(running)
      .then((mode) => {
        quitPending = false;
        if (mode !== 'detach' && mode !== 'stop') return; // 取消：应用继续运行
        beginShutdown(mode);
      })
      .catch(() => {
        quitPending = false;
      });
  });
}

startGui();

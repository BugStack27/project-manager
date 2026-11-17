#!/usr/bin/env node
'use strict';

/*
 * 逐页截取 project-manager 的真实界面：注入虚构数据桥，用无头 Chromium + CDP 截图。
 *
 * 用法（在仓库根目录）：
 *   node .agent/skills/app-screenshots/scripts/capture.cjs
 *   node .agent/skills/app-screenshots/scripts/capture.cjs --theme dark
 *   node .agent/skills/app-screenshots/scripts/capture.cjs --only overview,launch
 *   node .agent/skills/app-screenshots/scripts/capture.cjs --width 1440 --height 900 --scale 2 *
 * 默认先跑 npm run build，保证截图用的是最新前端；--no-build 可跳过。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { spawn, spawnSync } = require('child_process');

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  return i > 0 ? process.argv[i + 1] : fallback;
}
const hasFlag = (name) => process.argv.includes('--' + name);

const ROOT = path.resolve(arg('root', path.join(__dirname, '..', '..', '..', '..')));
if (!fs.existsSync(path.join(ROOT, 'package.json'))) {
  console.error('找不到仓库根目录（package.json）。请用 --root <项目根目录> 指定。');
  process.exit(1);
}

const THEME = arg('theme', 'light') === 'dark' ? 'dark' : 'light';
const W = Number(arg('width', 1280));
const H = Number(arg('height', 860));
const SCALE = Number(arg('scale', 2));
const OUT_DIR = path.resolve(ROOT, arg('out', path.join('doc', 'screenshots')));
const ONLY = String(arg('only', '') || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const SHOT_NAMES = [
  'overview',
  'statistics',
  'requirements-board',
  'requirements',
  'requirement-refs',
  'launch',
  'changes',
  'agent-resume',
  'agent-question'
];
const want = (name) => (ONLY.length ? ONLY.includes(name) : true);

const TMP = path.join(os.tmpdir(), 'app-screenshots');
const SITE = path.join(TMP, 'site');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.ico': 'image/x-icon'
};

function findChrome() {
  if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) return process.env.CHROMIUM_PATH;
  const base = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright');
  const found = [];
  if (fs.existsSync(base)) {
    for (const dir of fs.readdirSync(base).filter((n) => n.startsWith('chromium-'))) {
      for (const sub of ['chrome-win64', 'chrome-win']) {
        found.push(path.join(base, dir, sub, 'chrome.exe'));
      }
    }
  }
  found.push(
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
  );
  return found.find((f) => fs.existsSync(f)) || null;
}

function prepareSite() {
  if (!hasFlag('no-build')) {
    console.log('构建前端…');
    const r = spawnSync('npm run build', {
      cwd: ROOT,
      stdio: 'inherit',
      shell: true
    });
    if (r.status !== 0) throw new Error('npm run build 失败');
  }
  const renderer = path.join(ROOT, 'electron', 'renderer');
  if (!fs.existsSync(path.join(renderer, 'index.html'))) {
    throw new Error('electron/renderer 不存在，请先 npm run build');
  }

  fs.rmSync(SITE, { recursive: true, force: true });
  fs.mkdirSync(SITE, { recursive: true });
  fs.cpSync(renderer, SITE, { recursive: true });

  const gen = path.join(__dirname, 'gen-mock.cjs');
  const r = spawnSync(process.execPath, [gen, '--out', path.join(SITE, 'mock.js')], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('生成演示数据失败');

  const indexFile = path.join(SITE, 'index.html');
  const inject = `    <script>
      try {
        localStorage.setItem('pm.ui.theme', '${THEME}');
        localStorage.setItem('pm.ui.skin', 'vivid');
        localStorage.setItem('pm.ui.layout', JSON.stringify({ leftW: 246, rightW: 470, leftCollapsed: false, rightCollapsed: false }));
      } catch (e) { /* 预览环境忽略 */ }
      document.documentElement.dataset.theme = '${THEME}';
      document.documentElement.dataset.skin = 'vivid';
    </script>
    <script src="./mock.js"></script>
`;
  let html = fs.readFileSync(indexFile, 'utf8');
  if (/<script type="module"/.test(html)) {
    html = html.replace(/(\s*)<script type="module"/, '\n' + inject + '$1<script type="module"');
  } else {
    html = html.replace('</head>', inject + '  </head>');
  }
  fs.writeFileSync(indexFile, html);
}

function serve() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\/+/, '') || 'index.html';
    const file = path.join(SITE, rel);
    if (!file.startsWith(SITE) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

/**
 * 启动浏览器并拿到调试端口。
 *
 * 不靠 stderr 里的 "DevTools listening on ..."：Windows 上 Edge / Chrome 的启动器常常
 * 把真正的浏览器进程留在后台，自己立刻退出（stderr 什么都没有），于是「子进程退出」
 * 并不等于启动失败。端口一律从 profile 下的 DevToolsActivePort 文件读，进程退出只当提示。
 */
function launchChrome(chrome) {
  const profile = path.join(TMP, 'profile-' + Date.now());
  const child = spawn(
    chrome,
    [
      '--headless=new',
      '--remote-debugging-port=0',
      '--user-data-dir=' + profile,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--hide-scrollbars',
      '--disable-extensions',
      'about:blank'
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] }
  );
  /* stderr 没人读会把缓冲区塞满、拖住浏览器：一律丢弃，报错看超时信息 */
  child.stderr.resume();
  return new Promise((resolve, reject) => {
    const portFile = path.join(profile, 'DevToolsActivePort');
    const end = Date.now() + 20000;
    let exitCode = null;
    child.on('exit', (code) => {
      exitCode = code;
    });
    child.on('error', reject);
    const poll = () => {
      try {
        if (fs.existsSync(portFile)) {
          const port = Number(String(fs.readFileSync(portFile, 'utf8')).split(/\r?\n/)[0]);
          if (port > 0) {
            resolve({ child, debugPort: port, profile });
            return;
          }
        }
      } catch (_) {
        /* 文件刚创建时可能读不全，下一轮再试 */
      }
      if (Date.now() > end) {
        reject(new Error('Chromium 启动超时' + (exitCode === null ? '' : '（启动器已退出：' + exitCode + '）')));
        return;
      }
      setTimeout(poll, 150);
    };
    poll();
  });
}

/** 用 CDP 关掉整个浏览器：启动器早就退出了，杀子进程管不到真正在跑的那个 */
async function closeChrome(port) {
  try {
    const res = await fetch('http://127.0.0.1:' + port + '/json/version', { signal: AbortSignal.timeout(1000) });
    const info = await res.json();
    const ws = new WebSocket(info.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });
    ws.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
    await new Promise((r) => setTimeout(r, 1500));
    ws.close();
  } catch (_) {
    /* 已经退出或连不上：没什么可关的 */
  }
}

async function pageWs(port) {
  for (let i = 0; i < 80; i += 1) {
    try {
      const res = await fetch('http://127.0.0.1:' + port + '/json/list', { signal: AbortSignal.timeout(800) });
      const list = await res.json();
      const page = list.find((t) => t.type === 'page');
      if (page && page.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch (_) {}
    await sleep(150);
  }
  throw new Error('DevTools 页面未就绪');
}

function cdpClient(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let seq = 0;
  const pending = new Map();
  const ready = new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error('DevTools WebSocket 连接失败'));
  });
  ws.onmessage = (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch (_) {
      return;
    }
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    }
  };
  const send = (method, params) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  return { ready, send, close: () => ws.close() };
}

async function main() {
  const chrome = findChrome();
  if (!chrome) throw new Error('找不到 Chromium/Chrome，可设 CHROMIUM_PATH 环境变量指定');
  prepareSite();
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const server = await serve();
  const port = server.address().port;
  const launched = await launchChrome(chrome);
  const cdp = cdpClient(await pageWs(launched.debugPort));
  let saved = 0;

  try {
    await cdp.ready;
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: W,
      height: H,
      deviceScaleFactor: SCALE,
      mobile: false,
      screenWidth: W,
      screenHeight: H
    });
    await cdp.send('Page.navigate', { url: 'http://127.0.0.1:' + port + '/' });

    const evalJs = async (expression) => {
      const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || '页面脚本异常');
      return r.result ? r.result.value : undefined;
    };
    const waitFor = async (expression, label, timeout) => {
      const end = Date.now() + (timeout || 20000);
      while (Date.now() < end) {
        if (await evalJs(expression)) return;
        await sleep(150);
      }
      throw new Error('等待超时：' + label);
    };
    const clickText = async (selector, text) => {
      const ok = await evalJs(
        '(() => { const el = [...document.querySelectorAll(' +
          JSON.stringify(selector) +
          ')].find((e) => e.textContent.includes(' +
          JSON.stringify(text) +
          ')); if (!el) return false; el.click(); return true; })()'
      );
      if (!ok) throw new Error('找不到可点击元素：' + selector + ' / ' + text);
      await sleep(450);
    };
    const clickAria = async (label) => {
      const ok = await evalJs(
        '(() => { const el = document.querySelector(' +
          JSON.stringify('[aria-label="' + label + '"]') +
          '); if (!el) return false; el.click(); return true; })()'
      );
      if (!ok) throw new Error('找不到可点击元素：aria-label=' + label);
      await sleep(450);
    };
    const shot = async (name) => {
      if (!want(name)) return;
      await sleep(650);
      const img = await cdp.send('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
        captureBeyondViewport: false
      });
      const file = path.join(OUT_DIR, name + '.png');
      fs.writeFileSync(file, Buffer.from(img.data, 'base64'));
      saved += 1;
      console.log('  ✓ ' + path.relative(ROOT, file) + ' (' + Math.round(fs.statSync(file).size / 1024) + ' KB)');
    };
    /**
     * 悬停到某个元素上：悬停卡由 React 的 onMouseEnter 打开，只有真实鼠标轨迹能触发。
     * 先移到 (0,0) 再移到目标，避免浏览器把两次相邻坐标合并成一次移动。
     */
    const hoverText = async (selector, text, waitSelector) => {
      // 先滚到可视区再量坐标：面板是平滑滚动，滚动刚发出去时量到的位置还是旧的
      const found = await evalJs(
        '(() => { const el = [...document.querySelectorAll(' +
          JSON.stringify(selector) +
          ')].find((e) => e.textContent.includes(' +
          JSON.stringify(text) +
          ')); if (!el) return false; el.scrollIntoView({ block: "center" }); return true; })()'
      );
      if (!found) throw new Error('找不到悬停目标：' + selector + ' / ' + text);
      await sleep(500);
      const pos = await evalJs(
        '(() => { const el = [...document.querySelectorAll(' +
          JSON.stringify(selector) +
          ')].find((e) => e.textContent.includes(' +
          JSON.stringify(text) +
          ')); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()'
      );
      if (!pos) throw new Error('悬停目标消失：' + selector + ' / ' + text);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0, button: 'none' });
      await sleep(120);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pos.x, y: pos.y, button: 'none' });
      await waitFor('!!document.querySelector(' + JSON.stringify(waitSelector) + ')', '悬停卡');
    };

    await waitFor("document.querySelectorAll('.ov-row').length > 3", '总览渲染');
    await waitFor("document.documentElement.dataset.theme === '" + THEME + "'", '主题应用');
    await shot('overview');

    await clickText('.nav-item', '统计');
    await waitFor("!!document.querySelector('.stat-chart')", '统计页');
    await shot('statistics');

    await clickText('.pitem', '星港数据平台');
    await waitFor("!!document.querySelector('.req')", '需求列表');
    await clickText('.req', '工作台首页支持自定义卡片排序');
    await waitFor("!!document.querySelector('.rd-title')", '需求详情');
    await shot('requirements');

    /* 看板：先去统计页让右面板收起，再看板视图占满中区；截完切回列表，后面的场景仍按列表点击 */
    await clickText('.nav-item', '统计');
    await waitFor("!!document.querySelector('.stat-chart')", '统计页');
    await clickText('.pitem', '星港数据平台');
    await waitFor("!!document.querySelector('.req')", '需求列表');
    await clickAria('看板视图');
    await waitFor("document.querySelectorAll('.board .bcard').length > 3", '看板');
    await shot('requirements-board');
    await clickAria('列表视图');
    await waitFor("!!document.querySelector('.req')", '需求列表');

    await clickText('.req', '导出任务列表复用消息分组交互');
    await waitFor("!!document.querySelector('.rd-title')", '引用示例需求详情');
    await evalJs("(() => { const b = document.querySelector('.rpanel-body'); if (b) b.scrollTop = 0; return true; })()");
    await hoverText('.rd-ref.rd-file', 'JobList.tsx', '.fhover');
    await shot('requirement-refs');

    await clickText('.vtab', '启动台');
    await waitFor("!!document.querySelector('.rlogs .log')", '启动台日志');
    await shot('launch');

    await clickText('.vtab', '修改记录');
    await waitFor("!!document.querySelector('.gtree .gfile')", '修改记录');
    await clickText('.gfile', 'ExportPanel.tsx');
    await waitFor("!!document.querySelector('.diff-body')", 'diff');
    await shot('changes');

    await clickText('.vtab', '需求中心');
    await waitFor("!!document.querySelector('.req')", '需求列表');
    await clickText('.pitem', '极光移动端');
    await waitFor("!!document.querySelector('.req')", '移动端需求列表');
    await clickText('.req', '消息中心支持按项目分组并置顶未读');
    await waitFor("!!document.querySelector('.rd-title')", '已认领需求详情');
    await evalJs("(() => { const b = document.querySelector('.rpanel-body'); if (b) b.scrollTop = b.scrollHeight; return true; })()");
    await shot('agent-resume');

    await clickText('.req', '灰度开关默认值改为跟随系统');
    await waitFor("!!document.querySelector('.rd-ask')", 'Agent 提问卡片');
    /* 卡片是 sticky：默认不滚（保留顶部上下文）；只有卡片超出面板底部时才滚最小幅度 */
    await evalJs(`(() => {
      const b = document.querySelector('.rpanel-body');
      const c = document.querySelector('.rd-ask');
      if (!b || !c) return true;
      b.scrollTop = 0;
      const br = b.getBoundingClientRect();
      const cr = c.getBoundingClientRect();
      const overflow = cr.bottom - (br.bottom - 16);
      if (overflow > 0) b.scrollTop += overflow;
      return true;
    })()`);
    await sleep(1100);
    await shot('agent-question');

    console.log(
      '完成：' + saved + ' 张，' + W + '×' + H + ' 视口 @' + SCALE + 'x（' + W * SCALE + '×' + H * SCALE + '）' +
        (ONLY.length ? '，仅 ' + ONLY.join(',') : '，共 ' + SHOT_NAMES.length + ' 页')
    );
  } finally {
    cdp.close();
    await closeChrome(launched.debugPort);
    launched.child.kill();
    server.close();
    for (let i = 0; i < 5; i += 1) {
      try {
        fs.rmSync(launched.profile, { recursive: true, force: true });
        break;
      } catch (_) {
        await sleep(300);
      }
    }
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});

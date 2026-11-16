'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

/**
 * cloudflared 的定位与自动下载。
 *
 * 原则是「别问用户」：装了就用（先看应用目录，再看 PATH），没装就自己下一份到应用目录。
 * 下载源是官方 GitHub release 的 latest 固定链接，不校验签名 —— 这是个人工具，
 * 讲究的是「装上就能用」，不是供应链审计。想用自己那份就设 PM_CLOUDFLARED。
 *
 * 只下一个平台一个文件（~40MB），成功即落盘；失败保留半成品会被下次覆盖。
 */

const DOWNLOAD_BASE = 'https://github.com/cloudflare/cloudflared/releases/latest/download/';
/** 低于这个体积基本可以断定下到的是错误页而不是可执行文件 */
const MIN_BYTES = 8 * 1024 * 1024;

function assetName() {
  if (process.platform === 'win32') return 'cloudflared-windows-amd64.exe';
  if (process.platform === 'darwin') {
    return process.arch === 'arm64' ? 'cloudflared-darwin-arm64' : 'cloudflared-darwin-amd64';
  }
  return process.arch === 'arm64' ? 'cloudflared-linux-arm64' : 'cloudflared-linux-amd64';
}

function localName() {
  return process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
}

function exists(file) {
  try {
    return fs.statSync(file).size > MIN_BYTES;
  } catch (_) {
    return false;
  }
}

/** PATH 里有没有：探一次 --version 比解析 PATH 可靠（Windows 还要看 PATHEXT） */
function onPath() {
  try {
    const res = spawnSync(localName(), ['--version'], { stdio: 'ignore', timeout: 8000 });
    return !res.error && res.status === 0;
  } catch (_) {
    return false;
  }
}

/**
 * 返回可执行文件路径：应用目录里的那份优先，其次 PATH。
 * 都没有则下载到 `dir`，返回本地路径。网络失败抛错，由调用方决定怎么显示。
 *
 * `fetchImpl` 由调用方注入：Electron 主进程必须传 `net.fetch` —— Node 自带的 fetch（undici）
 * 不读系统代理，浏览器能打开的链接它会直接 `fetch failed`。cloudflared 的下载源在 GitHub，
 * 开了代理的机器上这是最常见的一种失败。
 */
async function ensure({ dir, log, fetchImpl }) {
  const say = typeof log === 'function' ? log : () => {};
  const doFetch = typeof fetchImpl === 'function' ? fetchImpl : globalThis.fetch;

  const envPath = String(process.env.PM_CLOUDFLARED || '').trim();
  if (envPath && exists(envPath)) return envPath;

  const local = path.join(dir, localName());
  if (exists(local)) return local;

  if (onPath()) {
    say('[cloudflared] 使用系统已安装的版本');
    return localName();
  }

  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, localName());
  const temp = target + '.part';
  const url = String(process.env.PM_CLOUDFLARED_URL || '').trim() || DOWNLOAD_BASE + assetName();
  say('[cloudflared] 未检测到，开始下载：' + url);

  try {
    /**
     * 两种取法各试一次：
     * - 注入的 fetchImpl（Electron 传 net.fetch，走 Chromium 网络栈，跟随系统代理）；
     * - Node 自带的 fetch（不读系统代理，但代理只对应用生效时反而更通）。
     * 都失败再等 2 秒重来一次首选通道 —— GitHub 的偶发失败基本一次就过。
     */
    const transports = [{ name: 'net', fn: doFetch }];
    if (typeof fetchImpl === 'function' && typeof globalThis.fetch === 'function') {
      transports.push({ name: 'node', fn: globalThis.fetch });
    }

    const once = async (fn) => {
      const res = await fn(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(10 * 60 * 1000)
      });
      if (!res || !res.ok) throw new Error('HTTP ' + (res ? res.status : '无响应'));
      return Buffer.from(await res.arrayBuffer());
    };

    let buf = null;
    let lastError = null;
    for (const t of transports) {
      try {
        buf = await once(t.fn);
        if (transports.length > 1) say('[cloudflared] 下载通道：' + t.name);
        break;
      } catch (e) {
        lastError = e;
      }
    }
    if (!buf) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        buf = await once(transports[0].fn);
        say('[cloudflared] 重试后下载成功');
      } catch (e) {
        lastError = lastError || e;
      }
    }
    if (!buf) throw lastError || new Error('下载失败');

    if (buf.length < MIN_BYTES) {
      throw new Error('下载内容大小异常（' + buf.length + ' 字节），可能拿到的是错误页');
    }
    fs.writeFileSync(temp, buf);
    fs.renameSync(temp, target);
    if (process.platform !== 'win32') fs.chmodSync(target, 0o755);
    say('[cloudflared] 下载完成（' + Math.round(buf.length / 1024 / 1024) + 'MB）：' + target);
    return target;
  } catch (e) {
    try {
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
    } catch (_) {
      /* 清理失败不影响结论 */
    }
    /**
     * undici 把真正的原因藏在 cause 里（ENOTFOUND / ECONNRESET / UND_ERR_CONNECT_TIMEOUT…），
     * 只报 "fetch failed" 等于什么都没说。这里把 code 拼进去，一眼能看出是代理还是墙。
     */
    const cause = (e && e.cause) || null;
    const detail = (cause && (cause.code || cause.message)) || (e && e.message) || '网络不可用';
    const err = new Error('下载 cloudflared 失败：' + detail);
    err.code = 'cloudflared_download_failed';
    err.url = url;
    throw err;
  }
}

module.exports = { ensure, assetName, DOWNLOAD_BASE, MIN_BYTES };

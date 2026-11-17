'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const tls = require('tls');
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
const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 6;
/**
 * 单通道总超时：50MB 在普通宽带上一两分钟就完，但 GitHub 加速 / 代理通道可能只有几十 KB/s，
 * 10 分钟会卡在下载中途。宁可让首次准备慢一点，也别在下到一半时报错。
 */
const DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Node 自带证书库 + 系统根证书。
 *
 * Node 的 fetch（undici）只认自带的 CA 包，不读系统证书库；GitHub 加速工具、企业代理
 * 会把流量做中间人替换，证书只装在系统库里，于是它只会报 `fetch failed`。
 * 桌面应用的自动更新走 Chromium 栈（读系统库）所以正常，下载 cloudflared 也得有一条
 * 同样读系统库的通道，否则「更新安装包能下、这个下不了」就成了用户看到的样子。
 */
function systemCaBundle() {
  try {
    if (typeof tls.getCACertificates !== 'function') return null;
    const bundled = tls.getCACertificates('default') || [];
    const system = tls.getCACertificates('system') || [];
    return bundled.length || system.length ? bundled.concat(system) : null;
  } catch (_) {
    return null;
  }
}

/** 把一次请求的错误压成一句可读的话：优先带 code，其次 message */
function describeError(e) {
  if (!e) return '未知错误';
  const cause = e.cause || null;
  const code = (cause && cause.code) || e.code || '';
  const message = e.message || (cause && cause.message) || '';
  if (code && message.indexOf(code) === -1) return code + ' ' + message;
  return message || code || '未知错误';
}

/**
 * 用 https 模块下载到文件：读系统证书库、跟随重定向、流式落盘。
 * 不走 undici 的原因是证书库不同，这条通道专门兜中间人证书的情况。
 */
function downloadToFile(url, dest, ca) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (e) => {
      if (settled) return;
      settled = true;
      reject(e);
    };
    const done = (bytes) => {
      if (settled) return;
      settled = true;
      resolve(bytes);
    };

    const request = (target, left) => {
      const req = https.get(
        target,
        {
          headers: { 'user-agent': 'project-manager' },
          ca,
          signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)
        },
        (res) => {
          const status = res.statusCode || 0;
          const location = res.headers.location;
          if (REDIRECT_CODES.has(status) && location) {
            res.resume();
            if (left <= 0) return fail(new Error('重定向次数过多'));
            let next;
            try {
              next = new URL(location, target).toString();
            } catch (_) {
              return fail(new Error('重定向地址无效'));
            }
            return request(next, left - 1);
          }
          if (status !== 200) {
            res.resume();
            return fail(new Error('HTTP ' + status));
          }
          const out = fs.createWriteStream(dest);
          let bytes = 0;
          res.on('data', (chunk) => {
            bytes += chunk.length;
          });
          res.on('error', fail);
          res.on('aborted', () => fail(new Error('连接中断')));
          out.on('error', fail);
          out.on('finish', () => out.close(() => done(bytes)));
          res.pipe(out);
        }
      );
      req.on('error', fail);
    };

    request(url, MAX_REDIRECTS);
  });
}

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
 * 既不读系统代理，也不读系统证书库，开了代理 / GitHub 加速工具的机器上只会报 `fetch failed`。
 * 注入 net.fetch 时还会补一条 https + 系统证书库的回落通道，见 `systemCaBundle()`。
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
     * 依次尝试三条通道，任何一条下完就停：
     * - `net`：Electron net.fetch，走 Chromium 网络栈（系统代理 + 系统证书库）；
     * - `system-ca`：https 模块 + 系统证书库，专门兜「代理中间人证书只装在系统里」的情况；
     * - `node`：Node 自带 fetch，代理只对应用生效时反而更通。
     * 全失败再等 2 秒重来一次首选通道 —— 偶发失败基本一次就过。
     */
    const saveBuffer = async (fn) => {
      const res = await fn(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)
      });
      if (!res || !res.ok) throw new Error('HTTP ' + (res ? res.status : '无响应'));
      const buf = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(temp, buf);
      return buf.length;
    };

    const writers = [{ name: 'net', run: () => saveBuffer(doFetch) }];
    /** 只有 Electron 注入 net.fetch 时才加系统证书通道：普通 Node 环境调 ensure 不该偷偷发网络请求 */
    const ca = typeof fetchImpl === 'function' ? systemCaBundle() : null;
    if (ca) writers.push({ name: 'system-ca', run: () => downloadToFile(url, temp, ca) });
    if (typeof fetchImpl === 'function' && typeof globalThis.fetch === 'function') {
      writers.push({ name: 'node', run: () => saveBuffer(globalThis.fetch) });
    }

    const cleanTemp = () => {
      try {
        if (fs.existsSync(temp)) fs.unlinkSync(temp);
      } catch (_) {
        /* 清理失败不影响结论 */
      }
    };

    let size = 0;
    const failures = [];
    const accept = (bytes) => {
      if (bytes < MIN_BYTES) {
        throw new Error('下载内容大小异常（' + bytes + ' 字节），可能拿到的是错误页');
      }
      return bytes;
    };

    for (const t of writers) {
      try {
        size = accept(await t.run());
        if (writers.length > 1) say('[cloudflared] 下载通道：' + t.name);
        break;
      } catch (e) {
        failures.push(t.name + '：' + describeError(e));
        cleanTemp();
      }
    }
    if (!size) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        size = accept(await writers[0].run());
        say('[cloudflared] 重试后下载成功');
      } catch (e) {
        failures.push(writers[0].name + '（重试）：' + describeError(e));
        cleanTemp();
      }
    }
    if (!size) throw new Error('所有下载通道都失败（' + failures.join('；') + '）');

    fs.renameSync(temp, target);
    if (process.platform !== 'win32') fs.chmodSync(target, 0o755);
    say('[cloudflared] 下载完成（' + Math.round(size / 1024 / 1024) + 'MB）：' + target);
    return target;
  } catch (e) {
    try {
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
    } catch (_) {
      /* 清理失败不影响结论 */
    }
    const cause = (e && e.cause) || null;
    const detail = (e && e.message) || (cause && (cause.code || cause.message)) || '网络不可用';
    const err = new Error('下载 cloudflared 失败：' + detail);
    err.code = 'cloudflared_download_failed';
    err.url = url;
    throw err;
  }
}

module.exports = { ensure, assetName, DOWNLOAD_BASE, MIN_BYTES };

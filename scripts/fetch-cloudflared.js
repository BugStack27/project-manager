'use strict';

const fs = require('fs');
const path = require('path');
const cloudflared = require('../electron/services/cloudflared');

/**
 * 打包前准备：把当前平台的 cloudflared 放进 build/cloudflared，
 * electron-builder 再把这个目录整体拷进安装包的 resources/cloudflared。
 *
 * 上次已经下过就复用；PM_CLOUDFLARED 指向的文件会复制过来，
 * 方便先用手里的镜像 / 加速通道下好再打包。
 */
async function main() {
  const dir = path.join(__dirname, '..', 'build', 'cloudflared');
  const dest = path.join(dir, cloudflared.localName());
  fs.mkdirSync(dir, { recursive: true });

  const override = String(process.env.PM_CLOUDFLARED || '').trim();
  if (override && fs.existsSync(override)) {
    if (fs.statSync(override).size < cloudflared.MIN_BYTES) {
      throw new Error('PM_CLOUDFLARED 指向的文件太小，不像是 cloudflared：' + override);
    }
    fs.copyFileSync(override, dest);
    console.log('[prep] 使用 PM_CLOUDFLARED 的文件：' + override);
    return;
  }

  const bin = await cloudflared.ensure({
    dir,
    /** 打包要的是官方资产本身，别被打包机上全局安装的那份顶替 */
    allowPath: false,
    log: console.log,
    fetchImpl: (url, opts) => fetch(url, opts)
  });
  if (bin !== dest) fs.copyFileSync(bin, dest);
  console.log('[prep] cloudflared 就绪：' + dest);
}

main().catch((e) => {
  console.error('[prep] ' + e.message);
  process.exit(1);
});

#!/usr/bin/env node
/*
 * 生成应用图标（窗口 + 安装包 / exe），零第三方依赖。
 *
 * 字形直接复用 scripts/make-tray-icons.js 的紫蓝渐变圆角方底 + 三道白杠，
 * 区别只有一处：应用图标四周留 1 个网格单位（render 的 pad 参数）。托盘图标为 16px
 * 可辨识度刻意贴边，应用图标会出现在 256px 大图 / 任务栏大图标场景，贴边会顶框。
 *
 * 每个尺寸都原生栅格化：ICO 是「一组独立位图」，Windows 按资源管理器、任务栏、
 * Alt-Tab、高 DPI 各自挑尺寸；拿 256px 缩到 16px 只会糊成一团色块。
 *
 * 条目编码分两种：
 *   - 16~48px 用 32bpp DIB（BMP 条目，带 alpha 与 AND 掩码），rcedit / NSIS 兼容性最好；
 *   - 64~256px 用 PNG 条目（Vista 起支持），否则 256px 的 BMP 单条就要 256KB+。
 * electron-builder 要求 Windows 图标至少含 256×256，256 这一档不能省。
 *
 *   node scripts/make-app-icon.js
 *
 * 产物：
 *   build/icon.ico                 electron-builder 改写 exe / NSIS 安装程序图标
 *   electron/assets/app-icon.png   256px，BrowserWindow.icon（开发态与 Linux 窗口）
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { render, encodePng } = require('./make-tray-icons');

const ROOT = path.join(__dirname, '..');
const BUILD_DIR = path.join(ROOT, 'build');
const ASSET_DIR = path.join(ROOT, 'electron', 'assets');
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
const PAD = 1;

/** RGBA（自上而下）→ ICO 的 32bpp DIB 条目：BITMAPINFOHEADER + bottom-up BGRA + AND 掩码 */
function dibEntry(rgba, size) {
  const hdr = Buffer.alloc(40);
  const xorSize = size * size * 4;
  const maskRow = ((size + 31) >> 5) * 4; // 1bpp 掩码每行按 4 字节对齐
  const maskSize = maskRow * size;

  hdr.writeUInt32LE(40, 0);                   // biSize
  hdr.writeInt32LE(size, 4);                  // biWidth
  hdr.writeInt32LE(size * 2, 8);              // biHeight：XOR + AND 两张图
  hdr.writeUInt16LE(1, 12);                   // biPlanes
  hdr.writeUInt16LE(32, 14);                  // biBitCount
  hdr.writeUInt32LE(0, 16);                   // BI_RGB
  hdr.writeUInt32LE(xorSize + maskSize, 20);  // biSizeImage（目录项另有精确长度，此项仅供解析参考）

  const xor = Buffer.alloc(xorSize);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const s = ((size - 1 - y) * size + x) * 4; // DIB 自下而上
      const d = (y * size + x) * 4;
      xor[d] = rgba[s + 2];                       // B
      xor[d + 1] = rgba[s + 1];                   // G
      xor[d + 2] = rgba[s];                       // R
      xor[d + 3] = rgba[s + 3];                   // A
    }
  }
  // AND 掩码全 0：32bpp 的透明由 alpha 决定，掩码不再参与合成
  return Buffer.concat([hdr, xor, Buffer.alloc(maskSize)]);
}

/** 组装 ICO 容器：6 字节头 + 每项 16 字节目录 + 连续数据块 */
function buildIco(entries) {
  const head = Buffer.alloc(6 + entries.length * 16);
  head.writeUInt16LE(0, 0);                  // reserved
  head.writeUInt16LE(1, 2);                  // type: icon
  head.writeUInt16LE(entries.length, 4);
  let cursor = head.length;
  entries.forEach((e, i) => {
    const p = 6 + i * 16;
    head.writeUInt8(e.size === 256 ? 0 : e.size, p);     // ICO 目录用 0 表示 256
    head.writeUInt8(e.size === 256 ? 0 : e.size, p + 1);
    head.writeUInt8(0, p + 2);                            // 无调色板
    head.writeUInt8(0, p + 3);
    head.writeUInt16LE(1, p + 4);                         // planes
    head.writeUInt16LE(32, p + 6);                        // bpp
    head.writeUInt32LE(e.blob.length, p + 8);
    head.writeUInt32LE(cursor, p + 12);
    cursor += e.blob.length;
  });
  return Buffer.concat([head, ...entries.map((e) => e.blob)]);
}

fs.mkdirSync(BUILD_DIR, { recursive: true });
fs.mkdirSync(ASSET_DIR, { recursive: true });

const entries = ICO_SIZES.map((size) => {
  const rgba = render(size, PAD);
  const png = size > 48;
  return { size, png, blob: png ? encodePng(size, rgba) : dibEntry(rgba, size) };
});

const ico = buildIco(entries);
fs.writeFileSync(path.join(BUILD_DIR, 'icon.ico'), ico);
fs.writeFileSync(path.join(ASSET_DIR, 'app-icon.png'), encodePng(256, render(256, PAD)));

console.log(`build/icon.ico  ${entries.length} sizes (16~256)  ${ico.length} B`);
entries.forEach((e) => {
  console.log(`  ${String(e.size).padStart(3)}x${String(e.size).padEnd(3)} ${e.png ? 'PNG' : 'DIB'}  ${e.blob.length} B`);
});
console.log('electron/assets/app-icon.png  256x256');

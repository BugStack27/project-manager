#!/usr/bin/env node
/*
 * 生成系统托盘图标（无第三方依赖）。
 *
 * 为什么不用一张大图缩放：托盘图标在 Windows 上是 16 逻辑像素，1024px 的插画
 * 缩下来只剩色块；而且不同 DPI 缩放要的是 20 / 24 / 28 / 32 … 等不同物理尺寸，
 * 拿 16px 位图让 shell 拉伸等于二次模糊。
 *
 * 所以：字形按「16 网格」设计，每个尺寸各自栅格化（4×4 超采样抗锯齿），
 * 输出 RGBA（透明背景），不做重采样。
 *
 *   node scripts/make-tray-icons.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const OUT_DIR = path.join(__dirname, '..', 'electron', 'assets');
const TRAY_DIR = path.join(OUT_DIR, 'tray');
const TRAY_REVIEW_DIR = path.join(TRAY_DIR, 'review');
const OVERLAY_REVIEW_DIR = path.join(OUT_DIR, 'overlay', 'review');
const SIZES = [16, 20, 24, 28, 32, 36, 40, 48];

/* ── 字形定义（单位：16 网格） ─────────────────────────
 * 圆角方底 + 三条白色横杠（列表语义），在 16px 下只剩「底色块 + 三道杠」，
 * 再细的元素（勾选框、虚点）在这个尺寸上无法分辨，一律不要。
 */
const GRID = 16;
const RADIUS = 3.6;                 // 圆角半径
const BAR_X0 = 4.0;                 // 横杠左缘
const BAR_X1 = 12.0;                // 横杠右缘
const BAR_H = 2.0;                  // 横杠粗细
const BAR_CY = [5.0, 8.0, 11.0];    // 三条横杠的中心线
const COLOR_TOP = [0x52, 0x50, 0xa8];  // 渐变上缘
const COLOR_BOT = [0x3c, 0x3a, 0x7e];  // 渐变下缘
const COLOR_BAR = [0xff, 0xff, 0xff];

/* ── 几何判定 ────────────────────────────────────── */

/** 圆角矩形内部判定：把点夹到「内缩矩形」上求距离 */
function inRoundedRect(x, y, w, h, r) {
  const cx = Math.min(Math.max(x, r), w - r);
  const cy = Math.min(Math.max(y, r), h - r);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

/* ── 栅格化 ──────────────────────────────────────── */

/**
 * @param {number} size 输出边长（像素）
 * @param {number} pad  四周留白（16 网格单位）。托盘用 0 贴边占满 16px；
 *                       应用图标用 1 留边距，否则 256px 大图会顶满边框。
 */
function render(size, pad = 0) {
  const SS = 4;                       // 每像素 4×4 超采样
  const canvas = GRID + pad * 2;      // 字形仍是 16 网格，只是画布四周加留白
  const scale = size / canvas;        // 网格 → 实际像素
  const px = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let covBase = 0;
      let covBar = 0;

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          // 采样点落在网格坐标（16 网格单位）
          const gx = (x + (sx + 0.5) / SS) / scale - pad;
          const gy = (y + (sy + 0.5) / SS) / scale - pad;

          const inBase = inRoundedRect(gx, gy, GRID, GRID, RADIUS);
          if (!inBase) continue;
          covBase++;

          const inBarX = gx >= BAR_X0 && gx <= BAR_X1;
          if (!inBarX) continue;
          for (const cy of BAR_CY) {
            if (gy >= cy - BAR_H / 2 && gy <= cy + BAR_H / 2) { covBar++; break; }
          }
        }
      }

      if (covBase === 0) continue;    // 完全在圆角外 → 保持透明

      const total = SS * SS;
      const alpha = covBase / total;
      // 横杠覆盖率相对于底色覆盖率取比例，避免边缘出现白边
      const barRatio = covBar / covBase;

      // 底色按 y 做轻微渐变（每个尺寸原生栅格化，不存在缩放糊掉的问题）
      const t = Math.min(1, Math.max(0, y / (size - 1)));
      const base = [
        COLOR_TOP[0] + (COLOR_BOT[0] - COLOR_TOP[0]) * t,
        COLOR_TOP[1] + (COLOR_BOT[1] - COLOR_TOP[1]) * t,
        COLOR_TOP[2] + (COLOR_BOT[2] - COLOR_TOP[2]) * t,
      ];

      const i = (y * size + x) * 4;
      for (let c = 0; c < 3; c++) {
        px[i + c] = Math.round(base[c] + (COLOR_BAR[c] - base[c]) * barRatio);
      }
      px[i + 3] = Math.round(alpha * 255);
    }
  }
  return px;
}

/* ── 待审核角标：红底白字（3×5 点阵） ─────────────── */

const BADGE_RED = [0xff, 0x3b, 0x30];

const GLYPHS = {
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
  '+': ['000', '010', '111', '010', '000']
};

function glyphRows(label) {
  if (label === '9plus') {
    const a = GLYPHS['9'];
    const b = GLYPHS['+'];
    return a.map((row, i) => row + '0' + b[i]);
  }
  return GLYPHS[String(label)] || GLYPHS['9'];
}

/** 在一个 RGBA 缓冲上画红底白字角标；tray 用右上角，overlay 用整张图 */
function paintBadge(base, size, cx, cy, radius, label) {
  const rows = glyphRows(label);
  const cols = Math.max(...rows.map((r) => r.length));
  const cell = Math.min(1.55, (2 * radius - 1.2) / Math.max(cols, 5));
  const x0 = cx - (cols * cell) / 2;
  const y0 = cy - (5 * cell) / 2;
  const SS = 4;
  const scale = size / GRID;
  const out = Buffer.from(base);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let badgeCov = 0;
      let glyphCov = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const gx = (x + (sx + 0.5) / SS) / scale;
          const gy = (y + (sy + 0.5) / SS) / scale;
          const dx = gx - cx;
          const dy = gy - cy;
          if (dx * dx + dy * dy > radius * radius) continue;
          badgeCov++;
          const col = Math.floor((gx - x0) / cell);
          const row = Math.floor((gy - y0) / cell);
          if (row >= 0 && row < rows.length && col >= 0 && col < cols && rows[row][col] === '1') {
            glyphCov++;
          }
        }
      }
      if (!badgeCov) continue;

      const total = SS * SS;
      const badgeA = badgeCov / total;
      const glyphA = glyphCov / total;
      const redA = Math.max(0, badgeA - glyphA);
      const i = (y * size + x) * 4;
      const baseA = out[i + 3] / 255;
      const outA = badgeA + baseA * (1 - badgeA);
      if (outA <= 0) continue;
      const red = [
        BADGE_RED[0] * redA + 255 * glyphA,
        BADGE_RED[1] * redA + 255 * glyphA,
        BADGE_RED[2] * redA + 255 * glyphA
      ];
      for (let c = 0; c < 3; c++) {
        out[i + c] = Math.round((red[c] + out[i + c] * baseA * (1 - badgeA)) / outA);
      }
      out[i + 3] = Math.round(outA * 255);
    }
  }
  return out;
}

function renderBadge(size, label) {
  return paintBadge(render(size), size, 11.6, 4.4, 4.6, label);
}

function renderOverlay(size, label) {
  return paintBadge(Buffer.alloc(size * size * 4), size, GRID / 2, GRID / 2, 7.0, label);
}

const BADGE_LABELS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '9plus'];

/* ── PNG 编码（RGBA8，无滤波） ────────────────────── */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 6;    // color type: RGBA
  ihdr[10] = 0;   // compression
  ihdr[11] = 0;   // filter
  ihdr[12] = 0;   // interlace

  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;      // filter type 0（None）
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ── 主流程 ────────────────────────────────────────
 * 只有直接执行本脚本时才重写托盘资源；make-app-icon.js 复用下面的字形与 PNG 编码，
 * require 本文件时不应顺带把托盘图标全部重刷一遍。
 */
if (require.main === module) {
  fs.mkdirSync(TRAY_REVIEW_DIR, { recursive: true });
  fs.mkdirSync(OVERLAY_REVIEW_DIR, { recursive: true });
  for (const size of SIZES) {
    const png = encodePng(size, render(size));
    const file = path.join(TRAY_DIR, `tray-${size}.png`);
    fs.writeFileSync(file, png);
    console.log(`tray/tray-${size}.png  ${size}x${size}  ${png.length} B`);
  }

  for (const label of BADGE_LABELS) {
    for (const size of SIZES) {
      const png = encodePng(size, renderBadge(size, label));
      fs.writeFileSync(path.join(TRAY_REVIEW_DIR, `${label}-${size}.png`), png);
    }
    for (const size of [16, 32]) {
      const png = encodePng(size, renderOverlay(size, label));
      fs.writeFileSync(path.join(OVERLAY_REVIEW_DIR, `${label}-${size}.png`), png);
    }
    console.log(`badge ${label}  tray ${SIZES.length} sizes + overlay 16/32`);
  }

  /* 预览图：把各尺寸按整数倍放大并排，便于肉眼检查像素结构（仅写到临时目录，不入库） */
  const preview = (() => {
    const ZOOM = 8;
    const GAP = 4;
    const width = SIZES.reduce((s, n) => s + n * ZOOM + GAP, GAP);
    const height = Math.max(...SIZES) * ZOOM + GAP * 2;
    const buf = Buffer.alloc(width * height * 4);
    // 背景：左半浅灰、右半深灰，同时检查浅色/深色任务栏下的观感
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const light = x < width / 2;
        buf[i] = light ? 0xf3 : 0x1e;
        buf[i + 1] = light ? 0xf3 : 0x1e;
        buf[i + 2] = light ? 0xf3 : 0x20;
        buf[i + 3] = 255;
      }
    }
    let ox = GAP;
    for (const size of SIZES) {
      const src = render(size);
      for (let y = 0; y < size * ZOOM; y++) {
        for (let x = 0; x < size * ZOOM; x++) {
          const si = (Math.floor(y / ZOOM) * size + Math.floor(x / ZOOM)) * 4;
          const a = src[si + 3] / 255;
          const di = ((GAP + y) * width + ox + x) * 4;
          const bg = [buf[di], buf[di + 1], buf[di + 2]];
          for (let c = 0; c < 3; c++) buf[di + c] = Math.round(src[si + c] * a + bg[c] * (1 - a));
          buf[di + 3] = 255;
        }
      }
      ox += size * ZOOM + GAP;
    }
    return { buf, width, height };
  })();

  const previewFile = path.join(os.tmpdir(), 'tray-icon-preview.png');
  fs.writeFileSync(previewFile, encodePng2(preview));
  console.log('preview -> ' + previewFile);
}

module.exports = { render, encodePng, GRID };

// 预览图尺寸非正方形，单独编码
function encodePng2({ buf, width, height }) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    buf.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

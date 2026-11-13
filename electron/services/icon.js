'use strict';

const fs = require('fs');
const zlib = require('zlib');

/**
 * 从 Windows PE 可执行文件里抽取应用图标。
 *
 * 为什么不用现成 API：
 *   - `app.getFileIcon()` 实测在本机对 notepad / msedge / 各 IDE 返回同一个通用占位图
 *     （无窗口环境拿不到 shell 图标），不可用；
 *   - 快捷方式的 `icon` 字段多数为空（图标内嵌在 exe 里），只有少数产品指向独立 .ico。
 * 所以直接读 PE 资源：RT_GROUP_ICON + RT_ICON，组装成 ICO 容器交给渲染层。
 * Chromium 的 <img> 原生支持 ICO（BMP / PNG 两种条目都认），不需要在这里转码。
 *
 * 只做精准读取：先读 4KB 头解析节表，再只读资源段（Electron 的 exe 有 200MB，
 * 整文件读入会直接拖垮内存）。
 */

const HEADER_BYTES = 4096;
const MAX_RES_BYTES = 32 * 1024 * 1024;
const RT_ICON = 3;
const RT_GROUP_ICON = 14;
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** exe 路径 → 图标 dataURL（null = 抽不出来），进程内缓存，扫描只做一次 */
const cache = new Map();

function readAt(fd, offset, length) {
  const buf = Buffer.alloc(length);
  const n = fs.readSync(fd, buf, 0, length, offset);
  return n === length ? buf : buf.subarray(0, n);
}

/** 解析 PE 头，拿到资源节的原始偏移与大小；不是合法 PE 返回 null */
function parsePe(head) {
  if (head.length < 0x40 || head.readUInt16LE(0) !== 0x5a4d) return null; // 'MZ'
  const peOff = head.readUInt32LE(0x3c);
  if (peOff + 24 > head.length || head.readUInt32LE(peOff) !== 0x00004550) return null; // 'PE\0\0'

  const coff = peOff + 4;
  const numSections = head.readUInt16LE(coff + 2);
  const optSize = head.readUInt16LE(coff + 16);
  const opt = coff + 20;
  const magic = head.readUInt16LE(opt);
  // 数据目录起始位置：PE32+ 在 opt+112，PE32 在 opt+96；资源表是索引 2，所以再 +16
  const dirBase = magic === 0x20b ? opt + 112 : opt + 96;
  const dirOff = dirBase + 16;
  if (dirOff + 8 > head.length) return null;
  const resRva = head.readUInt32LE(dirOff);
  const resSize = head.readUInt32LE(dirOff + 4);
  if (!resRva || !resSize) return null;

  const secTable = opt + optSize;
  let res = null;
  for (let i = 0; i < numSections; i++) {
    const p = secTable + i * 40;
    if (p + 40 > head.length) return null;
    const vaddr = head.readUInt32LE(p + 12);
    const vsize = head.readUInt32LE(p + 8);
    const rawSize = head.readUInt32LE(p + 16);
    const rawPtr = head.readUInt32LE(p + 20);
    if (resRva >= vaddr && resRva < vaddr + Math.max(vsize, rawSize)) {
      res = {
        offset: rawPtr + (resRva - vaddr),
        size: Math.min(rawSize || vsize, MAX_RES_BYTES),
        rva: resRva
      };
      break;
    }
  }
  if (!res || !res.size) return null;
  return { res };
}

/** 资源目录（16 字节头 + 8 字节/项的条目表），offset 均相对资源节起点 */
function dirEntries(res, off) {
  if (off + 16 > res.length) return [];
  const named = res.readUInt16LE(off + 12);
  const ids = res.readUInt16LE(off + 14);
  const total = named + ids;
  const out = [];
  for (let i = 0; i < total; i++) {
    const p = off + 16 + i * 8;
    if (p + 8 > res.length) break;
    const nameField = res.readUInt32LE(p);
    const offField = res.readUInt32LE(p + 4);
    out.push({
      id: nameField & 0x80000000 ? null : nameField, // 命名资源（字符串名）这里用不上
      subdir: !!(offField & 0x80000000),
      offset: offField & 0x7fffffff
    });
  }
  return out;
}

/** 取某个资源的数据块（IMAGE_RESOURCE_DATA_ENTRY 里的 RVA 需要减掉资源节 RVA） */
function dataBlob(res, entryOff, resRva) {
  if (entryOff + 16 > res.length) return null;
  const rva = res.readUInt32LE(entryOff);
  const size = res.readUInt32LE(entryOff + 4);
  const off = rva - resRva;
  if (off < 0 || size <= 0 || off + size > res.length) return null;
  return res.subarray(off, off + size);
}

/** 遍历某个资源类型下的所有条目：{ id, blob } */
function blobsOfType(res, resRva, typeId) {
  const type = dirEntries(res, 0).find((e) => e.id === typeId && e.subdir);
  if (!type) return [];
  const out = [];
  for (const name of dirEntries(res, type.offset)) {
    if (!name.subdir || name.id === null) continue;
    const lang = dirEntries(res, name.offset).find((l) => !l.subdir);
    if (!lang) continue;
    const blob = dataBlob(res, lang.offset, resRva);
    if (blob) out.push({ id: name.id, blob });
  }
  return out;
}

/** GRPICONDIR：6 字节头 + 每个 14 字节条目 */
function parseGroup(blob) {
  if (!blob || blob.length < 6 || blob.readUInt16LE(2) !== 1) return [];
  const count = blob.readUInt16LE(4);
  const out = [];
  for (let i = 0; i < count; i++) {
    const p = 6 + i * 14;
    if (p + 14 > blob.length) break;
    const w = blob.readUInt8(p);
    const h = blob.readUInt8(p + 1);
    out.push({
      w: w === 0 ? 256 : w,
      h: h === 0 ? 256 : h,
      colors: blob.readUInt8(p + 2),
      planes: blob.readUInt16LE(p + 4),
      bits: blob.readUInt16LE(p + 6),
      id: blob.readUInt16LE(p + 12)
    });
  }
  return out;
}

/** 组装 .ico 容器（头 6 字节 + 16 字节/项 + 数据块） */
function buildIco(entries) {
  const header = Buffer.alloc(6 + entries.length * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  let cursor = header.length;
  entries.forEach((e, i) => {
    const p = 6 + i * 16;
    header.writeUInt8(e.w === 256 ? 0 : e.w, p);
    header.writeUInt8(e.h === 256 ? 0 : e.h, p + 1);
    header.writeUInt8(e.colors || 0, p + 2);
    header.writeUInt8(0, p + 3);
    header.writeUInt16LE(e.planes || 1, p + 4);
    header.writeUInt16LE(e.bits || 32, p + 6);
    header.writeUInt32LE(e.blob.length, p + 8);
    header.writeUInt32LE(cursor, p + 12);
    cursor += e.blob.length;
  });
  return Buffer.concat([header, ...entries.map((e) => e.blob)]);
}

/* ── DIB（BMP 条目）→ PNG ───────────────────────
 * RT_ICON 里多数条目是裸 DIB 而不是 PNG。虽然 <img> 能吃 ICO 容器，
 * 但手拼容器跨平台行为不好验证，这里直接转成 PNG：体积更小、渲染确定。
 */

let crcTable = null;
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** RGBA 像素 → PNG 字节 */
function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  return Buffer.concat([
    PNG_SIG,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

/**
 * 图标 DIB → PNG。
 * 只处理 24/32bpp（现代应用图标的基本形态）：16/8/4/1bpp 带调色板的老图标
 * 直接返回 null，由调用方退回 ICO 容器或内置图标，不硬啃冷门格式。
 */
function dibToPng(blob) {
  if (blob.length < 40) return null;
  const hdrSize = blob.readUInt32LE(0);
  const w = blob.readInt32LE(4);
  const rawH = blob.readInt32LE(8);
  const bpp = blob.readUInt16LE(14);
  const compression = blob.readUInt32LE(16);
  if (hdrSize < 40 || w <= 0 || rawH === 0) return null;
  if (bpp !== 32 && bpp !== 24) return null;
  if (compression !== 0 && compression !== 3) return null; // BI_RGB / BI_BITFIELDS

  // 图标 DIB 的高度是 XOR + AND 两张图的两倍
  const h = Math.abs(rawH) / 2;
  if (!Number.isInteger(h) || h <= 0) return null;

  const rowSize = bpp === 32 ? w * 4 : ((w * 24 + 31) >> 5) << 2;
  const dataOff = hdrSize + (compression === 3 ? 12 : 0);
  if (dataOff + rowSize * h > blob.length) return null;

  const bottomUp = rawH > 0;
  const rgba = Buffer.alloc(w * h * 4);
  let anyAlpha = false;

  for (let y = 0; y < h; y++) {
    const srcRow = dataOff + (bottomUp ? h - 1 - y : y) * rowSize;
    const dstRow = y * w * 4;
    for (let x = 0; x < w; x++) {
      const s = srcRow + x * (bpp === 32 ? 4 : 3);
      const d = dstRow + x * 4;
      rgba[d] = blob[s + 2]; // R
      rgba[d + 1] = blob[s + 1]; // G
      rgba[d + 2] = blob[s]; // B
      const a = bpp === 32 ? blob[s + 3] : 255;
      if (a) anyAlpha = true;
      rgba[d + 3] = a;
    }
  }

  // 老图标常见 32bpp 但 alpha 全 0（靠 AND 掩码做透明），这时按不透明处理
  if (!anyAlpha) {
    for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
  }

  return encodePng(w, h, rgba);
}

/**
 * 选图标：
 *   1. 有 PNG 条目优先（Electron 系 app 的 256px 图标常是 PNG），取不小于 32px 的最小一个；
 *   2. 否则把 32px 起的 DIB 转成 PNG，取能转成功的第一个尺寸；
 *   3. 仍然失败就把较大的条目包成 ICO（Chromium 也能渲染），实在没有再返回 null。
 */
function pickIcon(res, resRva) {
  const iconMap = new Map(blobsOfType(res, resRva, RT_ICON).map((b) => [b.id, b.blob]));
  const groups = blobsOfType(res, resRva, RT_GROUP_ICON);

  const all = [];
  const seen = new Set();
  for (const g of groups) {
    for (const e of parseGroup(g.blob)) {
      const blob = iconMap.get(e.id);
      if (!blob) continue;
      const key = e.w + 'x' + e.h + '-' + e.bits;
      if (seen.has(key)) continue;
      seen.add(key);
      all.push({ ...e, blob });
    }
  }
  if (!all.length) return null;
  all.sort((a, b) => a.w - b.w);

  // 按尺寸从小到大扫：优先 48px 起（14px 图标在 2x/3x 屏上要 28~42 物理像素），
  // 没有更大的就退回最大的一档。实测 6 个 IDE 全部落在 48~64px、合计约 12KB。
  const usable = all.filter((e) => e.w >= 48);
  for (const e of usable.length ? usable : [all[all.length - 1]]) {
    if (e.blob.subarray(0, 8).equals(PNG_SIG)) {
      return { dataUrl: 'data:image/png;base64,' + e.blob.toString('base64'), size: e.w };
    }
    const converted = dibToPng(e.blob);
    if (converted) {
      return { dataUrl: 'data:image/png;base64,' + converted.toString('base64'), size: e.w };
    }
  }

  // 兜底：32~48px 的条目包成 ICO，避免带 256px BMP 把体积撑到几百 KB
  const small = all.filter((e) => e.w >= 32 && e.w <= 48);
  const pack = (small.length ? small : [all[all.length - 1]]).slice(0, 2);
  return { dataUrl: 'data:image/x-icon;base64,' + buildIco(pack).toString('base64'), size: pack[0].w };
}

/** 抽取单个 exe 的图标；失败一律返回 null（界面侧退回内置代码图标） */
function extract(exePath) {
  let fd = null;
  try {
    const stat = fs.statSync(exePath);
    if (!stat.isFile() || stat.size < HEADER_BYTES) return null;

    fd = fs.openSync(exePath, 'r');
    const pe = parsePe(readAt(fd, 0, HEADER_BYTES));
    if (!pe) return null;

    const res = readAt(fd, pe.res.offset, Math.min(pe.res.size, MAX_RES_BYTES));
    return pickIcon(res, pe.res.rva);
  } catch (_) {
    return null;
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch (_) {}
    }
  }
}

/** 带缓存的图标获取（同一 exe 只解析一次） */
function get(exePath) {
  const key = String(exePath || '');
  if (!key) return null;
  if (cache.has(key)) return cache.get(key);
  const result = process.platform === 'win32' ? extract(key) : null;
  cache.set(key, result);
  return result;
}

module.exports = { get, extract };

'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Android 项目识别与启动图标提取。
 *
 * 只读项目根目录（或一级模块目录）下的 src/main：
 *   - AndroidManifest.xml 定位模块与 android:icon；
 *   - 按资源引用在 res/mipmap-* / drawable-* 中找位图，位图优先；
 *   - 只有 XML 时支持 VectorDrawable 转 SVG（自适应图标取其 foreground）。
 * 不解析 aapt、不执行 Gradle：资源目录就是磁盘上的最终形态。
 */

const DENSITIES = ['xxxhdpi', 'xxhdpi', 'xhdpi', 'hdpi', 'mdpi', 'ldpi'];
const RASTER_MIME = { '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };
const RASTER_EXTS = Object.keys(RASTER_MIME);
const MAX_ICON_BYTES = 2 * 1024 * 1024;
const MAX_XML_BYTES = 512 * 1024;

/** path → { sig, result }：图标只在打开应用后取一次，缓存到进程结束 */
const cache = new Map();

function isFile(file) {
  try {
    return fs.statSync(file).isFile();
  } catch (_) {
    return false;
  }
}

function fileSig(file) {
  try {
    const s = fs.statSync(file);
    return s.mtimeMs + ':' + s.size;
  } catch (_) {
    return '';
  }
}

function readText(file) {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > MAX_XML_BYTES) return '';
    return fs.readFileSync(file, 'utf8');
  } catch (_) {
    return '';
  }
}

function attr(tag, name) {
  const m = new RegExp('android:' + name + '\\s*=\\s*"([^"]*)"').exec(tag || '');
  return m ? m[1] : null;
}

/** 定位 Android 模块：根目录、根/src/main，或一级子模块（优先 app） */
function findAndroidModule(root) {
  const dir = String(root || '').trim();
  if (!dir) return null;

  const rootManifest = path.join(dir, 'AndroidManifest.xml');
  if (isFile(rootManifest)) {
    return { moduleDir: dir, resDir: path.join(dir, 'res'), manifestPath: rootManifest };
  }
  const rootMain = path.join(dir, 'src', 'main');
  const rootMainManifest = path.join(rootMain, 'AndroidManifest.xml');
  if (isFile(rootMainManifest)) {
    return { moduleDir: dir, resDir: path.join(rootMain, 'res'), manifestPath: rootMainManifest };
  }

  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return null;
  }

  const modules = [];
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'build' || e.name === 'node_modules') continue;
    const mainDir = path.join(dir, e.name, 'src', 'main');
    const manifestPath = path.join(mainDir, 'AndroidManifest.xml');
    if (isFile(manifestPath)) {
      modules.push({ moduleDir: path.join(dir, e.name), resDir: path.join(mainDir, 'res'), manifestPath });
    }
  }
  return modules.find((m) => path.basename(m.moduleDir).toLowerCase() === 'app') || modules[0] || null;
}

function parseResourceRef(ref) {
  const m = /^@(?:\+)?(mipmap|drawable)\/([A-Za-z0-9_.]+)$/.exec(String(ref || '').trim());
  return m ? { type: m[1], name: m[2] } : null;
}

/** 资源目录按清晰度排序：高密度位图优先，anydpi（自适应图标 XML）兜底 */
function resourceDirs(resDir, type) {
  let entries = [];
  try {
    entries = fs.readdirSync(resDir, { withFileTypes: true });
  } catch (_) {
    return [];
  }
  const dirs = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name === type) {
      dirs.push({ dir: e.name, score: 60 });
      continue;
    }
    if (!e.name.startsWith(type + '-')) continue;
    const suffix = e.name.slice(type.length + 1);
    const i = DENSITIES.findIndex((d) => suffix === d || suffix.startsWith(d + '-'));
    if (i >= 0) dirs.push({ dir: e.name, score: i });
    else if (suffix.startsWith('anydpi')) dirs.push({ dir: e.name, score: 90 });
    else dirs.push({ dir: e.name, score: 80 });
  }
  dirs.sort((a, b) => a.score - b.score);
  return dirs.map((d) => path.join(resDir, d.dir));
}

function findResourceFile(resDir, type, name) {
  for (const dir of resourceDirs(resDir, type)) {
    for (const ext of RASTER_EXTS.concat('.xml')) {
      const file = path.join(dir, name + ext);
      if (isFile(file)) return file;
    }
  }
  return null;
}

/** Android 颜色（含 #AARRGGBB）→ CSS 颜色；@color/x 去 values 里查 */
function cssColor(value) {
  const s = String(value || '').trim();
  if (!s.startsWith('#')) return null;
  const hex = s.slice(1);
  if (hex.length === 3) return '#' + hex.split('').map((c) => c + c).join('');
  if (hex.length === 6) return '#' + hex.toLowerCase();
  if (hex.length === 8) {
    const a = parseInt(hex.slice(0, 2), 16);
    const r = parseInt(hex.slice(2, 4), 16);
    const g = parseInt(hex.slice(4, 6), 16);
    const b = parseInt(hex.slice(6, 8), 16);
    if ([a, r, g, b].some((n) => !Number.isFinite(n))) return null;
    if (a === 255) return '#' + hex.slice(2).toLowerCase();
    return 'rgba(' + r + ',' + g + ',' + b + ',' + Number((a / 255).toFixed(3)) + ')';
  }
  return null;
}

function findColorResource(resDir, name) {
  let dirs = [];
  try {
    dirs = fs.readdirSync(resDir, { withFileTypes: true }).filter((e) => e.isDirectory() && e.name.startsWith('values'));
  } catch (_) {
    return null;
  }
  for (const d of dirs) {
    const file = path.join(resDir, d.name, 'colors.xml');
    const text = readText(file);
    if (!text) continue;
    const re = new RegExp('<color\\s+name="' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"[^>]*>([^<]+)</color>');
    const m = re.exec(text);
    if (m) return m[1].trim();
  }
  return null;
}

function resolveColor(value, resDir) {
  const s = String(value || '').trim();
  if (!s) return null;
  const direct = cssColor(s);
  if (direct) return direct;
  const framework = {
    '@android:color/black': '#000000',
    '@android:color/white': '#ffffff',
    '@android:color/transparent': 'rgba(0,0,0,0)'
  };
  if (framework[s]) return framework[s];
  const m = /^@color\/([A-Za-z0-9_.]+)$/.exec(s);
  return m ? cssColor(findColorResource(resDir, m[1])) : null;
}

function parseRgb(color) {
  const hex = /^#([0-9a-f]{6})$/i.exec(color);
  if (hex) {
    return [parseInt(hex[1].slice(0, 2), 16), parseInt(hex[1].slice(2, 4), 16), parseInt(hex[1].slice(4, 6), 16), 1];
  }
  const rgba = /^rgba?\((\d+),(\d+),(\d+)(?:,([\d.]+))?\)$/i.exec(color);
  if (!rgba) return null;
  return [Number(rgba[1]), Number(rgba[2]), Number(rgba[3]), rgba[4] === undefined ? 1 : Number(rgba[4])];
}

/** 纯黑/纯白图形记下来：深色界面里黑图标要反色，浅色界面里白图标同理 */
function monoOf(colors) {
  let dark = true;
  let light = true;
  let seen = false;
  for (const color of colors) {
    const rgb = parseRgb(color);
    if (!rgb || rgb[3] === 0) continue;
    seen = true;
    const [r, g, b] = rgb;
    if (Math.max(r, g, b) - Math.min(r, g, b) > 28) return null;
    const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    if (lum > 0.25) dark = false;
    if (lum < 0.75) light = false;
  }
  if (!seen) return null;
  return dark ? 'dark' : light ? 'light' : null;
}

function escAttr(v) {
  return String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function numberAttr(tag, name, fallback) {
  const raw = attr(tag, name);
  const n = raw === null ? NaN : Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function groupTransform(tag) {
  const parts = [];
  const tx = numberAttr(tag, 'translateX', 0);
  const ty = numberAttr(tag, 'translateY', 0);
  if (tx || ty) parts.push('translate(' + tx + ' ' + ty + ')');
  const rotation = numberAttr(tag, 'rotation', 0);
  if (rotation) {
    parts.push('rotate(' + rotation + ' ' + numberAttr(tag, 'pivotX', 0) + ' ' + numberAttr(tag, 'pivotY', 0) + ')');
  }
  const sx = numberAttr(tag, 'scaleX', 1);
  const sy = numberAttr(tag, 'scaleY', 1);
  if (sx !== 1 || sy !== 1) parts.push('scale(' + sx + ' ' + sy + ')');
  return parts.join(' ');
}

function pathSvg(tag, resDir, colors) {
  const d = attr(tag, 'pathData');
  if (!d) return null;
  const fill = resolveColor(attr(tag, 'fillColor'), resDir);
  const stroke = resolveColor(attr(tag, 'strokeColor'), resDir);
  if (!fill && !stroke) return null;

  const out = ['d="' + escAttr(d) + '"'];
  if (fill) {
    out.push('fill="' + fill + '"');
    colors.push(fill);
    const alpha = numberAttr(tag, 'fillAlpha', NaN);
    if (Number.isFinite(alpha)) out.push('fill-opacity="' + alpha + '"');
  } else {
    out.push('fill="none"');
  }
  if (stroke) {
    out.push('stroke="' + stroke + '"');
    out.push('stroke-width="' + numberAttr(tag, 'strokeWidth', 1) + '"');
    colors.push(stroke);
    const alpha = numberAttr(tag, 'strokeAlpha', NaN);
    if (Number.isFinite(alpha)) out.push('stroke-opacity="' + alpha + '"');
    const cap = attr(tag, 'strokeLineCap');
    if (cap) out.push('stroke-linecap="' + cap.toLowerCase() + '"');
    const join = attr(tag, 'strokeLineJoin');
    if (join) out.push('stroke-linejoin="' + join.toLowerCase() + '"');
  }
  if (String(attr(tag, 'fillType') || '').toLowerCase() === 'evenodd') out.push('fill-rule="evenodd"');
  return '<path ' + out.join(' ') + '/>';
}

/** VectorDrawable → SVG。忽略 clip-path；group 的平移/旋转/缩放折算成 transform */
function vectorToSvg(xml, resDir) {
  const vector = /<vector\b[^>]*>/.exec(xml);
  if (!vector) return null;
  const vpW = numberAttr(vector[0], 'viewportWidth', 0);
  const vpH = numberAttr(vector[0], 'viewportHeight', 0);
  if (!vpW || !vpH) return null;

  const groups = [];
  const parts = [];
  const colors = [];
  const re = /<(\/?)(group|path)\b([^>]*)>/g;
  let m;
  while ((m = re.exec(xml))) {
    const closing = m[1] === '/';
    const tag = m[2];
    if (tag === 'group') {
      if (closing) groups.pop();
      else groups.push(groupTransform(m[3]));
      continue;
    }
    const path = pathSvg(m[3], resDir, colors);
    if (!path) continue;
    const transform = groups.filter(Boolean).join(' ');
    parts.push(transform ? '<g transform="' + escAttr(transform) + '">' + path + '</g>' : path);
  }
  if (!parts.length) return null;

  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="' +
    vpW +
    '" height="' +
    vpH +
    '" viewBox="0 0 ' +
    vpW +
    ' ' +
    vpH +
    '" preserveAspectRatio="xMidYMid meet">' +
    parts.join('') +
    '</svg>';
  return { icon: 'data:image/svg+xml;base64,' + Buffer.from(svg, 'utf8').toString('base64'), mono: monoOf(colors) };
}

function iconFromFile(file, resDir, depth) {
  const ext = path.extname(file).toLowerCase();
  const mime = RASTER_MIME[ext];
  if (mime) {
    try {
      const stat = fs.statSync(file);
      if (!stat.isFile() || stat.size > MAX_ICON_BYTES) return null;
      return { icon: 'data:' + mime + ';base64,' + fs.readFileSync(file).toString('base64'), mono: null };
    } catch (_) {
      return null;
    }
  }
  if (ext !== '.xml' || depth > 2) return null;

  const xml = readText(file);
  if (!xml) return null;
  if (/<vector\b/.test(xml)) return vectorToSvg(xml, resDir);

  // 自适应图标：只取前景，背景保持透明（前景本身通常已带安全边距）
  if (/<adaptive-icon\b/.test(xml)) {
    const fg = /<foreground\b[^>]*>/.exec(xml);
    const ref = fg ? attr(fg[0], 'drawable') : null;
    const parsed = parseResourceRef(ref);
    if (!parsed) return null;
    const child = findResourceFile(resDir, parsed.type, parsed.name);
    return child ? iconFromFile(child, resDir, depth + 1) : null;
  }
  return null;
}

function readIcon(mod) {
  const manifest = readText(mod.manifestPath);
  const app = /<application\b[^>]*>/.exec(manifest);
  const ref = app ? attr(app[0], 'icon') || attr(app[0], 'roundIcon') : null;
  const parsed = parseResourceRef(ref);

  let file = parsed ? findResourceFile(mod.resDir, parsed.type, parsed.name) : null;
  if (!file) file = findResourceFile(mod.resDir, 'mipmap', 'ic_launcher');
  if (!file) file = findResourceFile(mod.resDir, 'drawable', 'ic_launcher');
  return file ? iconFromFile(file, mod.resDir, 0) : null;
}

/**
 * @param {string} root 项目根目录
 * @returns {{ icon: string, mono: 'dark'|'light'|null } | null} dataURL 图标；非 Android 或无图标返回 null
 */
function getIcon(root) {
  const dir = String(root || '').trim();
  if (!dir) return null;
  const mod = findAndroidModule(dir);
  if (!mod) return null;

  const sig = fileSig(mod.manifestPath) + '|' + fileSig(mod.resDir);
  const hit = cache.get(dir);
  if (hit && hit.sig === sig) return hit.result;

  const result = readIcon(mod);
  cache.set(dir, { sig, result });
  return result;
}

module.exports = { findAndroidModule, getIcon };

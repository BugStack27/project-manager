'use strict';

/**
 * 暗色对比度审计：把 theme-dark.css 里的变量解析出来，按「用途 → 最低要求」逐对算 WCAG 2.1 比值。
 *
 * 只读 CSS 文本、不引依赖、不进运行时 —— 它是验收工具，不是测试。
 * 用法：node scripts/theme-audit.js   （任一硬性项不过则退出码 1）
 *
 * 判据来源与取舍见 doc/theme-and-identity-colors.md：
 *   正文 7:1（AAA）· 次要文字/语义文字 4.5:1 · 图标与焦点环 3:1
 *   --edge 静止态边框只做到 ~2.5:1 是有意取舍（推到 3:1 会亮成一道刺眼白线），因此只 WARN。
 */

const fs = require('fs');
const path = require('path');

const STYLES = path.join(__dirname, '..', 'web', 'src', 'styles');

function readVars(file) {
  const text = fs.readFileSync(path.join(STYLES, file), 'utf8');
  const map = {};
  const re = /(--[a-z0-9-]+)\s*:\s*([^;]+);/gi;
  let m;
  while ((m = re.exec(text))) map[m[1]] = m[2].trim();
  return map;
}

/** 变量可能引用别的变量：递归解析到字面值，最多 8 层防环 */
function resolve(map, fallback, name, depth) {
  const d = depth || 0;
  if (d > 8) throw new Error('变量引用过深或成环：' + name);
  const raw = map[name] !== undefined ? map[name] : fallback[name];
  if (raw === undefined) throw new Error('找不到变量：' + name);
  const ref = raw.match(/^var\((--[a-z0-9-]+)\)$/i);
  if (ref) return resolve(map, fallback, ref[1], d + 1);
  return raw;
}

function hexToRgb(hex) {
  let h = hex.replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length !== 6) throw new Error('不是可识别的十六进制颜色：' + hex);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

/** rgba(255,255,255,.26) 这类半透明前景：先合成到底色上，再算对比度 */
function parseColor(value, under) {
  const v = value.trim();
  if (v.startsWith('#')) return hexToRgb(v);
  const m = v.match(/rgba?\(([^)]+)\)/i);
  if (!m) throw new Error('不支持的色值：' + v);
  const parts = m[1].split(',').map((x) => parseFloat(x.trim()));
  const [r, g, b] = parts;
  const a = parts.length > 3 ? parts[3] : 1;
  if (a >= 1) return [r, g, b];
  if (!under) throw new Error('半透明前景缺少底色：' + v);
  return [0, 1, 2].map((i) => Math.round(parts[i] * a + under[i] * (1 - a)));
}

function luminance(rgb) {
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** [前景, 背景, 最低比值, 说明, 是否硬性] */
const PAIRS = [
  ['--label', '--bg', 7, '正文', true],
  ['--label', '--card', 7, '卡片正文', true],
  ['--label-2', '--bg', 4.5, '次要文字', true],
  ['--label-2', '--card', 4.5, '卡片次要文字', true],
  ['--label-3', '--bg', 4.5, '辅助文字', true],
  ['--label-4', '--bg', 4.5, '提示/行号', true],
  ['--blue', '--bg', 4.5, '链接/进行中', true],
  ['--green-text', '--bg', 4.5, '成功语义', true],
  ['--orange-text', '--bg', 4.5, '警告语义', true],
  ['--red-text', '--bg', 4.5, '错误语义', true],
  ['--teal-text', '--bg', 4.5, '认领语义', true],
  ['--indigo', '--bg', 4.5, 'AI 来源', true],
  ['--hl-keyword', '--ansi-default-bg', 4.5, '代码高亮 · 关键字', true],
  ['--hl-string', '--ansi-default-bg', 4.5, '代码高亮 · 字符串', true],
  ['--hl-number', '--ansi-default-bg', 4.5, '代码高亮 · 数字', true],
  ['--hl-comment', '--ansi-default-bg', 4.5, '代码高亮 · 注释', true],
  ['--hl-title', '--ansi-default-bg', 4.5, '代码高亮 · 标题', true],
  ['--hl-type', '--ansi-default-bg', 4.5, '代码高亮 · 类型', true],
  ['--hl-attr', '--ansi-default-bg', 4.5, '代码高亮 · 属性', true],
  ['--hl-meta', '--ansi-default-bg', 4.5, '代码高亮 · 元信息', true],
  ['--edge', '--card', 3, '控件静止边框（已知取舍）', false],
  ['--edge-strong', '--card', 3, '控件悬停边框', true]
];

function main() {
  const dark = readVars('theme-dark.css');
  const light = readVars('tokens.css');

  let failed = 0;
  const rows = PAIRS.map(([fgName, bgName, min, label, hard]) => {
    const bgRaw = resolve(dark, light, bgName);
    const bg = parseColor(bgRaw, parseColor(resolve(dark, light, '--bg')));
    const fg = parseColor(resolve(dark, light, fgName), bg);
    const ratio = contrast(fg, bg);
    const ok = ratio >= min;
    if (!ok && hard) failed += 1;
    return { label, fgName, bgName, min, ratio, ok, hard };
  });

  const pad = (s, n) => String(s).padEnd(n, ' ');
  console.log(pad('用途', 20) + pad('前景', 18) + pad('背景', 20) + pad('比值', 9) + '判定');
  console.log('-'.repeat(78));
  rows.forEach((r) => {
    const verdict = r.ok ? 'PASS' : r.hard ? 'FAIL' : 'WARN';
    console.log(
      pad(r.label, 20) +
        pad(r.fgName, 18) +
        pad(r.bgName, 20) +
        pad(r.ratio.toFixed(2) + ':1', 9) +
        verdict
    );
  });

  console.log('-'.repeat(78));
  console.log(failed === 0 ? '全部硬性项通过' : failed + ' 项未通过');
  process.exit(failed === 0 ? 0 : 1);
}

main();

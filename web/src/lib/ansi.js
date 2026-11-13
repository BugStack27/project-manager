/* ANSI SGR 解析：把一行日志拆成「可见文本 + 样式分段」。非 SGR 的控制序列直接丢弃。 */

/** SGR 开关属性：解析状态、分段样式与渲染类名（ansi-<属性>）共用这一份清单 */
export const STYLE_ATTRS = ['bold', 'dim', 'italic', 'underline', 'strike'];

const COLOR_NAMES = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'bright-black',
  'bright-red',
  'bright-green',
  'bright-yellow',
  'bright-blue',
  'bright-magenta',
  'bright-cyan',
  'bright-white'
];

/* 16 色 → 浅色主题调色板变量（见 tokens.css） */
const FG_COLORS = COLOR_NAMES.map((name) => 'var(--ansi-fg-' + name + ')');
const BG_COLORS = COLOR_NAMES.map((name) => 'var(--ansi-bg-' + name + ')');
const DEFAULT_FG = 'var(--ansi-default-fg)';
const DEFAULT_BG = 'var(--ansi-default-bg)';

const CUBE = [0, 95, 135, 175, 215, 255];

function emptyStyle() {
  /* inverse 只在解析期参与前后景交换，不进入分段样式 */
  const style = { fg: null, bg: null, inverse: false };
  STYLE_ATTRS.forEach((k) => {
    style[k] = false;
  });
  return style;
}

function color256(n, isBg) {
  const palette = isBg ? BG_COLORS : FG_COLORS;
  if (n < 16) return palette[n];
  if (n < 232) {
    const i = n - 16;
    const r = CUBE[Math.floor(i / 36)];
    const g = CUBE[Math.floor((i % 36) / 6)];
    const b = CUBE[i % 6];
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }
  const v = 8 + (n - 232) * 10;
  return 'rgb(' + v + ',' + v + ',' + v + ')';
}

function num(v) {
  return v === '' || v === undefined ? 0 : Number(v);
}

function applyExtended(state, target, mode, values) {
  if (mode === 5) {
    if (values[0] === undefined) return;
    const i = num(values[0]);
    if (Number.isInteger(i) && i >= 0 && i <= 255) state[target] = color256(i, target === 'bg');
    return;
  }
  if (mode !== 2) return;
  let at = values.length >= 4 || values[0] === '' ? 1 : 0;
  if (values[at] === undefined || values[at + 1] === undefined || values[at + 2] === undefined) return;
  const r = num(values[at]);
  const g = num(values[at + 1]);
  const b = num(values[at + 2]);
  if ([r, g, b].every((v) => Number.isInteger(v) && v >= 0 && v <= 255)) {
    state[target] = 'rgb(' + r + ',' + g + ',' + b + ')';
  }
}

/** 冒号写法：38:2::r:g:b / 38:5:n；颜色分支之外的内容忽略 */
function applyColonGroup(state, parts) {
  const kind = num(parts[0]);
  if (kind !== 38 && kind !== 48) return;
  applyExtended(state, kind === 38 ? 'fg' : 'bg', num(parts[1]), parts.slice(2));
}

function applySgr(state, raw) {
  const groups = raw === '' ? [0] : raw.split(';').map((p) => (p.includes(':') ? p.split(':') : p));
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    if (Array.isArray(g)) {
      applyColonGroup(state, g);
      continue;
    }
    const n = num(g);
    if (n === 38 || n === 48) {
      /* 分号写法与冒号写法同构：38;5;n ≡ 38:5:n，38;2;r;g;b ≡ 38:2::r;g;b；剩余参数个数含可选的 color-space 空值 */
      const mode = num(groups[i + 1]);
      const rest = mode === 5 ? 2 : mode === 2 ? 4 + (groups[i + 2] === '' ? 1 : 0) : 0;
      applyColonGroup(state, [g].concat(groups.slice(i + 1, i + 1 + rest)));
      i += rest;
      continue;
    }
    if (n === 0) state = emptyStyle();
    else if (n === 1) state.bold = true;
    else if (n === 2) state.dim = true;
    else if (n === 3) state.italic = true;
    else if (n === 4) state.underline = true;
    else if (n === 7) state.inverse = true;
    else if (n === 9) state.strike = true;
    else if (n === 22) state.bold = state.dim = false;
    else if (n === 23) state.italic = false;
    else if (n === 24) state.underline = false;
    else if (n === 27) state.inverse = false;
    else if (n === 29) state.strike = false;
    else if (n >= 30 && n <= 37) state.fg = FG_COLORS[n - 30];
    else if (n === 39) state.fg = null;
    else if (n >= 40 && n <= 47) state.bg = BG_COLORS[n - 40];
    else if (n === 49) state.bg = null;
    else if (n >= 90 && n <= 97) state.fg = FG_COLORS[n - 82];
    else if (n >= 100 && n <= 107) state.bg = BG_COLORS[n - 92];
  }
  return state;
}

function segmentStyle(state) {
  /* 反色：交换前后景，缺省一侧用默认色兜底 */
  const fg = state.inverse ? state.bg || DEFAULT_BG : state.fg;
  const bg = state.inverse ? state.fg || DEFAULT_FG : state.bg;
  const style = { fg, bg };
  STYLE_ATTRS.forEach((k) => {
    style[k] = state[k];
  });
  return style;
}

const STYLE_KEYS = ['fg', 'bg'].concat(STYLE_ATTRS);

function sameStyle(a, b) {
  return STYLE_KEYS.every((k) => a[k] === b[k]);
}

function pushText(segments, text, state) {
  if (!text) return;
  const style = segmentStyle(state);
  const last = segments[segments.length - 1];
  if (last && sameStyle(last, style)) {
    last.text += text;
    return;
  }
  segments.push({ text, ...style });
}

/** OSC / DCS / APC / SOS / PM 等字符串型序列：跳到 BEL 或 ST */
function skipString(src, i) {
  let j = i + 2;
  while (j < src.length) {
    if (src[j] === '\x07') return j + 1;
    if (src[j] === '\x1b' && src[j + 1] === '\\') return j + 2;
    j += 1;
  }
  return j;
}

export function parseAnsi(input) {
  const src = String(input == null ? '' : input);
  const segments = [];
  let state = emptyStyle();
  let buf = '';
  let i = 0;

  while (i < src.length) {
    const ch = src[i];
    if (ch === '\x1b') {
      const next = src[i + 1];
      if (next === '[') {
        let j = i + 2;
        while (j < src.length && !(src.charCodeAt(j) >= 0x40 && src.charCodeAt(j) <= 0x7e)) j++;
        if (j >= src.length) break;
        const final = src[j];
        if (final === 'm') {
          pushText(segments, buf, state);
          buf = '';
          state = applySgr(state, src.slice(i + 2, j));
        }
        i = j + 1;
        continue;
      }
      if (next === ']' || next === 'P' || next === 'X' || next === '^' || next === '_') {
        i = skipString(src, i);
        continue;
      }
      if (next === '(' || next === ')' || next === '*' || next === '+') {
        i += 3;
        continue;
      }
      i += 2;
      continue;
    }
    const code = src.charCodeAt(i);
    if (code < 0x20) {
      if (ch === '\t') buf += ch;
      i += 1;
      continue;
    }
    if (code === 0x7f) {
      i += 1;
      continue;
    }
    buf += ch;
    i += 1;
  }

  pushText(segments, buf, state);
  return { text: segments.map((s) => s.text).join(''), segments };
}

/* 日志里的 http/https 链接识别：返回 [{ at, len, url }]，供渲染层包成可点击的 <a>。 */

const URL_RE = /https?:\/\/[^\s<>"'`，。；：！？、（）【】《》「」『』｛｝]+/gi;
const TRAILING = /[.,;:!?。，；：！？、'"`]/;
const CLOSERS = { ')': '(', ']': '[', '}': '{' };

function trimUrl(url) {
  let s = url;
  while (s.length) {
    const last = s[s.length - 1];
    if (TRAILING.test(last)) {
      s = s.slice(0, -1);
      continue;
    }
    const open = CLOSERS[last];
    if (open) {
      let depth = 0;
      for (const ch of s) {
        if (ch === open) depth += 1;
        else if (ch === last) depth -= 1;
      }
      if (depth < 0) {
        s = s.slice(0, -1);
        continue;
      }
    }
    break;
  }
  return s;
}

/** 只认 http/https：与主进程 openExternalSafely 的放行范围一致 */
export function findUrls(text) {
  const src = String(text == null ? '' : text);
  const out = [];
  URL_RE.lastIndex = 0;
  let m;
  while ((m = URL_RE.exec(src))) {
    const url = trimUrl(m[0]);
    if (!/^https?:\/\/./i.test(url)) continue;
    out.push({ at: m.index, len: url.length, url });
  }
  return out;
}

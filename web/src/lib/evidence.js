/* 备注里的证据坐标解析：纯函数、无 React 依赖，可单独用 node 执行冒烟。
 *
 * 约定的 note 形态（由 prompts/scout.md 约束 AI 巡检产出，人工备注不适用）：
 *   AI 巡检 2026-10-26 · 证据：A src/a.js:12-18, B-对照 web/x.jsx:80
 *
 * 解析只做「认得出就认」，绝不猜：认不出路径的片段原样留成纯文本，
 * 连「· 证据：」这个头都找不到就整条判为不可解析，调用方退回纯文本渲染。
 * 依据是库里 53 条 AI 需求里 43 条是空串或人工附注，宽松兜底只会把
 * 「人工复核：……:80」这类备注误渲染成文件坐标。
 */

/** 证据区起点：允许全/半角冒号，前后空白可有可无 */
const HEAD_RE = /·\s*证据[：:]\s*/;

/** 类别标签：A / C / B-对照 这类，后面必须跟空白 */
const KIND_RE = /^(A|C|B-[^\s:]{1,8})\s+/;

/** 路径:行号（行号可带区间）。前缀允许为空，表示沿用上一段的路径（见过 ExcelExporter.kt:49, :52-55 这种写法） */
const LOC_RE = /^(.*?):(\d+)(?:\s*-\s*(\d+))?$/;

/**
 * 是不是可以交给主进程去读的项目内相对路径。
 * 与 electron/services/git.js 的 assertRelPath 同口径：非绝对、不含 `..`；
 * 额外拦两类会被 LOC_RE 误认成「路径 + 行号」的输入：
 * - 带协议的串（`http://x:8080`）
 * - 中文标点/引号拼出来的伪路径（`a.js:120、b.js:40` 取最后一段会得到 `a.js:120、b.js`）
 */
function isLocalPath(p) {
  if (!p) return false;
  if (p.includes('://')) return false;
  if (/^[\\/]/.test(p)) return false;
  if (/^[a-zA-Z]:[\\/]/.test(p)) return false;
  if (/[、，；`'"\u201c\u201d]/.test(p)) return false;
  return !p.split(/[\\/]/).includes('..');
}

/**
 * 解析一条备注。
 * @returns {{ok: false} | {ok: true, head: string, items: Array<object>}}
 *   items 每项：
 *   - `{ type:'loc', kind, path, from, to }` 可悬停预览的文件坐标
 *   - `{ type:'text', kind, text }` 原样展示的片段（C 类流程节点、认不出的写法）
 */
export function parseNote(note) {
  const raw = String(note || '').trim();
  const m = HEAD_RE.exec(raw);
  if (!m) return { ok: false };

  const head = raw.slice(0, m.index).trim();
  const tail = raw.slice(m.index + m[0].length).trim();
  if (!tail) return { ok: false };

  const items = [];
  /** 当前证据类别：只在段首出现，后续段继承 */
  let kind = null;
  /** 当前路径：供 `:52-55` 这类省略写法复用 */
  let path = null;
  let resolved = 0;

  for (const rawSeg of tail.split(',')) {
    const seg = rawSeg.trim();
    if (!seg) continue;

    let body = seg;
    const km = KIND_RE.exec(body);
    if (km) {
      kind = km[1];
      body = body.slice(km[0].length).trim();
    }

    // `A 类 src/a.js:120`：剥掉类别后还剩一个「类」字。
    // 这类混写不能当成路径（会去读一个叫「类 src/a.js」的文件），整段判死。
    if (/^类/.test(body)) {
      items.push({ type: 'text', kind, text: seg });
      continue;
    }

    const lm = LOC_RE.exec(body);
    if (lm) {
      const own = lm[1].trim();
      const p = own || path;
      if (isLocalPath(p)) {
        path = p;
        const from = Number(lm[2]);
        const to = lm[3] ? Number(lm[3]) : from;
        items.push({ type: 'loc', kind, path: p, from, to });
        resolved++;
        continue;
      }
    }

    items.push({ type: 'text', kind, text: seg });
  }

  // 一段坐标都没认出来 = 这条备注不是给机器看的，交给调用方按纯文本渲染
  if (!resolved) return { ok: false };
  return { ok: true, head, items };
}

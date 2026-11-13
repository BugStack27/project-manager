/** 统计页的日期窗口与聚合：日期统一用本地自然日 YYYY-MM-DD，可直接字符串比较。 */

const pad = (n) => String(n).padStart(2, '0');
const monthStart = (today) => today.slice(0, 8) + '01';
const KEYS = ['commits', 'added', 'removed', 'done', 'rejected'];

export function localDate(d = new Date()) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

export function shiftDay(date, offset) {
  const [y, m, d] = date.split('-').map(Number);
  return localDate(new Date(y, m - 1, d + offset));
}

/** 一次取回覆盖三档范围的数据：月初可能比最近 30 天更早 */
export function statsWindow(today = localDate()) {
  const first = monthStart(today);
  const monthAgo = shiftDay(today, -29);
  return { since: first < monthAgo ? first : monthAgo, until: today };
}

export function rangeStart(range, today = localDate()) {
  if (range === '7') return shiftDay(today, -6);
  if (range === '30') return shiftDay(today, -29);
  return monthStart(today);
}

const EMPTY = { commits: 0, added: 0, removed: 0, done: 0, rejected: 0 };

function addCounts(target, src) {
  for (const k of KEYS) target[k] += src[k] || 0;
}

export function sumDays(days) {
  const out = { ...EMPTY };
  for (const d of days) addCounts(out, d);
  out.processed = out.done + out.rejected;
  return out;
}

/** 选中项目按日合并；后端已逐日补零，这里只做跨项目求和 */
export function mergeDays(projects, start) {
  const byDate = new Map();
  for (const p of projects) {
    for (const d of p.days) {
      if (d.date < start) continue;
      let row = byDate.get(d.date);
      if (!row) {
        row = { date: d.date, ...EMPTY };
        byDate.set(d.date, row);
      }
      addCounts(row, d);
    }
  }
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

export function projectRows(projects, start) {
  return projects.map((p) => ({
    id: p.id,
    name: p.name,
    branch: p.branch,
    isRepo: p.isRepo,
    error: p.error,
    truncated: p.truncated,
    ...sumDays(p.days.filter((d) => d.date >= start))
  }));
}

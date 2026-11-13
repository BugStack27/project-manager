'use strict';

const nowIso = () => new Date().toISOString();

const pad2 = (n) => String(n).padStart(2, '0');

/** 本地自然日：提交时间与需求更新时间都按本机时区归日 */
function localDay(iso) {
  const d = new Date(iso);
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

/** since..until 的连续日期（含两端），用于把稀疏统计补成完整横轴 */
function listDays(since, until) {
  const [y, m, d] = since.split('-').map(Number);
  const cur = new Date(y, m - 1, d);
  const out = [];
  for (;;) {
    const day = localDay(cur);
    out.push(day);
    if (day >= until) return out;
    cur.setDate(cur.getDate() + 1);
  }
}

module.exports = { nowIso, localDay, listDays };

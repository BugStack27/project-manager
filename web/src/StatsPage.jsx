import { useState } from 'react';
import { IC } from './icons.jsx';
import { Empty } from './ui.jsx';
import { mergeDays, projectRows, rangeStart, sumDays } from './lib/stats-view.js';

const RANGES = [
  { key: '7', label: '最近 7 天' },
  { key: '30', label: '最近 30 天' },
  { key: 'month', label: '本月' }
];

const COLUMNS = [
  { key: 'commits', label: '提交次数' },
  { key: 'added', label: '新增行数', tone: 'green' },
  { key: 'removed', label: '删除行数', tone: 'red' },
  { key: 'processed', label: '已处理' },
  { key: 'done', label: '已完成' },
  { key: 'rejected', label: '已拒绝' }
];

const nf = (n) => n.toLocaleString('en-US');
const shortDate = (date) => date.slice(5).replace('-', '/');

/** 取「好看」的坐标上限：1 / 2 / 5 × 10^n */
function niceMax(v) {
  if (v <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

function signed(key, value) {
  if (!value) return '0';
  return (key === 'added' ? '+' : key === 'removed' ? '−' : '') + nf(value);
}

/** 柱形：高度为 0 视为当天无数据；删除柱与基线留 2px 间隙，再由调用方补最小可见高度 */
function Bar({ x, width, y, height, fill, opacity }) {
  if (!height) return null;
  return <rect x={x} y={y} width={width} height={height} rx="2" fill={fill} opacity={opacity} />;
}

function DailyChart({ days, mode, selected, onSelect }) {
  const isReq = mode === 'req';
  const isCode = mode === 'code';
  const width = isReq ? 380 : 600;
  const left = 44;
  const right = width - 14;
  const top = 16;
  const bottom = 184;
  const step = (right - left) / days.length;
  const barWidth = Math.min(isReq ? 24 : 27, step * 0.48);
  const maxPos = Math.max(1, ...days.map((d) => (isReq ? d.done + d.rejected : isCode ? d.added : d.commits)));
  const maxNeg = isCode ? Math.max(1, ...days.map((d) => d.removed)) : 0;
  const posMax = niceMax(maxPos);
  const negMax = maxNeg ? niceMax(maxNeg) : 0;
  const unit = (bottom - top) / (posMax + negMax);
  const baseline = isCode ? top + posMax * unit : bottom;
  const ticks = posMax < 4 ? [0, posMax] : [0, posMax / 2, posMax];
  const active = days.find((d) => d.date === selected) || null;
  const lastDate = days.length ? days[days.length - 1].date : null;
  const label = isCode ? '每日代码新增与删除行数' : isReq ? '每日完成和拒绝的需求数' : '每日提交次数';
  const gridLines = ticks.map((v) => ({ y: baseline - v * unit, label: nf(Math.round(v)), solid: v === 0 }));
  if (negMax) gridLines.push({ y: bottom, label: '−' + nf(negMax), solid: false });

  // SVG 子元素的 focusin 不经过 <g>，统一在根上按 data-date 取当天
  return (
    <div className="stat-chart-wrap">
      <svg
        className="stat-chart"
        viewBox={`0 0 ${width} 216`}
        role="group"
        aria-label={label}
        onMouseLeave={() => onSelect(null)}
        onFocus={(e) => {
          const date = e.target.getAttribute && e.target.getAttribute('data-date');
          if (date) onSelect(date);
        }}
        onBlur={() => onSelect(null)}
      >
        <title>{label}</title>
        {gridLines.map((g, i) => (
          <g key={i}>
            <line
              x1={left}
              x2={right}
              y1={g.y}
              y2={g.y}
              stroke="var(--sep-2)"
              strokeDasharray={g.solid ? undefined : '3 4'}
            />
            <text x={left - 10} y={g.y + 4} textAnchor="end" fill="var(--label-3)" fontSize="11">
              {g.label}
            </text>
          </g>
        ))}
        {days.map((d, i) => {
          const x = left + step * (i + 0.5);
          const barX = x - barWidth / 2;
          const dim = selected && selected !== d.date ? 0.45 : 1;
          const tip = isCode
            ? `${shortDate(d.date)}，新增 ${d.added} 行，删除 ${d.removed} 行`
            : isReq
              ? `${shortDate(d.date)}，完成 ${d.done}，拒绝 ${d.rejected}`
              : `${shortDate(d.date)}，提交 ${d.commits} 次`;
          const showLabel = days.length <= 7 || i === 0 || i === days.length - 1 || (i % 5 === 0 && i < days.length - 2);
          return (
            <g key={d.date}>
              <rect
                x={x - step / 2 + 1}
                y={top}
                width={step - 2}
                height={bottom - top}
                rx="3"
                fill={selected === d.date ? 'var(--blue-tint)' : 'transparent'}
              />
              {isCode ? (
                <>
                  <Bar
                    x={barX}
                    width={barWidth}
                    y={baseline - d.added * unit}
                    height={d.added * unit}
                    fill="var(--green)"
                    opacity={dim * 0.85}
                  />
                  <Bar
                    x={barX}
                    width={barWidth}
                    y={baseline + 2}
                    height={d.removed ? Math.max(1, d.removed * unit - 2) : 0}
                    fill="var(--red)"
                    opacity={dim * 0.6}
                  />
                </>
              ) : isReq ? (
                <>
                  <Bar
                    x={barX}
                    width={barWidth}
                    y={baseline - d.done * unit}
                    height={d.done * unit}
                    fill="var(--blue)"
                    opacity={dim * 0.85}
                  />
                  <Bar
                    x={barX}
                    width={barWidth}
                    y={baseline - (d.done + d.rejected) * unit}
                    height={d.rejected * unit}
                    fill="var(--label-4)"
                    opacity={dim}
                  />
                </>
              ) : (
                <Bar
                  x={barX}
                  width={barWidth}
                  y={baseline - d.commits * unit}
                  height={d.commits * unit}
                  fill="var(--blue)"
                  opacity={dim * 0.85}
                />
              )}
              {showLabel ? (
                <text
                  x={x}
                  y="207"
                  textAnchor="middle"
                  fill={d.date === lastDate ? 'var(--blue)' : 'var(--label-2)'}
                  fontSize="11"
                >
                  {shortDate(d.date)}
                  {d.date === lastDate && days.length <= 7 ? ' 今' : ''}
                </text>
              ) : null}
              {/* SVG 的 <g> 不能稳定获得焦点，用透明矩形承载键盘与指针交互 */}
              <rect
                x={x - step / 2 + 1}
                y={top}
                width={step - 2}
                height={bottom - top}
                fill="transparent"
                tabIndex={0}
                role="button"
                aria-label={tip}
                data-date={d.date}
                onMouseEnter={() => onSelect(d.date)}
                onClick={() => onSelect(d.date)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect(d.date);
                  }
                }}
              >
                <title>{tip}</title>
              </rect>
            </g>
          );
        })}
      </svg>
      <div className="stat-readout" aria-live="polite">
        {active ? (
          <>
            <span>{shortDate(active.date)}</span>
            {isCode ? (
              <>
                <b className="stat-green">+{nf(active.added)}</b>
                <b className="stat-red">−{nf(active.removed)}</b>
                <span>行</span>
              </>
            ) : isReq ? (
              <>
                <span>
                  完成 <b>{active.done}</b>
                </span>
                <span>
                  拒绝 <b>{active.rejected}</b>
                </span>
              </>
            ) : (
              <span>
                提交 <b>{active.commits}</b> 次
              </span>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}

export default function StatsPage({ data, loading, refreshing, error, onRefresh }) {
  const [range, setRange] = useState('7');
  const [project, setProject] = useState('all');
  const [chart, setChart] = useState('code');
  const [sort, setSort] = useState({ key: 'commits', desc: true });
  const [selDay, setSelDay] = useState(null);

  if (!data) {
    if (error) {
      return (
        <div className="wrap">
          <Empty title="统计失败" desc={error} icon={IC.alert}>
            <button className="btn sm" onClick={onRefresh}>
              重试
            </button>
          </Empty>
        </div>
      );
    }
    return (
      <div className="wrap">
        <div className="loading">
          <span className="spinner" />
          正在统计…
        </div>
      </div>
    );
  }

  const projects = data.projects || [];
  if (!projects.length) {
    return (
      <div className="wrap">
        <Empty title="还没有登记项目" desc="新建项目后，这里会统计提交与需求处理情况。" icon={IC.chart} />
      </div>
    );
  }

  const activeProject = project === 'all' || projects.some((p) => p.id === project) ? project : 'all';
  const scoped = projects.filter((p) => activeProject === 'all' || p.id === activeProject);
  const start = rangeStart(range);
  const days = mergeDays(scoped, start);
  const totals = sumDays(days);
  const rows = projectRows(scoped, start).sort((a, b) => (b[sort.key] - a[sort.key]) * (sort.desc ? 1 : -1));
  const net = totals.added - totals.removed;
  const title = activeProject === 'all' ? '全部项目' : scoped[0].name;
  const activeDays = days.filter((d) => d.commits > 0).length;
  const busiest = days.reduce((a, d) => (d.commits > a.commits ? d : a), { commits: 0, date: null });

  // 切范围 / 项目 / 图表后选中日都会失真，统一清空
  function resetDay() {
    setSelDay(null);
  }

  function selectRange(next) {
    setRange(next);
    resetDay();
  }

  function selectProject(next) {
    setProject(next);
    resetDay();
  }

  function selectChart(next) {
    setChart(next);
    resetDay();
  }

  function sortBy(key) {
    setSort((s) => ({ key, desc: s.key === key ? !s.desc : true }));
  }

  return (
    <div className="wrap stats-page">
      <div className="stat-head">
        <div>
          <h2>{title}</h2>
          <p>数据截至 {data.until}</p>
        </div>
        <button
          className="btn sm icon"
          onClick={onRefresh}
          disabled={loading || refreshing}
          title={refreshing || loading ? '正在统计…' : '重新统计'}
          aria-label="重新统计"
        >
          {refreshing || loading ? <span className="spinner" /> : IC.refresh}
        </button>
      </div>

      {error ? <div className="stat-error">刷新失败：{error}。正在显示上次统计结果。</div> : null}

      <div className="toolbar">
        <div className="seg">
          {RANGES.map((r) => (
            <button key={r.key} className={range === r.key ? 'active' : ''} onClick={() => selectRange(r.key)}>
              {r.label}
            </button>
          ))}
        </div>
        <span className="stat-range tabular">
          {start.replaceAll('-', '.')} — {data.until.replaceAll('-', '.')}
        </span>
        <label className="aside stat-scope">
          项目范围
          <select value={activeProject} onChange={(e) => selectProject(e.target.value)}>
            <option value="all">全部项目</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <section className="stat-kpis" aria-label="本期关键指标">
        <div>
          <div className="stat-kpi-title">
            {IC.code}
            代码活动
          </div>
          <div className="stat-metrics">
            <div>
              <div className="stat-metric-label">提交次数</div>
              <div className="stat-value tabular">
                {nf(totals.commits)}
                <span className="stat-unit">次</span>
              </div>
              <div className="stat-footnote">
                <b>{activeDays}</b> / {days.length} 天有提交
              </div>
            </div>
            <div>
              <div className="stat-metric-label">新增行数</div>
              <div className="stat-value stat-green tabular">{signed('added', totals.added)}</div>
            </div>
            <div>
              <div className="stat-metric-label">删除行数</div>
              <div className="stat-value stat-red tabular">{signed('removed', totals.removed)}</div>
              <div className="stat-footnote">
                净变化{' '}
                <b>
                  {net > 0 ? '+' : net < 0 ? '−' : ''}
                  {nf(Math.abs(net))}
                </b>{' '}
                行
              </div>
            </div>
          </div>
        </div>
        <div>
          <div className="stat-kpi-title">
            {IC.check}
            需求处理
          </div>
          <div className="stat-metrics">
            <div>
              <div className="stat-metric-label">已处理</div>
              <div className="stat-value tabular">
                {nf(totals.processed)}
                <span className="stat-unit">条</span>
              </div>
            </div>
            <div>
              <div className="stat-metric-label">已完成</div>
              <div className="stat-value stat-blue tabular">
                {nf(totals.done)}
                <span className="stat-unit">条</span>
              </div>
            </div>
            <div>
              <div className="stat-metric-label">已拒绝</div>
              <div className="stat-value tabular">
                {nf(totals.rejected)}
                <span className="stat-unit">条</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="stat-charts">
        <div>
          <div className="stat-chart-head">
            <h3>代码活动趋势</h3>
            <div className="stat-chart-tabs">
              <button className={chart === 'code' ? 'on' : ''} onClick={() => selectChart('code')}>
                增删行数
              </button>
              <button className={chart === 'commits' ? 'on' : ''} onClick={() => selectChart('commits')}>
                提交次数
              </button>
            </div>
          </div>
          <div className="stat-legend">
            {chart === 'code' ? (
              <>
                <span>
                  <i style={{ background: 'var(--green)' }} />
                  新增
                </span>
                <span>
                  <i style={{ background: 'var(--red)', opacity: 0.6 }} />
                  删除
                </span>
              </>
            ) : (
              <span>
                <i style={{ background: 'var(--blue)' }} />
                提交次数
              </span>
            )}
            <span className="stat-units">单位：{chart === 'code' ? '行' : '次'}</span>
          </div>
          {totals.commits ? (
            <DailyChart days={days} mode={chart} selected={selDay} onSelect={setSelDay} />
          ) : (
            <div className="stat-chart-empty">这段时间还没有提交</div>
          )}
          <div className="stat-chart-sum">
            <span>
              活跃项目 <b>{rows.filter((p) => p.commits > 0).length}</b> 个
            </span>
            {busiest.commits ? (
              <span>
                提交最多 <b>{shortDate(busiest.date)} · {busiest.commits} 次</b>
              </span>
            ) : null}
          </div>
        </div>
        <div>
          <div className="stat-chart-head">
            <h3>需求处理趋势</h3>
          </div>
          <div className="stat-legend">
            <span>
              <i style={{ background: 'var(--blue)' }} />
              已完成
            </span>
            <span>
              <i style={{ background: 'var(--label-4)' }} />
              已拒绝
            </span>
            <span className="stat-units">单位：条</span>
          </div>
          {totals.processed ? (
            <DailyChart days={days} mode="req" selected={selDay} onSelect={setSelDay} />
          ) : (
            <div className="stat-chart-empty">暂无需求处理记录</div>
          )}
        </div>
      </section>

      <section className="stat-table-sec">
        <div className="stat-table-head">
          <h3>项目明细</h3>
          <small>
            {rows.length} 个项目 · {rows.filter((p) => p.commits > 0 || p.processed > 0).length} 个有活动
          </small>
          {activeProject !== 'all' ? (
            <button className="stat-link" onClick={() => selectProject('all')}>
              返回全部项目
            </button>
          ) : null}
        </div>
        <div className="stat-table-scroll">
          <table className="stat-table">
            <thead>
              <tr>
                <th scope="col">项目</th>
                {COLUMNS.map((c) => (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={sort.key === c.key ? (sort.desc ? 'descending' : 'ascending') : 'none'}
                  >
                    <button onClick={() => sortBy(c.key)}>
                      {c.label}
                      {sort.key === c.key ? <span className="stat-sort">{sort.desc ? '↓' : '↑'}</span> : null}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td>
                    <button className="stat-project" onClick={() => selectProject(p.id)} title={'查看「' + p.name + '」的统计'}>
                      <span>{p.name}</span>
                      <small className={p.error ? 'stat-warn' : undefined}>
                        {p.error
                          ? '读取失败'
                          : !p.isRepo
                            ? '非 Git 仓库'
                            : p.truncated
                              ? (p.branch || '无分支') + ' · 数据截断'
                              : p.branch || '无分支'}
                      </small>
                    </button>
                  </td>
                  {COLUMNS.map((c) => (
                    <td key={c.key} className={(p[c.key] ? c.tone || '' : 'stat-zero') + ' tabular'}>
                      {signed(c.key, p[c.key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            {rows.length > 1 ? (
              <tfoot>
                <tr>
                  <td>合计</td>
                  {COLUMNS.map((c) => (
                    <td key={c.key} className={c.tone || ''}>
                      {signed(c.key, totals[c.key])}
                    </td>
                  ))}
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      </section>

      <details className="stat-note">
        <summary>统计口径</summary>
        <ul>
          <li>代码：按各项目当前分支的提交日期统计，只计项目目录内的非合并提交；不含未提交改动；二进制文件不计行数。</li>
          <li>需求：已处理 = 已完成 + 已拒绝，按需求去重；已完成表示审核通过，已拒绝表示关闭、不再处理。按最后一次更新时间（updatedAt）归入本地自然日；完成后又改过备注的需求会算在改动那一天。</li>
          <li>范围：不含已归档项目；多个项目指向同一仓库或父子目录时会各算一次。</li>
          <li>行数衡量变更规模，不代表产出质量。</li>
        </ul>
      </details>
    </div>
  );
}

import { VIEWS } from '../lib/page-meta.js';

/**
 * 每项右侧的计数。口径与左栏项目行角标同一套，只是作用域收窄到当前项目：
 * 需求看未完成（UNFINISHED 含 review）、启动台看运行中/脚本总数、修改记录看未提交文件数。
 * 三个页签常驻可见，数字一律显示（0 也是信息），灯只在「有事」时亮，便于横向比较。
 * 修改记录这一项还兼着「远程有没有没拉的」：同一页里两件事，数字优先给本地改动数，
 * 只有本地干净时才让位给 ↓N，否则「0 个未提交 + 亮着灯」会自相矛盾。
 */
function countOf(key, project, dirtyCount, behindCount) {
  if (!project) return null;
  if (key === 'launch') {
    const running = project.runningCount || 0;
    const total = project.commandCount || 0;
    return {
      text: running + '/' + total,
      on: running > 0,
      title: '共 ' + total + ' 个脚本，' + (running ? running + ' 个运行中' : '当前没有运行')
    };
  }
  if (key === 'changes') {
    const n = dirtyCount || 0;
    const b = behindCount || 0;
    const tips = [];
    if (n > 0) tips.push(n + ' 个未提交文件');
    if (b > 0) tips.push('远程领先 ' + b + ' 个提交待拉取');
    if (!tips.length) tips.push('工作区干净');
    return {
      text: n > 0 ? String(n) : b > 0 ? '↓' + b : '0',
      on: n > 0 || b > 0,
      title: tips.join(' · ')
    };
  }
  const n = project.pendingCount || 0;
  return { text: String(n), on: n > 0, title: n + ' 个未完成需求' };
}

/**
 * 中区标题位置的视图切换：紧凑页签，仅当前项展开名称，其余只留图标、状态灯和计数。
 * 三项同属「当前选中的项目」，点击就地切换，不再经过下拉。
 */
export default function PageMenu({ page, project, dirtyCount, behindCount, onNav }) {
  const rows = VIEWS.map((v) => ({ ...v, count: countOf(v.key, project, dirtyCount, behindCount) }));

  return (
    <div className="vtabs" role="tablist" aria-label="项目视图">
      {rows.map((v) => {
        const on = v.key === page;
        const hint = v.count ? v.label + ' · ' + v.count.title : v.label;
        return (
          <button
            key={v.key}
            className={'vtab' + (on ? ' active' : '')}
            role="tab"
            aria-selected={on}
            title={hint}
            aria-label={hint}
            onClick={() => {
              if (!on) onNav(v.key);
            }}
          >
            <span className="ico">{v.icon}</span>
            <span className="lbl">{v.label}</span>
            {/* 灯只在「有事」时亮：扫一眼就知道切到哪一项能看到改动 / 在跑的进程 */}
            {v.count?.on ? <i className={'plight ' + v.tone} /> : null}
            {v.count ? <span className="cnt">{v.count.text}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

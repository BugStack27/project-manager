import React, { useState } from 'react';
import { fmtClock, fmtDateTime, fmtDuration, isCommandActive, runExitLabel } from './format.js';
import { IC } from './icons.jsx';
import { ContextBar, Empty } from './ui.jsx';

export default function LaunchPage({
  project,
  projects,
  commands,
  filter,
  onFilter,
  loading,
  onNew,
  onEdit,
  onStart,
  onStop,
  onLogs,
  selId
}) {
  const [pending, setPending] = useState({});

  // 「运行中」口径含已分离但还活着的进程：服务在跑，就不该同时显示「暂无服务运行」
  const running = commands.filter(isCommandActive).length;
  const stopped = commands.length - running;
  const list =
    filter === 'all'
      ? commands
      : commands.filter((c) => (filter === 'running' ? isCommandActive(c) : !isCommandActive(c)));

  async function withPending(c, fn) {
    setPending((p) => ({ ...p, [c.id]: true }));
    try {
      await fn(c);
    } finally {
      setPending((p) => {
        const next = { ...p };
        delete next[c.id];
        return next;
      });
    }
  }

  return (
    <div className="wrap">
      {project ? (
        <ContextBar
          project={project}
          projects={projects}
          status={
            running > 0
              ? {
                  text: running + ' 个服务运行中',
                  tone: 'free',
                  title: '共 ' + running + ' 条命令正在运行'
                }
              : { text: '暂无服务运行', tone: 'muted', title: '当前没有运行中的命令' }
          }
        />
      ) : null}
      <div className="toolbar">
        <div className="seg">
          <button className={filter === 'all' ? 'active' : ''} onClick={() => onFilter('all')}>
            全部<span className="n">{commands.length}</span>
          </button>
          <button className={filter === 'running' ? 'active' : ''} onClick={() => onFilter('running')}>
            运行中<span className="n">{running}</span>
          </button>
          <button className={filter === 'stopped' ? 'active' : ''} onClick={() => onFilter('stopped')}>
            已停止<span className="n">{stopped}</span>
          </button>
        </div>
        <div className="aside">
          <button className="btn sm primary" onClick={onNew}>
            {IC.plus}新增命令
          </button>
        </div>
      </div>

      {loading ? (
        <div className="loading">
          <span className="spinner" />
          正在加载命令…
        </div>
      ) : commands.length === 0 ? (
        <Empty
          title="还没有配置启动命令"
          desc="添加一条命令，之后一键启动并保留完整日志。"
          icon={IC.term}
        >
          <button className="btn sm" onClick={onNew}>
            {IC.plus}新增命令
          </button>
        </Empty>
      ) : list.length === 0 ? (
        <Empty title="该状态暂无命令" desc="换个筛选条件看看。" icon={IC.term} />
      ) : (
        <div className="list">
          {list.map((c) => {
            const isRun = c.status === 'running';
            const last = c.lastRun;
            const detached = !isRun && last && last.status === 'detached' ? last : null;
            /** 分离出去但进程还活着：仍在写日志、仍在占端口，按「在跑」展示 */
            const active = isRun || (detached && detached.alive);
            const busy = !!pending[c.id];
            const on = selId === c.id;
            /** 整行可点：点启动项即把右侧面板切到这条命令的日志，不必再找「日志」按钮 */
            function openThis() {
              onLogs(c);
            }
            return (
              <div
                className={'row cmd' + (on ? ' sel' : '')}
                key={c.id}
                onClick={openThis}
                aria-current={on ? 'true' : undefined}
                title="查看运行日志"
              >
                {/* 键盘走的焦点落在正文区（行内的设置/启停按钮不能再套一层可点元素） */}
                <div
                  className="body"
                  role="button"
                  tabIndex={0}
                  aria-label={'查看 ' + (c.name || c.text) + ' 的运行日志'}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      openThis();
                    }
                  }}
                >
                  <div className="row1">
                    {c.name ? (
                      <span className="cmd-name" title={c.name}>
                        {c.name}
                      </span>
                    ) : null}
                    <span className="cmd-code" title={c.text}>
                      {c.text}
                    </span>
                    <span className={'run ' + (isRun ? 'running' : detached && detached.alive ? 'detached' : 'stopped')}>
                      {isRun ? (
                        <>
                          <span className="live" />
                          运行中
                        </>
                      ) : detached && detached.alive ? (
                        <>
                          <span className="live" />
                          已分离
                        </>
                      ) : detached ? (
                        '已分离'
                      ) : (
                        '已停止'
                      )}
                    </span>
                  </div>
                  <div className="row2">
                    <span className="path" title={c.cwd}>
                      {c.cwd}
                    </span>
                    {active ? (
                      <span className="meta">
                        启动 <b>{fmtClock(last && last.startedAt)}</b> · 已运行 <b>{fmtDuration(last && last.startedAt)}</b>
                        {last && last.pid ? (
                          <>
                            {' '}
                            · pid <b>{last.pid}</b>
                          </>
                        ) : null}
                      </span>
                    ) : last ? (
                      <span className="meta">
                        上次运行 <b>{fmtDateTime(last.startedAt)}</b> · <b>{runExitLabel(last)}</b>
                      </span>
                    ) : (
                      <span className="meta">还没有运行过</span>
                    )}
                  </div>
                </div>
                <div className="acts">
                  {/* 行内按钮各自吞掉点击：别让「设置 / 停止」顺带把右面板切走 */}
                  <button
                    className="cmenu"
                    onClick={(e) => {
                      e.stopPropagation();
                      onEdit(c);
                    }}
                    title="命令设置"
                    aria-label="命令设置"
                  >
                    {IC.dots}
                  </button>
                  {active ? (
                    <button
                      className="btn sm stop"
                      disabled={busy}
                      title={isRun ? '停止进程' : '结束已分离的进程（进程树一并终止）'}
                      onClick={(e) => {
                        e.stopPropagation();
                        withPending(c, onStop);
                      }}
                    >
                      {IC.stop}停止
                    </button>
                  ) : (
                    <button
                      className="btn sm start"
                      disabled={busy}
                      onClick={(e) => {
                        e.stopPropagation();
                        withPending(c, onStart);
                      }}
                    >
                      {IC.play}启动
                    </button>
                  )}
                  {/* 行尾小箭头：提示整行点下去会展开右侧日志（纯视觉，不接事件） */}
                  <span className="cmd-go" aria-hidden="true">
                    {IC.chev}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

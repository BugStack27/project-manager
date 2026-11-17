import { useEffect, useState } from 'react';
import { STATUS, STATUS_ORDER, TAB_LABEL, UNFINISHED } from './constants.js';
import { fmtDateTime } from './format.js';
import { IC } from './icons.jsx';
import { ContextBar, DangerButton, Empty } from './ui.jsx';

/** 看板列顺序：与状态流转一致；候选池单列（还没确认的想法），
    未开始 / 进行中 / 待审核 三态合并为「未完成」一列（与列表页签同口径），终态的两种状态合并一列。
    top = 该列内置顶的状态、数组顺序即先后，只影响列内顺序 */
const BOARD_COLUMNS = [
  { key: 'candidate', label: STATUS.candidate.label, dot: 'st-candidate', statuses: ['candidate'] },
  {
    key: 'unfinished',
    label: TAB_LABEL.unfinished,
    dot: 'mixed-open',
    statuses: UNFINISHED,
    top: ['doing', 'review']
  },
  {
    key: 'closed',
    label: '已完成 / 已拒绝',
    dot: 'mixed-end',
    statuses: ['done', 'rejected']
  }
];
const VIEW_KEY = 'pm.ui.reqView';

/** 视图偏好：默认列表；读写成败都静默，坏值回落列表 */
function loadView() {
  try {
    return window.localStorage.getItem(VIEW_KEY) === 'board' ? 'board' : 'list';
  } catch (_) {
    return 'list';
  }
}

/** 待回答的提问：一条需求可以挂多条，老数据只有单条 question */
function askList(r) {
  if (Array.isArray(r.questions)) return r.questions;
  return r.question ? [r.question] : [];
}

/**
 * 「待回答」角标：多条时带数字，否则用户以为只问了一句。
 */
function askBadge(r) {
  const list = askList(r);
  return {
    list,
    label: list.length > 1 ? '待回答 ' + list.length : '待回答',
    tip: list
      .map((q, i) => (list.length > 1 ? i + 1 + '. ' : '') + (q.agentName || q.agent || 'agent') + ' 提问：' + q.text)
      .join('\n')
  };
}

function claimLabel(r) {
  const name = r.claim.agentName || r.claim.agent;
  return { name, tip: '由 ' + name + ' 于 ' + fmtDateTime(r.claim.at) + ' 认领' };
}

/**
 * 状态图标：卡片底行只留图形与颜色，具体文案交给 title / aria-label。
 * 形状自带语义：空心＝待办、转环＝进行中、时钟＝待审核、对勾＝完成、禁止符＝拒绝、虚线＝候选，
 * 色觉障碍下也能靠轮廓区分。
 */
function StatusMark({ status }) {
  let glyph;
  if (status === 'doing') {
    glyph = (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
        <circle cx="8" cy="8" r="5.6" opacity=".22" />
        <path d="M8 2.4a5.6 5.6 0 0 1 5.6 5.6" />
      </svg>
    );
  } else if (status === 'done') {
    glyph = (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="7" fill="currentColor" />
        <path
          d="M4.7 8.2l2.2 2.2 4.4-4.6"
          fill="none"
          stroke="#fff"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  } else if (status === 'rejected') {
    glyph = (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
        <circle cx="8" cy="8" r="6" />
        <path d="M4.1 11.9L11.9 4.1" />
      </svg>
    );
  } else if (status === 'review') {
    glyph = (
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="8" cy="8" r="5.8" />
        <path d="M8 4.6V8l2.3 1.5" />
      </svg>
    );
  } else if (status === 'candidate') {
    glyph = (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
        <circle cx="8" cy="8" r="5.8" strokeDasharray="2.2 2.6" />
      </svg>
    );
  } else {
    glyph = (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        <circle cx="8" cy="8" r="5.8" />
      </svg>
    );
  }
  return (
    <span
      className={'stmark is-' + status + (status === 'doing' ? ' spin' : '')}
      title={STATUS[status].label}
      role="img"
      aria-label={'状态：' + STATUS[status].label}
    >
      {glyph}
    </span>
  );
}

function actionsFor(r, api) {
  // 候选池不在卡上给按钮：真实用法是「点开抽屉看完内容再拍板」，按钮留在卡上会让用户看完还得回来再点一次。
  // 采纳 / 丢弃只在右侧详情里出现（见 RequirementDetail 的 .rd-cand），卡上不再有这一行
  if (r.status === 'candidate') return null;
  if (r.status === 'todo') {
    return (
      <>
        {/* 开始 / 拒绝是同一行里的一组相反动作：绿=推进、红=终止，不靠悬停才看得出区别 */}
        <button className="btn sm start" onClick={() => api.onStatus(r, 'doing')}>
          开始
        </button>
        <button className="btn sm stop" onClick={() => api.onStatus(r, 'rejected')}>
          拒绝
        </button>
      </>
    );
  }
  if (r.status === 'doing') {
    return (
      <>
        <button className="btn sm ok" onClick={() => api.onStatus(r, 'done')}>
          {IC.check}标记已完成
        </button>
        {/* 撤回未开始的流程可复用；已有 agent 认领时撤销会一并释放认领，先二次确认防误点 */}
        {r.claim ? (
          <DangerButton
            label="撤销"
            confirmLabel="确认撤销"
            onConfirm={() => api.onStatus(r, 'todo')}
          />
        ) : (
          <button className="btn sm ghost" onClick={() => api.onStatus(r, 'todo')}>
            撤销
          </button>
        )}
        <button className="btn sm stop" onClick={() => api.onStatus(r, 'rejected')}>
          拒绝
        </button>
      </>
    );
  }
  // 待审核：agent 已交付，等用户验收；打回后回进行中，同一个 agent 继续改
  if (r.status === 'review') {
    return (
      <>
        <button className="btn sm ok" onClick={() => api.onStatus(r, 'done')}>
          {IC.check}通过
        </button>
        <button className="btn sm ghost" onClick={() => api.onStatus(r, 'doing')}>
          打回
        </button>
      </>
    );
  }
  // 已完成：可以归档（记录搬出 db.json 到 archive/<项目id>/，页面不再显示），也可以撤销重开
  if (r.status === 'done') {
    return (
      <>
        {api.onArchive ? (
          <DangerButton label="归档" confirmLabel="确认归档" onConfirm={() => api.onArchive(r)} />
        ) : null}
        <button className="btn sm ghost" onClick={() => api.onStatus(r, 'todo')}>
          撤销
        </button>
      </>
    );
  }
  return (
    <button className="btn sm ghost" onClick={() => api.onStatus(r, 'todo')}>
      撤销
    </button>
  );
}

/** 看板卡片：身份行（编号 + 标题 + 来源）/ 描述 / 状态行三层；
    状态行只留状态图标，认领人与时间左右分列；卡内操作 hover 时浮在右下角 */
function BoardCard({ r, sel, onSelect, onStatus }) {
  const term = r.status === 'done' || r.status === 'rejected' ? ' term' : '';
  const ask = askBadge(r);
  const claim = r.claim ? claimLabel(r) : null;
  const acts = term || r.status === 'candidate' ? null : actionsFor(r, { onStatus });
  return (
    <article
      className={'bcard' + term + (sel ? ' sel' : '')}
      onClick={() => onSelect(r)}
    >
      <div className="bcard-hd">
        <span className="bseq mono">#{r.seq}</span>
        <h3 className="bcard-title" title={r.title}>
          {r.title}
        </h3>
        <span className={'src' + (r.source === 'ai' ? ' ai' : '')}>
          {r.source === 'ai' ? 'AI' : '手动'}
        </span>
      </div>
      {r.body ? <p className="bcard-body">{r.body}</p> : null}
      <div className="bcard-foot">
        <StatusMark status={r.status} />
        {claim ? (
          <span className="req-who" title={claim.tip}>
            {claim.name}
          </span>
        ) : (
          <span className="req-who none">未认领</span>
        )}
        {ask.list.length ? (
          <span className="src ask" title={ask.tip}>
            {ask.label}
          </span>
        ) : null}
        <span className="req-when" title={'更新于 ' + fmtDateTime(r.updatedAt)}>
          {fmtDateTime(r.updatedAt)}
        </span>
      </div>
      {acts ? (
        <div className="bacts" onClick={(e) => e.stopPropagation()}>
          {acts}
        </div>
      ) : null}
    </article>
  );
}

export default function RequirementsPage({
  project,
  projects,
  requirements,
  filter,
  onFilter,
  loading,
  onNew,
  onStatus,
  onArchive,
  selId,
  onSelect
}) {
  const [view, setView] = useState(loadView);
  useEffect(() => {
    try {
      window.localStorage.setItem(VIEW_KEY, view);
    } catch (_) {
      /* 写入失败（隐私模式等）时忽略，不影响使用 */
    }
  }, [view]);

  const counts = {
    candidate: requirements.filter((r) => r.status === 'candidate').length,
    unfinished: requirements.filter((r) => UNFINISHED.includes(r.status)).length,
    done: requirements.filter((r) => r.status === 'done').length,
    rejected: requirements.filter((r) => r.status === 'rejected').length
  };

  const list =
    filter === 'unfinished'
      ? requirements.filter((r) => UNFINISHED.includes(r.status))
      : requirements.filter((r) => r.status === filter);

  /* 未完成列里进行中 / 待审核按 top 的先后置顶（一列挤三种状态，在跑的和在等的先看到），
     没列进去的排在后面，沿用接口给的编号从新到旧 —— Array#sort 稳定，同档之间不会被这次排序打乱 */
  const board = BOARD_COLUMNS.map((col) => {
    const items = requirements.filter((r) => col.statuses.includes(r.status));
    if (!col.top) return { ...col, items };
    const w = (r) => {
      const i = col.top.indexOf(r.status);
      return i < 0 ? col.top.length : i;
    };
    return { ...col, items: items.sort((a, b) => w(a) - w(b)) };
  });

  return (
    <div className={'wrap' + (view === 'board' ? ' board-wrap' : '')}>
      <ContextBar project={project} projects={projects} />

      <div className="toolbar">
        {view === 'list' ? (
          <div className="seg">
            {STATUS_ORDER.map((k) => (
              <button
                key={k}
                className={filter === k ? 'active' : ''}
                onClick={() => onFilter(k)}
              >
                {TAB_LABEL[k]}
                <span className="n">{counts[k]}</span>
              </button>
            ))}
          </div>
        ) : (
          <span className="board-hint">共 {requirements.length} 条</span>
        )}
        <div className="aside req-tools">
          <div className="seg viewseg" role="group" aria-label="视图切换">
            <button
              className={view === 'list' ? 'active' : ''}
              onClick={() => setView('list')}
              title="列表视图"
              aria-label="列表视图"
              aria-pressed={view === 'list'}
            >
              {IC.list}
            </button>
            <button
              className={view === 'board' ? 'active' : ''}
              onClick={() => setView('board')}
              title="看板视图"
              aria-label="看板视图"
              aria-pressed={view === 'board'}
            >
              {IC.board}
            </button>
          </div>
          <button
            className="btn sm icon primary"
            onClick={onNew}
            title="新建需求"
            aria-label="新建需求"
          >
            {IC.plus}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="loading">
          <span className="spinner" />
          正在加载需求…
        </div>
      ) : requirements.length === 0 ? (
        <Empty
          title="这个项目还没有需求"
          desc="手动新建，或由 AI 巡检提出。"
          icon={IC.emptyDoc}
        >
          <button className="btn sm" onClick={onNew}>
            {IC.plus}新建需求
          </button>
        </Empty>
      ) : view === 'board' ? (
        <div className="board">
          {board.map(({ key, label, dot, items }) => (
            <section className="bcol" key={key}>
              <header className="bcol-hd">
                <i className={'bdot ' + dot} />
                <span className="bcol-name">{label}</span>
                <span className="bcol-n">{items.length}</span>
              </header>
              <div className="bcol-body">
                {items.length === 0 ? (
                  <div className="bcol-empty">暂无需求</div>
                ) : (
                  items.map((r) => (
                    <BoardCard
                      key={r.id}
                      r={r}
                      sel={selId === r.id}
                      onSelect={onSelect}
                      onStatus={onStatus}
                    />
                  ))
                )}
              </div>
            </section>
          ))}
        </div>
      ) : list.length === 0 ? (
        <Empty
          title={filter === 'candidate' ? '候选池是空的' : '该状态暂无需求'}
          desc={
            filter === 'candidate'
              ? 'AI 巡检提的需求会先落在这里；新建需求时也能勾选「放进候选池」。'
              : '换个筛选条件看看。'
          }
          icon={IC.emptyDoc}
        />
      ) : (
        <div className="list">
          {list.map((r) => {
            const term = r.status === 'done' || r.status === 'rejected' ? ' term' : '';
            const on = selId === r.id;
            const ask = askBadge(r);
            const claim = r.claim ? claimLabel(r) : null;
            const acts = actionsFor(r, { onStatus, onArchive });
            return (
              <article
                className={'row req' + term + (on ? ' sel' : '')}
                key={r.id}
                onClick={() => onSelect(r)}
              >
                <div className="req-top">
                  <span className="req-seq mono">#{r.seq}</span>
                  <h3 className="req-title" title={r.title}>
                    {r.title}
                  </h3>
                  <span className={'src' + (r.source === 'ai' ? ' ai' : '')}>
                    {r.source === 'ai' ? 'AI' : '手动'}
                  </span>
                </div>
                {r.body ? <p className="req-body">{r.body}</p> : null}
                <div className="req-foot">
                  <StatusMark status={r.status} />
                  {claim ? (
                    <span className="req-who" title={claim.tip}>
                      {claim.name}
                    </span>
                  ) : (
                    <span className="req-who none">未认领</span>
                  )}
                  {ask.list.length ? (
                    <span className="src ask" title={ask.tip}>
                      {ask.label}
                    </span>
                  ) : null}
                  {r.status === 'doing' && r.claim && !r.unlock ? (
                    <span
                      className="src lock"
                      title={
                        '项目被这条进行中的任务锁住：任何 agent（含 ' +
                        (r.claim.agentName || r.claim.agent) +
                        '）都领不到它，需要在详情里点「解锁项目」才会继续'
                      }
                    >
                      已锁定
                    </span>
                  ) : null}
                  {r.note ? (
                    <span className="meta note" title={r.note}>
                      备注 <b>{r.note}</b>
                    </span>
                  ) : null}
                  {r.feedback && r.feedback.note ? (
                    <span className="meta note" title={r.feedback.note}>
                      {r.feedback.kind === 'reopen' ? '撤销原因' : '打回原因'}{' '}
                      <b>{r.feedback.note}</b>
                    </span>
                  ) : null}
                  <span className="req-when" title={'更新于 ' + fmtDateTime(r.updatedAt)}>
                    {fmtDateTime(r.updatedAt)}
                  </span>
                  {/* 候选没有卡内动作：采纳 / 丢弃在右侧详情里，看完就地拍板 */}
                  {acts ? (
                    <div className="acts" onClick={(e) => e.stopPropagation()}>
                      {acts}
                    </div>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import {
  actorName,
  eventIcon,
  eventProjectName,
  eventSummary,
  eventTime,
  eventTone,
  eventTypeLabel,
  groupByDay
} from '../lib/events-view.js';
import { Modal } from '../ui.jsx';

const PAGE = 50;
const ALL = 'all';
const DELETED = '__deleted__';

const TYPES = [
  { value: ALL, label: '全部类型' },
  { value: 'requirement', label: '需求' },
  { value: 'command', label: '命令' },
  { value: 'project', label: '项目' },
  { value: 'data', label: '数据' },
  { value: 'git', label: '代码' },
  { value: 'settings', label: '设置' }
];

const ACTORS = [
  { value: ALL, label: '全部操作者' },
  { value: 'user', label: '我' },
  { value: 'agent', label: 'Agent' },
  { value: 'system', label: '系统' }
];

const TIMES = [
  { value: '7', label: '最近 7 天' },
  { value: '30', label: '最近 30 天' },
  { value: ALL, label: '全部时间' }
];

function sinceIso(days) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (days - 1));
  return d.toISOString();
}

function canOpen(ev, activeIds) {
  if (ev.deleted) return false;
  if (!ev.projectId || !activeIds.has(ev.projectId)) return false;
  if (ev.type === 'project.deleted' || ev.type === 'requirement.deleted' || ev.type === 'command.deleted') return false;
  if (ev.type.startsWith('requirement.')) return !!ev.requirementId;
  if (ev.type.startsWith('command.')) return !!ev.commandId;
  if (ev.type.startsWith('project.')) return true;
  return false;
}

function targetOf(ev) {
  if (ev.type.startsWith('requirement.')) {
    return { page: 'req', projectId: ev.projectId, requirementId: ev.requirementId };
  }
  if (ev.type.startsWith('command.')) {
    return {
      page: 'launch',
      projectId: ev.projectId,
      commandId: ev.commandId,
      runId: (ev.data && ev.data.runId) || null
    };
  }
  return { page: 'req', projectId: ev.projectId };
}

function Row({ ev, activeIds, onOpen }) {
  const open = canOpen(ev, activeIds);
  const onKey = (e) => {
    if (!open) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onOpen(ev);
    }
  };
  return (
    <div
      className={'audit-row ' + eventTone(ev.type) + (open ? ' clickable' : '')}
      onClick={open ? () => onOpen(ev) : undefined}
      onKeyDown={onKey}
      role={open ? 'button' : undefined}
      tabIndex={open ? 0 : undefined}
      title={open ? '打开对应页面' : undefined}
    >
      <span className="audit-ico">{eventIcon(ev.type)}</span>
      <span className="audit-main">
        <span className="audit-line">
          <b>{eventTypeLabel(ev.type)}</b>
          <span className="audit-proj">{eventProjectName(ev) || '系统'}</span>
          <span className="audit-actor">{actorName(ev.actor)}</span>
          <span className="audit-time">{eventTime(ev)}</span>
        </span>
        <span className="audit-sum">{eventSummary(ev)}</span>
      </span>
    </div>
  );
}

/**
 * 全局审计日志：只读事件流，支持项目/类型/操作者/时间筛选与 before 游标分页。
 * 不做已读/未读；实体仍存在时点击跳转，已删除实体只展示快照。
 */
export default function AuditModal({
  projects = [],
  archivedProjects = [],
  initialProjectId = null,
  initialRequirementId = null,
  requirementLabel = '',
  onNavigate,
  onClose
}) {
  const allProjects = [...projects, ...archivedProjects];
  const activeIds = new Set(projects.map((p) => p.id));
  const known = new Set(allProjects.map((p) => p.id));

  const [projectFilter, setProjectFilter] = useState(() => {
    if (!initialProjectId) return ALL;
    return known.has(initialProjectId) ? initialProjectId : DELETED;
  });
  const [typeFilter, setTypeFilter] = useState(ALL);
  const [actorFilter, setActorFilter] = useState(ALL);
  const [timeFilter, setTimeFilter] = useState(initialRequirementId ? ALL : '7');
  const [reqFilter, setReqFilter] = useState(initialRequirementId || null);
  const [events, setEvents] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [nextBefore, setNextBefore] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [reloadTick, setReloadTick] = useState(0);
  const tokenRef = useRef(0);

  function params(before) {
    const q = { limit: PAGE };
    if (projectFilter === DELETED) q.deletedOnly = true;
    else if (projectFilter !== ALL) q.projectId = projectFilter;
    if (typeFilter !== ALL) q.category = typeFilter;
    if (actorFilter !== ALL) q.actorKind = actorFilter;
    if (timeFilter !== ALL) q.from = sinceIso(Number(timeFilter));
    if (reqFilter) q.requirementId = reqFilter;
    if (before) q.before = before;
    return q;
  }

  async function request(reset, before) {
    const token = ++tokenRef.current;
    if (reset) {
      setLoading(true);
      setError('');
    } else {
      setLoadingMore(true);
    }
    try {
      const res = await api.events(params(before));
      if (token !== tokenRef.current) return;
      setEvents((prev) => (reset ? res.events : prev.concat(res.events)));
      setHasMore(!!res.hasMore);
      setNextBefore(res.nextBefore || null);
      setError('');
    } catch (e) {
      if (token === tokenRef.current) setError(e.message || '加载失败');
    } finally {
      if (token === tokenRef.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }

  useEffect(() => {
    request(true, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectFilter, typeFilter, actorFilter, timeFilter, reqFilter, reloadTick]);

  function changeProject(v) {
    setProjectFilter(v);
    if (v === DELETED || v !== initialProjectId) setReqFilter(null);
  }

  function openEvent(ev) {
    if (!onNavigate) return;
    onClose();
    onNavigate(targetOf(ev));
  }

  const groups = groupByDay(events);

  return (
    <Modal wide className="audit-modal" onClose={onClose}>
      <div className="audit-hd">
        <div>
          <h2>审计日志</h2>
          <p className="sub">项目、需求、命令与数据恢复的只读记录</p>
        </div>
        {loading ? <span className="spinner" /> : null}
      </div>

      <div className="audit-filters">
        <select aria-label="项目筛选" value={projectFilter} onChange={(e) => changeProject(e.target.value)}>
          <option value={ALL}>全部项目</option>
          {allProjects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.archived ? '（已归档）' : ''}
            </option>
          ))}
          <option value={DELETED}>已删除项目</option>
        </select>
        <select aria-label="类型筛选" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          {TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <select aria-label="操作者筛选" value={actorFilter} onChange={(e) => setActorFilter(e.target.value)}>
          {ACTORS.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </select>
        <select aria-label="时间筛选" value={timeFilter} onChange={(e) => setTimeFilter(e.target.value)}>
          {TIMES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        {reqFilter ? (
          <span className="audit-chip">
            仅看 {requirementLabel || '指定需求'}
            <button onClick={() => setReqFilter(null)} title="清除需求筛选">
              清除
            </button>
          </span>
        ) : null}
      </div>

      <div className="audit-list">
        {error ? (
          <div className="audit-err">
            <span>{error}</span>
            <button className="btn sm" onClick={() => setReloadTick((n) => n + 1)}>
              重试
            </button>
          </div>
        ) : null}
        {loading && !events.length ? (
          <div className="loading">
            <span className="spinner" />
            正在加载事件…
          </div>
        ) : null}
        {!loading && !events.length && !error ? (
          <div className="audit-empty">没有符合条件的事件</div>
        ) : null}
        {groups.map((g) => (
          <div key={g.key} className="audit-day">
            <div className="audit-day-hd">{g.label}</div>
            {g.items.map((ev) => (
              <Row key={ev.id} ev={ev} activeIds={activeIds} onOpen={openEvent} />
            ))}
          </div>
        ))}
      </div>

      <div className="mfoot split">
        <span className="audit-count">
          已加载 {events.length} 条{hasMore ? ' · 还有更早记录' : ''}
        </span>
        <div className="audit-actions">
          {hasMore ? (
            <button
              className="btn"
              onClick={() => request(false, nextBefore)}
              disabled={loadingMore || loading}
            >
              {loadingMore ? '加载中…' : '加载更多'}
            </button>
          ) : null}
          <button className="btn primary" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </Modal>
  );
}

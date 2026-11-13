/* 事件展示：类型文案/图标、actor、摘要、按天分组。纯函数，无 JSX。 */
import { STATUS } from '../constants.js';
import { fmtClock } from '../format.js';
import { IC } from '../icons.jsx';

const TYPE_LABEL = {
  'project.created': '创建项目',
  'project.updated': '更新项目',
  'project.archived': '归档项目',
  'project.restored': '恢复项目',
  'project.deleted': '删除项目',
  'requirement.created': '新建需求',
  'requirement.updated': '编辑需求',
  'requirement.claimed': '认领需求',
  'requirement.completed': '交付待审核',
  'requirement.released': '释放需求',
  'requirement.asked': 'Agent 提问',
  'requirement.answered': '回答提问',
  'requirement.timeout': '提问超时',
  'requirement.status_changed': '状态变更',
  'requirement.deleted': '删除需求',
  'requirement.archived': '归档需求',
  'command.created': '新增命令',
  'command.updated': '编辑命令',
  'command.deleted': '删除命令',
  'command.started': '启动命令',
  'command.exited': '命令退出',
  'command.stopped': '停止命令',
  'command.spawn_failed': '启动失败',
  'command.detached': '分离命令',
  'command.recovered': '启动恢复',
  'data.restored': '恢复备份',
  'settings.changed': '设置变更',
  'git.pulled': '自动拉取',
  'git.pull_failed': '自动拉取失败'
};

const CATEGORY_LABEL = {
  project: '项目',
  requirement: '需求',
  command: '命令',
  data: '数据',
  settings: '设置',
  git: '代码'
};

const CATEGORY_ICON = {
  project: IC.folder,
  requirement: IC.req,
  command: IC.launch,
  data: IC.database,
  settings: IC.plug,
  git: IC.pull
};

const FIELD_LABEL = {
  title: '标题',
  body: '正文',
  note: '备注',
  text: '命令',
  cwd: '工作目录',
  name: '名称',
  aiScout: 'AI 巡检',
  autoPull: '启动自动拉取',
  path: '路径'
};

const RUN_STATUS = {
  running: '运行中',
  detached: '已分离',
  interrupted: '已中断',
  exited: '已退出',
  stopped: '已停止',
  failed: '失败'
};

const pad = (n) => String(n).padStart(2, '0');

function clip(text, max = 60) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function statusLabel(s) {
  return STATUS[s] ? STATUS[s].label : String(s || '');
}

function fieldsLabel(fields) {
  return (fields || []).map((f) => FIELD_LABEL[f] || f).join('、');
}

function projectName(d) {
  return d.projectName || d.name || '';
}

function projectText(d) {
  const n = projectName(d);
  return n ? '项目「' + n + '」' : '项目';
}

function reqText(d) {
  const seq = d.seq === undefined || d.seq === null ? '?' : d.seq;
  const title = d.title ? '「' + d.title + '」' : '';
  return '#' + seq + title;
}

function cmdText(d) {
  const name = d.name || d.text || '';
  return name ? '「' + name + '」' : '命令';
}

function noteSuffix(note) {
  return note ? ' · ' + clip(note) : '';
}

/** 事件里的 agent 展示名：新查询带 agentName，历史事件只有 ID 时原样显示 */
function agentText(d) {
  return d.agentName || d.agent || 'agent';
}

export function eventCategory(type) {
  return String(type || '').split('.')[0];
}

export function eventTypeLabel(type) {
  return TYPE_LABEL[type] || type || '';
}

export function eventCategoryLabel(type) {
  return CATEGORY_LABEL[eventCategory(type)] || '其他';
}

export function eventIcon(type) {
  return CATEGORY_ICON[eventCategory(type)] || IC.req;
}

export function eventTone(type) {
  return 'ev-' + (eventCategory(type) || 'other');
}

export function actorName(actor) {
  if (!actor) return '系统';
  if (actor.kind === 'user') return '我';
  if (actor.kind === 'agent') return actor.name || 'Agent';
  return '系统';
}

export function eventTime(ev) {
  return fmtClock(ev && ev.at);
}

export function eventProjectName(ev) {
  return projectName((ev && ev.data) || {});
}

export function eventSummary(ev) {
  const type = String((ev && ev.type) || '');
  const d = (ev && ev.data) || {};
  switch (type) {
    case 'project.created':
      return '创建' + projectText(d);
    case 'project.updated': {
      const fields = fieldsLabel(d.changes);
      const synced = d.syncedCommands ? '，同步 ' + d.syncedCommands + ' 条命令目录' : '';
      return '更新' + projectText(d) + (fields ? '：' + fields : '') + synced;
    }
    case 'project.archived':
      return '归档' + projectText(d);
    case 'project.restored':
      return '恢复' + projectText(d);
    case 'project.deleted': {
      const r = d.removed || {};
      const counts = r.requirements !== undefined ? '（需求 ' + r.requirements + ' / 命令 ' + r.commands + '）' : '';
      return '删除' + projectText(d) + counts;
    }
    case 'requirement.created':
      // 进候选池的需求还没确认，审计日志里要能分辨，否则回看时像是「直接进了待办」
      return (
        (d.status === 'candidate' ? '新建候选需求 ' : '新建需求 ') +
        reqText(d) +
        (d.source === 'ai' ? '（AI 巡检）' : '（手动）')
      );
    case 'requirement.updated': {
      const fields = fieldsLabel(d.fields);
      return '编辑需求 ' + reqText(d) + (fields ? '：' + fields : '');
    }
    case 'requirement.claimed':
      // via=next 表示由自动派发入口认领，事件流里要能和手动认领区分开
      return reqText(d) + ' 被 ' + agentText(d) + (d.via === 'next' ? ' 自动认领' : ' 认领');
    case 'requirement.completed':
      return reqText(d) + ' 由 ' + agentText(d) + ' 交付，等待验收' + noteSuffix(d.note);
    case 'requirement.released':
      return reqText(d) + ' 被 ' + agentText(d) + ' 释放回未开始' + noteSuffix(d.note);
    case 'requirement.asked':
      return reqText(d) + '：' + agentText(d) + ' 提问' + noteSuffix(d.note);
    case 'requirement.answered':
      return (
        reqText(d) +
        (d.source === 'default'
          ? ' 超时无人回答，按 ' + agentText(d) + ' 的默认继续'
          : ' 已回答 ' + agentText(d) + ' 的提问') +
        noteSuffix(d.note)
      );
    case 'requirement.timeout':
      return reqText(d) + ' 的提问超时，无人回答' + (d.count > 1 ? '（' + d.count + ' 条）' : '') + noteSuffix(d.note);
    case 'requirement.status_changed': {
      // 回传 agent 的原因走独立字段，优先于备注展示；撤销重开与打回要分清
      const extra =
        d.feedback !== undefined
          ? (d.feedbackKind === 'reopen' ? ' · 撤销原因：' : ' · 打回原因：') +
            clip(d.feedback || '（未填写）')
          : noteSuffix(d.note);
      return reqText(d) + '：' + statusLabel(d.from) + ' → ' + statusLabel(d.to) + extra;
    }
    case 'requirement.deleted':
      return '删除需求 ' + reqText(d);
    case 'requirement.archived':
      return '归档需求 ' + reqText(d) + (d.file ? ' → archive/' + d.file : '');
    case 'command.created':
      return '新增命令 ' + cmdText(d);
    case 'command.updated': {
      const fields = fieldsLabel(d.fields);
      return '编辑命令 ' + cmdText(d) + (fields ? '：' + fields : '');
    }
    case 'command.deleted':
      return '删除命令 ' + cmdText(d);
    case 'command.started':
      return '启动命令 ' + cmdText(d);
    case 'command.exited':
      return '命令 ' + cmdText(d) + (d.exitCode === 0 ? ' 正常退出' : ' 异常退出') +
        '（exit ' + (d.exitCode === undefined || d.exitCode === null ? '?' : d.exitCode) + '）';
    case 'command.stopped':
      return '手动停止命令 ' + cmdText(d);
    case 'command.spawn_failed':
      return '命令 ' + cmdText(d) + ' 启动失败：' + (d.message || '未知原因');
    case 'command.detached':
      return '命令 ' + cmdText(d) + ' 已分离' + (d.reason === 'stop_failed' ? '（停止失败，仍在运行）' : '');
    case 'command.recovered':
      return '命令 ' + cmdText(d) + ' 启动恢复：' + (RUN_STATUS[d.status] || d.status || '');
    case 'data.restored':
      return '从快照 ' + (d.backupName || '') + ' 恢复数据';
    case 'git.pulled':
      return '自动拉取' + projectText(d) + (d.commits ? '：更新 ' + d.commits + ' 个提交' : '：已是最新');
    case 'git.pull_failed':
      return '自动拉取' + projectText(d) + ' 失败：' + clip(d.message || '未知原因', 60);
    case 'settings.changed':
      // 通知设置与代码同步共用同一事件类型，按改动的键区分文案
      if (d.git) return '代码同步设置已更新';
      return '通知设置已更新';
    default:
      return eventTypeLabel(type);
  }
}

function dayKey(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'unknown';
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function dayLabel(key) {
  if (key === 'unknown') return '未知日期';
  const now = new Date();
  const today = dayKey(now.toISOString());
  const yesterday = dayKey(new Date(now.getTime() - 86400000).toISOString());
  if (key === today) return '今天';
  if (key === yesterday) return '昨天';
  const [y, m, d] = key.split('-');
  return (Number(y) === now.getFullYear() ? '' : y + '年') + Number(m) + '月' + Number(d) + '日';
}

/** 事件已按时间倒序；按本地自然日连续分组 */
export function groupByDay(events) {
  const out = [];
  let cur = null;
  for (const ev of events || []) {
    const key = dayKey(ev.at);
    if (!cur || cur.key !== key) {
      cur = { key, label: dayLabel(key), items: [] };
      out.push(cur);
    }
    cur.items.push(ev);
  }
  return out;
}

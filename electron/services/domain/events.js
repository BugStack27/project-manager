'use strict';

const store = require('../store');
const eventLog = require('../event-log');
const { agentNameMap } = require('./lookups');

/**
 * 给结果补 deleted 标记：实体已不在库里时审计行只展示快照，不提供跳转；
 * 同时把事件里的 AgentID 换成注册表里的名称（只改展示副本，不改事件文件）。
 */
function decorate(result) {
  const db = store.get();
  const names = agentNameMap();
  const projects = new Set(db.projects.map((p) => p.id));
  const requirements = new Set(db.requirements.map((r) => r.id));
  const commands = new Set(db.commands.map((c) => c.id));
  return {
    ...result,
    events: result.events.map((ev) => {
      const gone =
        (ev.projectId && !projects.has(ev.projectId)) ||
        (ev.requirementId && !requirements.has(ev.requirementId)) ||
        (ev.commandId && !commands.has(ev.commandId));
      const d = ev.data || {};
      const agentId = d.agent || (ev.actor && ev.actor.kind === 'agent' ? ev.actor.name : '');
      const agentName = names.get(agentId) || '';
      const out = gone ? { ...ev, deleted: true } : { ...ev };
      if (agentName) {
        if (ev.actor && ev.actor.kind === 'agent') out.actor = { ...ev.actor, name: agentName };
        out.data = { ...d, agentName };
      }
      return out;
    })
  };
}

function createEvents() {
  return {
    /** 查询事件：projectId / deletedOnly / category / type / actorKind / from / to / before / limit */
    events: (params) => decorate(eventLog.query(params || {})),

    /** 单条需求的时间线（倒序、before 游标） */
    requirementTimeline: ({ rid, before, limit }) =>
      decorate(eventLog.timeline(rid, { before, limit }))
  };
}

module.exports = { createEvents };

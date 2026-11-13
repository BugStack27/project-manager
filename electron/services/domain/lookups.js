'use strict';

const store = require('../store');
const { UNFINISHED } = require('./constants');
const { notFound } = require('./errors');

function findProject(id) {
  const p = store.get().projects.find((x) => x.id === id);
  if (!p) notFound('项目');
  return p;
}

function findCommand(id) {
  const c = store.get().commands.find((x) => x.id === id);
  if (!c) notFound('命令');
  return c;
}

function findReq(id) {
  const r = store.get().requirements.find((x) => x.id === id);
  if (!r) notFound('需求');
  return r;
}

/** 项目下所有未完成的需求（未开始 / 进行中 / 待审核），一个项目可以有多条 */
function unfinishedOf(projectId) {
  return store
    .get()
    .requirements.filter((r) => r.projectId === projectId && UNFINISHED.includes(r.status));
}

/**
 * AgentID → 名称：只给界面展示用，接口身份仍是 ID。
 * 注册表里找不到（已删除或历史自报名字）就返回空串，由调用方回落到原 ID。
 */
function agentNameMap() {
  const list = store.get().agents;
  const map = new Map();
  for (const a of Array.isArray(list) ? list : []) {
    map.set(a.id, a.name);
  }
  return map;
}

module.exports = { findProject, findCommand, findReq, unfinishedOf, agentNameMap };

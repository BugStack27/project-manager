'use strict';

/**
 * Agent 注册表：AgentID 由工作台生成，用户在「AI 接入 → Agent 管理」里创建，
 * 复制接入说明时把选中的 ID 写进提示词。这样 agent 不需要自己上报名字，
 * 也不会因为改名 / 多开重名而让已认领的任务找不回来。
 *
 * 技能目录只是 Agent 的一个**可选属性**，不是它的身份：
 * - 有 `skillDirs` → 扫描时把它们也纳入范围（只做加法，不会让技能消失）；
 * - 没有 / 为空 → 沿用全局扫描结果，行为与引入本字段之前完全一致；
 * - 它**不参与派发**：需求里的 `{UseSkill:id}` 始终全局解析，配错目录也不会派不出任务。
 * 同机多开时几个 AgentID 会共享同一个目录，这是正常的，界面负责把「共享」标出来。
 */

const fs = require('fs');
const store = require('../store');
const skillScan = require('../skill-scan');
const { nowIso } = require('./dates');
const { fail } = require('./errors');
const { assertAgent } = require('./validators');
const { samePath } = require('./paths');

/** 单个 Agent 允许挂的技能目录上限：再多基本是误操作，也拖慢扫描 */
const MAX_SKILL_DIRS = 8;
const DIR_MAX = 500;

function dirExists(p) {
  try {
    return fs.statSync(String(p)).isDirectory();
  } catch (_) {
    return false;
  }
}

/**
 * 目录列表归一化：接受字符串或 `{path}` 对象，去空、去重（分隔符 / 末尾斜杠 / Windows 大小写不敏感）、
 * 超过上限直接截断。**不校验存在性** —— 用户可以先把目录写上、之后再装客户端，
 * 存在与否由视图里的 `exists` 如实标出。
 */
function normalizeDirs(input) {
  const list = Array.isArray(input) ? input : input ? [input] : [];
  const out = [];
  for (const raw of list) {
    const p = String((raw && typeof raw === 'object' ? raw.path : raw) || '').trim();
    if (!p || p.length > DIR_MAX) continue;
    if (out.some((x) => samePath(x, p))) continue;
    out.push(p);
    if (out.length >= MAX_SKILL_DIRS) break;
  }
  return out;
}

function viewOf(a) {
  const dirs = Array.isArray(a.skillDirs) ? a.skillDirs : [];
  return {
    id: a.id,
    name: a.name,
    createdAt: a.createdAt,
    /** 归属的客户端家族（展示与默认目录来源用）；自定义 Agent 为 'custom' 或 null */
    client: a.client || null,
    /** 只读展示：带上每个目录当前是否真的存在，界面据此标失效 */
    skillDirs: dirs.map((p) => ({ path: p, exists: dirExists(p) }))
  };
}

/**
 * 注册表变化后立刻重扫：技能清单的范围只由「已添加 Agent 的目录」决定，
 * 所以加 / 改 / 删 Agent 都必须同步刷新，否则补全列表要等到下次启动才对。
 * 同步执行，单个目录的量级（几十项）可以接受；失败只记日志，不影响注册表本身。
 */
function refreshSkills(db) {
  try {
    const agents = Array.isArray(db.agents) ? db.agents : [];
    skillScan.rescan({ agentDirs: skillScan.agentDirList(agents), agents });
  } catch (e) {
    console.error('[agents] 技能重扫失败：' + e.message);
  }
}

function createAgents() {
  return {
    /** 已登记的 Agent：界面按名称展示，复制说明时用 id */
    agents: () => {
      const db = store.get();
      const list = Array.isArray(db.agents) ? db.agents.slice() : [];
      list.sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
      return { agents: list.map(viewOf) };
    },

    /**
     * 输入名称即创建：名称唯一（忽略大小写），ID 与项目 / 需求一样由 `store.uid('a')` 生成。
     * 名称只用于界面识别，真正传给 `/next`、`/claim` 等接口的是 ID。
     * `client` / `skillDirs` 可选：从「检测到的客户端」一键登记时带上，自定义 Agent 留空。
     */
    createAgent: ({ name, client, skillDirs }) => {
      const nm = assertAgent(name);
      const db = store.get();
      if (!Array.isArray(db.agents)) db.agents = [];
      if (db.agents.some((a) => String(a.name).toLowerCase() === nm.toLowerCase())) {
        fail('Agent 名称「' + nm + '」已存在', 'duplicate_agent', 409);
      }
      const agent = {
        id: store.uid('a'),
        name: nm,
        createdAt: nowIso(),
        client: client ? String(client).trim().slice(0, 32) : null,
        skillDirs: normalizeDirs(skillDirs)
      };
      db.agents.push(agent);
      store.save();
      refreshSkills(db);
      return { agent: viewOf(agent) };
    },

    /**
     * 改技能目录：整表替换（前端传完整列表，避免增量协议出分歧）。
     * 只影响扫描范围与展示，不改 AgentID，也不碰任何已认领的任务。
     */
    setAgentSkillDirs: ({ id, dirs }) => {
      const aid = assertAgent(id);
      const db = store.get();
      const list = Array.isArray(db.agents) ? db.agents : (db.agents = []);
      const agent = list.find((a) => a.id === aid);
      if (!agent) fail('Agent 不存在', 'not_found', 404);
      agent.skillDirs = normalizeDirs(dirs);
      store.save();
      refreshSkills(db);
      return { agent: viewOf(agent) };
    },

    /**
     * 从注册表移除：只影响后续可选项，已经认领 / 交付过的任务仍保留原 AgentID。
     * 正在跑的 agent 不受影响（接口只把 agent 当字符串，不校验注册表）。
     */
    deleteAgent: ({ id }) => {
      const aid = assertAgent(id);
      const db = store.get();
      const list = Array.isArray(db.agents) ? db.agents : (db.agents = []);
      const idx = list.findIndex((a) => a.id === aid);
      if (idx < 0) fail('Agent 不存在', 'not_found', 404);
      const agent = list[idx];
      list.splice(idx, 1);
      store.save();
      // 删掉的可能是某个目录的唯一使用者：清单要同步缩回去
      refreshSkills(db);
      return { ok: true, agent: viewOf(agent) };
    }
  };
}

module.exports = { createAgents, normalizeDirs, MAX_SKILL_DIRS };

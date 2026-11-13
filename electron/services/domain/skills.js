'use strict';

/**
 * 技能清单（本机环境缓存）的读取与重扫。
 *
 * 定位：这里只有「本机有哪些技能、各自在哪个目录、归哪些 Agent」，
 * 没有「某个 Agent 会什么」这种推断 —— 归属完全按用户在 Agent 卡片上配的目录算。
 * 派发也不看它：需求里的 `{UseSkill:id}` 始终全局解析。
 */

const store = require('../store');
const skillScan = require('../skill-scan');
const { fail } = require('./errors');

function createSkills() {
  return {
    /** 全量清单：输入框补全、Agent 卡片上的「N 个技能」都用它 */
    skills: () => {
      const db = store.get();
      return skillScan.view(db.agents || []);
    },

    /**
     * 本机装了哪些客户端（候选，不自动建 Agent）。
     * 附上该目录已经登记在哪些 Agent 名下，界面据此把「已登记」与「共享」标出来。
     */
    clients: () => {
      const db = store.get();
      const agents = Array.isArray(db.agents) ? db.agents : [];
      const list = skillScan.detectClients().map((c) => ({
        ...c,
        agents: skillScan.agentsForDir(c.dir, agents)
      }));
      return { clients: list };
    },

    /**
     * 单条查询（`/skill/<id>`）。
     * 查不到不抛 404：返回 `found:false` 让 agent 走「技能已不存在」的分支，
     * 抛错会把它逼成「重试/换名字」这种更糟的处理。
     */
    skill: ({ id }) => {
      const key = String(id || '').trim();
      if (!key) fail('缺少技能 id', 'missing_skill_id', 400);
      return { skill: skillScan.viewOne(key) };
    },

    /**
     * 重新扫描。用户随时可能装 / 删技能，只在启动扫一次会让补全长期停在旧快照上，
     * 所以这是一个可重复触发的动作（界面按钮与 `GET /skills/rescan` 共用）。
     * 范围**只有**已添加 Agent 自配的目录：没被添加的客户端不扫。
     */
    rescanSkills: () => {
      const db = store.get();
      const agents = Array.isArray(db.agents) ? db.agents : [];
      return skillScan.rescan({ agentDirs: skillScan.agentDirList(agents), agents });
    }
  };
}

module.exports = { createSkills };

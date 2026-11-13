import { loadAgentList, loadSkills } from '../lib/skill-refs.js';

/**
 * 技能悬浮窗：只摊开「它是谁 / 它做什么 / 归哪个 Agent」。
 * 目录路径与失效原因仍由 chip 自己的原生提示承担 —— 这里再抄一遍就会出现
 * 「两处说法不一样，用户不知道信哪个」。
 */
export default function SkillHoverCard({ skill, left, top }) {
  if (!skill) return null;

  const agents = skill.agentNames || [];

  return (
    <div className="skhover" style={{ left, top }} role="tooltip">
      <div className="sh-name">{skill.name}</div>
      <div className="sh-desc">{skill.description || '（这份技能没有写描述）'}</div>
      <div className="sh-agents">
        <span className="sh-label">所属 Agent</span>
        {agents.length ? (
          agents.map((n) => (
            <span className="sh-agent" key={n}>
              {n}
            </span>
          ))
        ) : (
          <span className="sh-agent none">未挂到任何 Agent</span>
        )}
      </div>
    </div>
  );
}

/**
 * 技能清单 + Agent 注册表：悬浮窗要显示的名字来自这两份进程内缓存。
 * 技能条目里的 `agents` 只有 id，名字得回注册表查。
 */
export function loadSkillIndex() {
  return Promise.all([loadSkills(), loadAgentList()]).then(([skills, agents]) => ({
    names: new Map(agents.map((a) => [a.id, a.name])),
    byId: new Map(skills.map((s) => [s.id, s]))
  }));
}

/**
 * 悬浮窗数据：需求上的解析结果只带 id 与描述，归属 Agent 从清单补齐。
 * 清单里查不到这条技能时按「没有归属」显示，不猜 —— 目录可能刚被删或重扫过。
 */
export function skillCardData(sk, index) {
  if (!sk || !sk.skillId) return null;
  const full = index && index.byId.get(sk.skillId);
  return {
    name: sk.name,
    description: sk.description || (full && full.description) || '',
    agentNames: ((full && full.agents) || []).map((id) => index.names.get(id) || id)
  };
}

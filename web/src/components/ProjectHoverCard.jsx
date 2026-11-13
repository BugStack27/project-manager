import { PROJECT_KIND_LABELS } from '../constants.js';
import { behindBadge } from '../lib/git-view.js';
import { ProjectIcon, ProjectStackList } from '../ui.jsx';

/**
 * 项目行悬停卡片：路径、技术栈、需求 / 候选 / 运行数与 git 提醒。
 * onEnter / onLeave 由持有开关的一方传入：卡片要能接住鼠标，划进来不能立刻被收掉。
 * 侧栏项目行与需求详情里的引用项目 chip 共用这一张卡，两边各传自己的开关。
 */
export default function ProjectHoverCard({ project, color, dirty, behind, left, top, onEnter, onLeave }) {
  if (!project) return null;

  const pending = project.pendingCount || 0;
  const flags = [];
  if (project.todoCount) flags.push({ text: '未开始 ' + project.todoCount, tone: '' });
  if (project.doingCount) flags.push({ text: '进行中 ' + project.doingCount, tone: '' });
  if (project.reviewCount) flags.push({ text: '待审核 ' + project.reviewCount, tone: 'hot' });
  if (project.questionCount) flags.push({ text: '待回答 ' + project.questionCount, tone: 'hot' });
  if (project.lockedCount) flags.push({ text: '锁定 ' + project.lockedCount, tone: 'alert' });
  if (dirty) flags.push({ text: '未提交 ' + dirty + ' 个文件', tone: 'warn' });
  if (behind) flags.push({ text: '远程 ' + behindBadge(behind), tone: 'warn' });
  if (project.aiScout === false) flags.push({ text: 'AI 巡检停用', tone: '' });

  const kind = PROJECT_KIND_LABELS[project.kind];
  const hasStacks = Array.isArray(project.stacks) && project.stacks.length > 0;

  return (
    <div className="phover" style={{ left, top }} onMouseEnter={onEnter} onMouseLeave={onLeave} role="tooltip">
      <div className="ph-head">
        <ProjectIcon project={project} color={color} size={30} />
        <div className="ph-title">
          <div className="ph-name">{project.name}</div>
          <ProjectStackList project={project} size={11} />
          {hasStacks ? null : <span className="ph-kind">{kind || '未识别技术栈'}</span>}
        </div>
      </div>

      <div className="ph-path">{project.path}</div>

      <div className="ph-stats">
        <div className="ph-stat">
          <span className="ph-stat-num">{pending}</span>
          <span className="ph-stat-label">未完成</span>
        </div>
        <div className="ph-stat">
          <span className="ph-stat-num">{project.candidateCount || 0}</span>
          <span className="ph-stat-label">候选池</span>
        </div>
        <div className="ph-stat">
          <span className="ph-stat-num">{project.runningCount || 0}</span>
          <span className="ph-stat-label">运行中</span>
        </div>
      </div>

      {flags.length ? (
        <div className="ph-flags">
          {flags.map((f) => (
            <span key={f.text} className={'ph-flag' + (f.tone ? ' ' + f.tone : '')}>
              {f.text}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

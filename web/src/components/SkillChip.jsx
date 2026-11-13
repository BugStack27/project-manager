import { skillMissing, skillTip } from '../lib/skill-refs.js';
import { hoverProps } from './HoverCardLayer.jsx';

/**
 * 技能 chip：正文与往返记录（两侧都走 markdown 渲染）共用同一个外观与说明。
 * 技能没有可跳转的落地页（它只是一份目录约定），所以是 span 而不是按钮 ——
 * 长得像按钮却点不动比不做成按钮更糟。
 * 悬停出信息窗（名字 / 描述 / 归属 Agent），与引用项目那张卡同一套交互；
 * 出卡时不再挂原生 title（两套一起弹很碍眼），解析不到或目录已不在仍按原样说明原因。
 */
export default function SkillChip({ name, skill }) {
  const hover = hoverProps.skill(skill);
  return (
    <span
      className={'ref-chip skill' + (skillMissing(skill) ? ' miss' : '')}
      {...hover}
      title={hover ? undefined : skillTip(skill)}
    >
      {'/' + name}
    </span>
  );
}

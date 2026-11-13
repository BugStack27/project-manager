import { findSkill, skillMissing, skillTip } from '../lib/skill-refs.js';

/**
 * 技能 chip：正文与往返记录（两侧都走 markdown 渲染）共用同一个外观与说明。
 * 技能没有可跳转的落地页（它只是一份目录约定），所以是 span 而不是按钮 ——
 * 长得像按钮却点不动比不做成按钮更糟。
 */
export default function SkillChip({ name, skill }) {
  return (
    <span
      className={'ref-chip skill' + (skillMissing(skill) ? ' miss' : '')}
      title={skillTip(skill)}
    >
      {'/' + name}
    </span>
  );
}

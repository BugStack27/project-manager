'use strict';

/**
 * 候选池不是流程中的一站，而是「想法还没被确认」的入口：
 * AI 巡检提的需求、用户勾了「候选」的需求都停在这里，不参与派发、不派给任何 agent。
 * 采纳（→ todo）之后才进流程，所以它排在 todo 之前而不是五个流程状态之一。
 */
const CANDIDATE = 'candidate';
const STATUSES = [CANDIDATE, 'todo', 'doing', 'review', 'done', 'rejected'];
/** 未完成状态：待审核也要算，否则 agent 交付后用户不验收就能连续开工；候选不在其中（还没确认） */
const UNFINISHED = ['todo', 'doing', 'review'];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const GIT_COMMIT_LIMIT_MAX = 200;
const STATS_MAX_DAYS = 62;
/** 探测命令（isRepo / branch）的超时：网络盘或仓库锁不能把整页统计挂住 */
const PROBE_TIMEOUT = 5000;
/**
 * 释放后的冷却期：释放意味着「这个 agent 做不下去」，冷却期内不再派给同一个人，
 * 否则每分钟一次的定时任务会在同一条需求上原地打转。别的 agent 不受影响。
 */
const RELEASE_COOLDOWN = 30 * 60 * 1000;

module.exports = {
  CANDIDATE,
  STATUSES,
  UNFINISHED,
  DATE_RE,
  GIT_COMMIT_LIMIT_MAX,
  STATS_MAX_DAYS,
  PROBE_TIMEOUT,
  RELEASE_COOLDOWN
};

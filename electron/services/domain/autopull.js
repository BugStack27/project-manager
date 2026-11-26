'use strict';

const fs = require('fs');
const store = require('../store');
const runner = require('../runner');
const git = require('../git');
const eventLog = require('../event-log');
const { readGitSettings } = require('./settings');
const { noteAuthError, notePulled } = require('./remote-check');

const { actor } = eventLog;

/** 同时进行的仓库数：启动阶段不能把网络与磁盘打满，3 个足够覆盖常见项目数 */
const CONCURRENCY = 3;

/** 进程内状态：同一时刻只跑一轮，界面重复点「立即执行」复用同一份结果 */
let inflight = null;
let lastRun = null;
/** 本轮逐项目进度：只在运行期间有值，代码同步弹窗轮询 autoPullStatus 拿它画实时列表 */
let progress = null;

/** 项目级设置优先，未设置则跟随全局开关 */
function isEnabled(project, globalOn) {
  if (typeof project.autoPull === 'boolean') return project.autoPull;
  return !!globalOn;
}

/** 该项目是否有命令在跑：pull 会换掉工作区文件，运行中的构建 / 开发服务必须先排除 */
function isBusy(projectId) {
  return store.get().commands.some((c) => c.projectId === projectId && runner.isActive(c));
}

/** 三种结局共用同一个形状，界面与审计按 status / code 分支 */
const pulled = (base, commits, upstream) => ({ ...base, status: 'pulled', code: null, message: null, commits, upstream });
const skipped = (base, code, message) => ({ ...base, status: 'skipped', code, message });
const failed = (base, code, message) => ({ ...base, status: 'failed', code, message });

/**
 * 单个项目的拉取。
 * 语义与界面上的手动拉取完全一致（pullFastForward），失败一律降级为「跳过 / 失败」记录，
 * 绝不弹窗、不 stash、不 resolve 冲突——启动阶段的后台动作不该打断用户。
 */
async function pullOne(project) {
  const base = { projectId: project.id, name: project.name };
  if (isBusy(project.id)) return skipped(base, 'busy', '有命令正在运行');
  // 目录被移动 / 删除的项目不在启动阶段报错，跳过即可——界面进项目时自然会提示
  if (!fs.existsSync(project.path)) return skipped(base, 'path_missing', '项目路径不存在');

  const probe = await git.isRepo(project.path);
  if (probe.unavailable) return failed(base, 'git_unavailable', '未检测到 git 可执行程序');
  if (!probe.repo) return skipped(base, 'not_repo', '不是 git 仓库');

  try {
    const beforeSha = await git.headSha(project.path);
    const res = await git.pullFastForward(project.path);
    const afterSha = await git.headSha(project.path);
    const commits = await git.countCommits(project.path, beforeSha, afterSha);
    // 拉完落后数必为 0：当场刷新巡检缓存，否则侧栏的「有更新」灯会亮到下一轮巡检
    notePulled(project.id);
    // 已经是最新：pull 会白跑一次网络，结果按「跳过」记，避免每次启动都写一条审计
    if (!commits) return skipped(base, 'up_to_date', '已是最新');
    return pulled(base, commits, res.upstream);
  } catch (e) {
    const code = (e && e.code) || 'pull_failed';
    // 凭据失效：落进巡检缓存，界面顶部的「Git 需要登录」提示条据此亮起（用户自己去登录）
    if (code === 'auth_failed') noteAuthError(project.id, (e && e.message) || '拉取需要登录远程仓库');
    // 工作区脏 / 无上游 / 已分叉属于「本就不该自动拉」的正常情况，不算失败
    const normal = code === 'dirty_worktree' || code === 'no_upstream' || code === 'not_fast_forward';
    const message = (e && e.message) || '拉取失败';
    return normal ? skipped(base, code, message) : failed(base, code, message);
  }
}

/** 只记录有信息量的事件：拉到了提交、或真的失败了；「跳过」是常态，不写审计 */
function logItem(item) {
  if (item.status !== 'pulled' && item.status !== 'failed') return;
  eventLog.append({
    type: item.status === 'pulled' ? 'git.pulled' : 'git.pull_failed',
    projectId: item.projectId,
    actor: actor.system('自动拉取'),
    data: {
      projectName: item.name,
      name: item.name,
      commits: item.commits || 0,
      code: item.code || null,
      message: item.message || null
    }
  });
}

/** 进度条目按项目 id 定位：并发 worker 完成顺序与列表顺序不一致，只能按 id 回写 */
function setItem(projectId, patch) {
  if (!progress) return;
  const it = progress.items.find((x) => x.projectId === projectId);
  if (it) Object.assign(it, patch);
}

/** 限并发跑完全部候选项目，保持与 db 中项目顺序一致的结果列表；顺带维护逐项目进度 */
async function runAll(projects) {
  const results = new Array(projects.length);
  let cursor = 0;

  async function worker() {
    for (;;) {
      const i = cursor++;
      if (i >= projects.length) return;
      const p = projects[i];
      setItem(p.id, { state: 'running' });
      try {
        results[i] = await pullOne(p);
      } catch (e) {
        results[i] = failed({ projectId: p.id, name: p.name }, 'internal_error', (e && e.message) || '内部错误');
      }
      setItem(p.id, { ...results[i], state: 'done' });
      if (progress) progress.done += 1;
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, projects.length) }, worker));
  return results;
}

function summarize(items, trigger, startedAt) {
  const count = (s) => items.filter((x) => x.status === s).length;
  return {
    trigger,
    startedAt,
    finishedAt: new Date().toISOString(),
    total: items.length,
    pulled: count('pulled'),
    skipped: count('skipped'),
    failed: count('failed'),
    commits: items.reduce((n, x) => n + (x.commits || 0), 0),
    items
  };
}

async function runOnce(projects, trigger, startedAt) {
  progress = {
    trigger,
    startedAt,
    total: projects.length,
    done: 0,
    items: projects.map((p) => ({ projectId: p.id, name: p.name, state: 'waiting' }))
  };
  try {
    const items = await runAll(projects);
    items.forEach(logItem);
    lastRun = summarize(items, trigger, startedAt);
    return lastRun;
  } finally {
    // 进度只服务于「正在同步」这段等待；结束后轮询方拿到的就是 running:false
    progress = null;
  }
}

function createAutoPull() {
  return {
    /**
     * 最近一轮结果 + 本轮进度：界面打开设置时展示「上次拉了什么」，
     * 一键拉取期间轮询这里拿到逐项目状态（等待 / 正在同步 / 已完成）。
     */
    autoPullStatus: () => ({ running: !!inflight, last: lastRun, progress }),

    /**
     * 跑一轮自动拉取（启动时由主进程触发，也可由设置弹窗手动触发）。
     * 总开关关且没有项目单独开启时直接返回空结果，不碰 git、不联网。
     * force 是给「一键拉取」用的：手点下去就不受「启动自动拉取」开关拦截。
     * projectIds 由「一键拉取」传入界面列出的「有更新」项目：只同步这些仓库，
     * 不能顺手把已经是最新的仓库也挨个拉一遍网络；不传则按开关整批跑（启动场景）。
     */
    autoPullNow: ({ trigger, force, projectIds } = {}) => {
      if (inflight) return inflight;

      const db = store.get();
      const globalOn = readGitSettings(db).autoPullOnLaunch;
      const wanted = Array.isArray(projectIds) ? new Set(projectIds) : null;
      const projects = db.projects.filter(
        (p) => !p.archived && (force || isEnabled(p, globalOn)) && (!wanted || wanted.has(p.id))
      );
      const startedAt = new Date().toISOString();

      // 先挂到 inflight 再跑：并发调用方（主进程启动 + 界面手动触发）共用同一轮结果
      inflight = runOnce(projects, trigger || 'launch', startedAt).finally(() => {
        inflight = null;
      });
      return inflight;
    }
  };
}

module.exports = { createAutoPull };

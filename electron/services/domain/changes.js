'use strict';

const git = require('../git');
const { GIT_COMMIT_LIMIT_MAX } = require('./constants');
const { fail } = require('./errors');
const { assertSha, assertRelPath } = require('./validators');
const { findProject } = require('./lookups');
const { noteRemote, noteAuthError, notePulled, recheck, isRemoteFresh } = require('./remote-check');
const { bump: notifyTaskAvailable } = require('./next-waiter');

/**
 * git 仓库探测：目录失效 → 409 path_missing；无 git → 501。
 * 返回 { repo, prefix } —— prefix 是 probe 同一次 spawn 的副产物，
 * 后面的 git 调用直接用它，不必各自再跑一遍 rev-parse（那一次就是 ~180ms）。
 */
async function probeRepo(p) {
  const pr = await git.probe(p.path);
  // 路径被移动 / 删除时 git 会报 ENOENT，若不加这一步就会被当成「没装 git」，
  // 用户去查环境而不是改路径 —— 所以先给一个专门的失效码。
  if (pr.missing) fail('项目路径不存在：' + p.path + '，请检查目录是否被移动或删除', 'path_missing', 409);
  if (pr.unavailable) fail('未检测到 git 可执行程序', 'git_unavailable', 501);
  return { repo: !!pr.repo, prefix: pr.prefix || '' };
}

/**
 * @param {() => object} [getMethods] 运行时取整张能力表：提交成功后要调
 *   linkRequirementCommit 把 hash 写回需求，避免模块间直接互引（与 mobile 同一模式）
 */
function createChanges(getMethods) {
  return {
    /* ── 修改记录（git：只读 + 快进拉取 + 推送当前分支 + 提交本地改动，后三者是仅有的写操作） ── */

    gitCommits: async ({ id, limit, skip }) => {
      const p = findProject(id);
      const pr = await probeRepo(p);
      if (!pr.repo) {
        return { isRepo: false, branch: null, commits: [], hasMore: false, limit: 0, skip: 0 };
      }
      const lim = Math.min(Math.max(parseInt(limit, 10) || 30, 1), GIT_COMMIT_LIMIT_MAX);
      const sk = Math.max(parseInt(skip, 10) || 0, 0);
      // 分支名与提交列表互不依赖：并行起进程，不必等 log 跑完再问一次 HEAD
      const [{ commits, hasMore }, branch] = await Promise.all([
        git.commits(p.path, { limit: lim, skip: sk, prefix: pr.prefix }),
        git.branch(p.path)
      ]);
      return { isRepo: true, branch, commits, hasMore, limit: lim, skip: sk };
    },

    gitChanges: async ({ id }) => {
      const p = findProject(id);
      const pr = await probeRepo(p);
      if (!pr.repo) {
        return {
          isRepo: false,
          branch: null,
          clean: true,
          counts: { total: 0, staged: 0, unstaged: 0, untracked: 0, added: 0, removed: 0 },
          files: []
        };
      }
      const data = await git.changes(p.path, { prefix: pr.prefix });
      return { isRepo: true, ...data };
    },

    gitDiff: async ({ id, path: relPath, untracked }) => {
      const p = findProject(id);
      const pth = assertRelPath(relPath);
      if (!(await probeRepo(p)).repo) {
        return { isRepo: false, path: pth, untracked: false, binary: false, diff: '', content: '', truncated: false };
      }
      const data = await git.fileDiff(p.path, pth, !!untracked);
      return { isRepo: true, diff: '', content: '', ...data };
    },

    gitCommitFiles: async ({ id, sha }) => {
      const p = findProject(id);
      const s = String(sha || '').trim();
      if (!(await probeRepo(p)).repo) return { isRepo: false, sha: s, files: [], body: '' };
      const data = await git.commitFiles(p.path, assertSha(s));
      return { isRepo: true, ...data };
    },

    gitCommitDiff: async ({ id, sha, path: relPath }) => {
      const p = findProject(id);
      const s = assertSha(sha);
      const pth = assertRelPath(relPath);
      if (!(await probeRepo(p)).repo) {
        return { isRepo: false, sha: s, path: pth, binary: false, diff: '', truncated: false };
      }
      const data = await git.commitFileDiff(p.path, s, pth);
      return { isRepo: true, ...data };
    },

    /**
     * 远程追踪位置；fetch=true 时先静默抓取（失败只降级，不抛错）；附带所有远程仓库地址。
     * 后台巡检刚抓过同一个仓库时直接采信它的缓存、不再联网；force 是刷新按钮的入口 ——
     * 手动点下去就说明此刻想要最新数字。两种情况下「落后几个」都取自本地引用，
     * 所以数字与侧栏的灯始终是同一个口径。
     */
    gitRemote: async ({ id, fetch, force }) => {
      const p = findProject(id);
      const empty = {
        isRepo: false,
        hasUpstream: false,
        upstream: null,
        remoteName: null,
        ahead: 0,
        behind: 0,
        sha: null,
        commits: [],
        truncated: false,
        remotes: [],
        fetched: null,
        remoteFresh: false
      };
      const pr = await probeRepo(p);
      if (!pr.repo) return empty;
      const fresh = isRemoteFresh(p.id);
      // 复用巡检缓存时 fetched 仍报 ok：位置确实来自一次成功的抓取，只是不在这次请求里
      const reuse = !!fetch && !force && fresh;
      const fetched = !fetch
        ? null
        : reuse
          ? { ok: true, reused: true, error: null }
          : await git.fetchRemote(p.path);
      const [data, rem] = await Promise.all([
        git.remoteStatus(p.path, { prefix: pr.prefix }),
        git.remotes(p.path)
      ]);
      // 这次抓取的费用已经付过了：结果直接落巡检缓存，侧栏的灯与这里是同一个数字
      if (fetched && fetched.ok && !reuse) noteRemote(p.id, data);
      // 凭据失效也落缓存：下一次 gitSummary 轮询就能把「需要登录」提示条亮出来
      if (fetched && fetched.auth) noteAuthError(p.id, fetched.error);
      // remoteFresh 告诉界面「再发一次 fetch 也只会拿到同一份数据」，让它整段跳过第二次请求
      return { isRepo: true, fetched, remoteFresh: fresh, ...data, remotes: rem.remotes };
    },

    /** 快进拉取：工作区脏 / 无上游 / 分叉都会抛错，不做兜底 */
    gitPull: async ({ id }) => {
      const p = findProject(id);
      if (!(await probeRepo(p)).repo) fail('该项目不是 git 仓库', 'not_repo', 409);
      const res = await git.pullFastForward(p.path).catch((e) => {
        if (e && e.code === 'auth_failed') noteAuthError(p.id, e.message);
        throw e;
      });
      // 快进成功 ⇒ 已与上游齐平：立刻把落后数清零，别让灯亮到下一轮巡检
      notePulled(p.id);
      // 拉取可能让工作区变干净（原本被 dirty 挡住的项目重新可派）
      notifyTaskAvailable();
      return res;
    },

    /** 推送当前分支到上游：不 force、不推其它分支 */
    gitPush: async ({ id }) => {
      const p = findProject(id);
      if (!(await probeRepo(p)).repo) fail('该项目不是 git 仓库', 'not_repo', 409);
      const res = await git.pushCurrent(p.path).catch((e) => {
        if (e && e.code === 'push_auth') noteAuthError(p.id, e.message);
        throw e;
      });
      // 推送不改落后数，但期间别人可能推了新提交：后台重查一次，不拖慢这次响应
      recheck(p);
      return res;
    },

    /**
     * 提交项目目录内全部改动：自动暂存后提交到本地，不推送。
     * 带了 requirementId 且本次确实产生新提交时，顺手把 hash 记到需求上 ——
     * hash 只有这一刻拿得到，漏掉就只能靠人补；关联失败只记日志，不改写提交结果。
     */
    gitCommit: async ({ id, message, requirementId }) => {
      const p = findProject(id);
      if (!(await probeRepo(p)).repo) fail('该项目不是 git 仓库', 'not_repo', 409);
      const res = await git.commitAll(p.path, message);
      if (requirementId && res && res.sha) {
        try {
          const methods = typeof getMethods === 'function' ? getMethods() : null;
          if (methods && typeof methods.linkRequirementCommit === 'function') {
            methods.linkRequirementCommit({
              rid: requirementId,
              projectId: p.id,
              sha: res.sha,
              subject: res.subject
            });
          }
        } catch (e) {
          process.stderr.write('[changes] 关联需求提交失败：' + ((e && e.message) || e) + '\n');
        }
      }
      // 提交后工作区可能变干净：唤醒挂起的 /next，别让项目一直停在 dirty 阻断上
      notifyTaskAvailable();
      return res;
    }
  };
}

module.exports = { createChanges };

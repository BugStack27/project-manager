import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { buildCommitMessage } from '../lib/commit-message.js';
import { GIT_PAGE } from '../lib/page-meta.js';

/**
 * 修改记录的全部状态与动作：提交列表、工作区改动、远程位置、diff 详情、拉取 / 推送 / 提交。
 * pid / pidRef 由外部传入：切项目既要清空本地状态，也要让在途响应按序号丢弃。
 */
export function useGit({ pid, pidRef, page, projects, notify, setModal, openRight, reloadRequirements }) {
  const [gitCommits, setGitCommits] = useState([]);
  /** gitCommits 属于哪个项目：与提交列表同批更新，供外部深链判断「数据是否已换成目标项目的」 */
  const [gitStatePid, setGitStatePid] = useState(null);
  const [gitChanges, setGitChanges] = useState(null);
  const [gitRemote, setGitRemote] = useState(null);
  const [gitPulling, setGitPulling] = useState(false);
  const [gitPushing, setGitPushing] = useState(false);
  const [gitHasMore, setGitHasMore] = useState(false);
  const [gitLoading, setGitLoading] = useState(false);
  const [gitRefreshing, setGitRefreshing] = useState(false);
  const [gitLoadingMore, setGitLoadingMore] = useState(false);
  const [gitUnavailable, setGitUnavailable] = useState(false);
  const [gitError, setGitError] = useState(null);
  /** gitError 的错误码：界面据此区分「没装 git / 路径失效 / 其它失败」 */
  const [gitErrorCode, setGitErrorCode] = useState(null);
  const [gitSummary, setGitSummary] = useState(null);
  const [gitOpen, setGitOpen] = useState({ working: true, commits: true });
  const [gitCommitFiles, setGitCommitFiles] = useState({});
  const [sel, setSel] = useState(null);
  const [content, setContent] = useState(null);

  /** 上次拿到 git 汇总的时间戳：切换页面时避免重复请求 */
  const summaryAt = useRef(0);
  /** git 加载序号：切项目 / 二次 fetch 校准后丢弃过期响应 */
  const gitSeq = useRef(0);
  /** 当前状态里已有数据的项目 id：再次进页时走后台刷新，不整页 loading */
  const gitLoadedPid = useRef(null);
  /** 按项目缓存的最近一次快照：切回看过的项目先渲染它自己的旧数据，再后台刷新 */
  const gitCache = useRef(new Map());
  /** 正在静默预取的项目：启动扫描与选项目预取可能撞车，同一项目只跑一份 */
  const prefetching = useRef(new Set());
  /** 启动预热是否已发起：项目列表会随轮询刷新，只扫一遍 */
  const prefetchedAll = useRef(false);
  /** 最近一次 git 加载开始的时间：窗口重新聚焦时据此跳过刚拉过的数据 */
  const lastLoadAt = useRef(0);

  /** 全项目未提交改动统计（侧栏角标，失败静默） */
  const loadGitSummary = useCallback(async () => {
    try {
      const data = await api.gitSummary();
      summaryAt.current = Date.now();
      setGitSummary(data);
    } catch (_) {
      setGitSummary(null);
    }
  }, []);

  /**
   * 第一段：提交 + 改动 + 本地已知的远程位置，拿到就渲染（这步不联网）。
   * 第二段：静默 fetch 后校准远程位置，最长 15s，失败保持第一段的数字并标 stale。
   *   后台巡检刚抓过远程（remoteFresh）时整段跳过：fetch 反正会被复用，白跑一轮 remoteStatus。
   * 两段共用一个序号：切项目 / 重新加载时旧响应一律丢弃。
   * background：已有内容时原地刷新，不清空旧数据、不显示整页 loading，只让刷新按钮转圈。
   * force：跳过后台巡检的远程缓存强制联网 —— 只有用户手动点刷新时才传。
   */
  const loadGit = useCallback(async (id, { background = false, force = false } = {}) => {
    if (!id) return;
    lastLoadAt.current = Date.now();
    const seq = ++gitSeq.current;
    if (background) setGitRefreshing(true);
    else {
      setGitRefreshing(false);
      setGitLoading(true);
    }
    let isRepo = false;
    /** 巡检缓存是否新鲜：后端据此会在第二段直接复用缓存，那么第二段就没必要再发一次 */
    let remoteFresh = false;
    try {
      const [c, ch, rm] = await Promise.all([
        api.gitCommits(id, GIT_PAGE, 0),
        api.gitChanges(id),
        api.gitRemote(id, false)
      ]);
      if (seq !== gitSeq.current) return;
      setGitCommits(c.commits || []);
      setGitStatePid(id);
      setGitHasMore(!!c.hasMore);
      setGitChanges(ch);
      setGitRemote(rm);
      setGitUnavailable(false);
      setGitError(null);
      setGitErrorCode(null);
      gitLoadedPid.current = id;
      gitCache.current.set(id, {
        commits: c.commits || [],
        hasMore: !!c.hasMore,
        changes: ch,
        remote: rm
      });
      isRepo = !!rm.isRepo;
      remoteFresh = !!rm.remoteFresh;
    } catch (e) {
      if (seq !== gitSeq.current) return;
      if (e.status === 501) {
        gitLoadedPid.current = null;
        setGitUnavailable(true);
        setGitError(null);
        setGitErrorCode(null);
        setGitCommits([]);
        setGitStatePid(id);
        setGitChanges(null);
        setGitRemote(null);
        gitCache.current.delete(id);
      } else {
        setGitError(e.message);
        setGitErrorCode(e.code || null);
      }
      return;
    } finally {
      if (seq === gitSeq.current) {
        setGitLoading(false);
        setGitRefreshing(false);
      }
    }
    // 不是仓库没什么可比的；巡检缓存新鲜时，第二段那次 fetch 后端也只会复用缓存，
    // 发过去换回同一份数据 —— 而它自己是一整轮 remoteStatus（5 个 git 进程 ≈ 740ms），
    // 所以这里直接跳过。手动刷新（force）例外：用户要的就是「此刻最新」。
    if (!isRepo || (remoteFresh && !force)) return;

    try {
      const rm = await api.gitRemote(id, true, force);
      if (seq !== gitSeq.current) return;
      setGitRemote(rm);
      const cached = gitCache.current.get(id);
      if (cached) gitCache.current.set(id, { ...cached, remote: rm });
      // 凭据失效：后端已把「需要登录」落进巡检缓存，立刻校准一次汇总，
      // 顶部的「Git 需要登录」提示条不必等到下一轮 30s 轮询才出现
      if (rm && rm.fetched && rm.fetched.auth) loadGitSummary();
    } catch (e) {
      // 整个调用失败（不只是 fetch 失败）也要标 stale，别让用户以为数字是新的
      if (seq !== gitSeq.current) return;
      setGitRemote((r) =>
        r ? { ...r, fetched: { ok: false, timedOut: false, error: e.message || '抓取远程失败' } } : r
      );
    }
  }, [loadGitSummary]);

  /** 用某个项目的缓存快照填充当前状态（不发起请求，只接管已经拉到手的本地数据） */
  const applyCached = useCallback((snap, id) => {
    setGitCommits(snap.commits);
    setGitStatePid(id);
    setGitHasMore(!!snap.hasMore);
    setGitChanges(snap.changes);
    setGitRemote(snap.remote);
    setGitUnavailable(false);
    setGitError(null);
    setGitErrorCode(null);
    gitLoadedPid.current = id;
  }, []);

  /**
   * 静默预取单个项目：只写缓存，不碰当前页面的 state，也不做联网 fetch
   * （15s 静默 fetch 留给真正进页后的后台刷新，避免开机时对每个项目都打一次网络）。
   */
  const prefetchGit = useCallback(async (id) => {
    if (!id || gitCache.current.has(id) || prefetching.current.has(id)) return;
    prefetching.current.add(id);
    try {
      const [c, ch, rm] = await Promise.all([
        api.gitCommits(id, GIT_PAGE, 0),
        api.gitChanges(id),
        api.gitRemote(id, false)
      ]);
      // 预取期间该项目已被正式加载过：缓存里已是更新的一份，别用旧快照覆盖
      if (gitLoadedPid.current === id) return;
      gitCache.current.set(id, {
        commits: c.commits || [],
        hasMore: !!c.hasMore,
        changes: ch,
        remote: rm
      });
    } catch (_) {
      // 预取失败静默：真进页时 loadGit 会重拉并给出错误态
    } finally {
      prefetching.current.delete(id);
    }
  }, []);

  const loadMoreGit = useCallback(async () => {
    if (!pid || gitLoadingMore || !gitHasMore) return;
    const target = pid;
    setGitLoadingMore(true);
    try {
      const c = await api.gitCommits(target, GIT_PAGE, gitCommits.length);
      if (pidRef.current !== target) return; // 翻页期间切了项目，别把旧项目的提交追进来
      const next = gitCommits.concat(c.commits || []);
      setGitCommits(next);
      setGitHasMore(!!c.hasMore);
      const cached = gitCache.current.get(target);
      if (cached) gitCache.current.set(target, { ...cached, commits: next, hasMore: !!c.hasMore });
    } catch (e) {
      notify(e.message, 'warn');
    } finally {
      setGitLoadingMore(false);
    }
  }, [pid, pidRef, gitLoadingMore, gitHasMore, gitCommits.length, notify]);

  /** 打开提交详情：按需拉取该提交的文件清单 + 正文（同一提交只拉一次，失败可重试） */
  const loadCommitFiles = useCallback(
    async (sha) => {
      if (!pid) return;
      const prev = gitCommitFiles[sha];
      if (prev && !prev.error) return;
      const target = pid;
      setGitCommitFiles((m) => ({ ...m, [sha]: { loading: true } }));
      try {
        const res = await api.gitCommitFiles(target, sha);
        if (pidRef.current !== target) return;
        setGitCommitFiles((m) => ({
          ...m,
          [sha]: { loading: false, files: res.files || [], body: res.body || '' }
        }));
      } catch (e) {
        if (pidRef.current !== target) return;
        setGitCommitFiles((m) => ({ ...m, [sha]: { loading: false, error: e.message, files: [], body: '' } }));
      }
    },
    [pid, pidRef, gitCommitFiles]
  );

  /** 选中一条提交：右面板显示提交说明与本次改动的文件清单 */
  const openCommitDetail = useCallback(
    (sha) => {
      const pool = ((gitRemote && gitRemote.commits) || []).concat(gitCommits);
      const c = pool.find((x) => x.sha === sha);
      if (!c) return;
      loadCommitFiles(sha);
      setSel({
        kind: 'commit-info',
        sha: c.sha,
        shortSha: c.shortSha,
        subject: c.subject,
        author: c.author,
        committedAt: c.committedAt
      });
      openRight();
    },
    [gitCommits, gitRemote, loadCommitFiles, openRight]
  );

  function toggleGitGroup(kind) {
    setGitOpen((s) => ({ ...s, [kind]: !s[kind] }));
  }

  /** 选中「当前改动」里的某个文件：右面板显示该文件 diff */
  const openFile = useCallback(
    async (file) => {
      if (!pid) return;
      const key = 'working|' + file.path;
      setSel({ kind: 'working', path: file.path, file });
      setContent({ key, loading: true, file });
      // 改动内容在右面板，面板收起时点文件等于点了没反应，故自动展开
      openRight();
      try {
        const res = await api.gitDiff(pid, file.path, file.untracked);
        setContent((c) => (c && c.key === key ? { key, loading: false, file, data: res } : c));
      } catch (e) {
        setContent((c) => (c && c.key === key ? { key, loading: false, file, error: e.message } : c));
      }
    },
    [pid, openRight]
  );

  // 切换项目的一次性重置：作废在途的 git 请求（序号），清空展开态 / 选中态，
  // 数据换成目标项目自己的缓存快照（没有就留空等整页加载）——绝不能留上一个项目的数据冒充新项目。
  // pid 镜面由 useProjects 维护，这里只读。
  useEffect(() => {
    const cached = pid ? gitCache.current.get(pid) : null;
    gitSeq.current += 1;
    setGitOpen({ working: true, commits: true });
    setGitCommitFiles({});
    if (cached) {
      applyCached(cached, pid);
    } else {
      setGitCommits([]);
      setGitStatePid(null);
      setGitChanges(null);
      setGitRemote(null);
      setGitHasMore(false);
      gitLoadedPid.current = null;
      setGitError(null);
      setGitErrorCode(null);
    }
    setGitLoading(false);
    setGitRefreshing(false);
    setGitUnavailable(false);
    setSel(null);
    setContent(null);
  }, [pid, applyCached]);

  useEffect(() => {
    if (page !== 'changes' || !pid) return;
    // 启动预热可能已经写好了这个项目的快照（此时 state 还是空的）：先接管，再后台校准
    const cached = gitCache.current.get(pid);
    if (cached && gitLoadedPid.current !== pid) applyCached(cached, pid);
    loadGit(pid, { background: gitLoadedPid.current === pid });
  }, [page, pid, loadGit, applyCached]);

  // 选中项目、预取还没轮到它（比如刚建的项目）：静默补一次；正在看修改记录时交给上面的进页 effect
  useEffect(() => {
    if (!pid || page === 'changes') return;
    prefetchGit(pid);
  }, [pid, page, prefetchGit]);

  // 启动预热：应用打开后把所有项目逐个静默预取一遍（串行，避免一次起一堆 git 进程），
  // 之后进哪个项目都能直接命中缓存。只扫一遍，不跟项目轮询走。
  useEffect(() => {
    if (prefetchedAll.current || !projects || !projects.length) return;
    prefetchedAll.current = true;
    (async () => {
      for (const p of projects) await prefetchGit(p.id);
    })();
  }, [projects, prefetchGit]);

  // 侧栏「修改记录」角标常驻：首次加载后每 30s 刷新（该接口会给每个项目起一次 git 进程，不宜高频）
  useEffect(() => {
    loadGitSummary();
    const t = setInterval(loadGitSummary, 30000);
    return () => clearInterval(t);
  }, [loadGitSummary]);

  // 切到修改记录页时立刻校准项目行角标（数据足够新则跳过，避免与首屏/轮询重复请求）
  useEffect(() => {
    if (page !== 'changes') return;
    if (Date.now() - summaryAt.current < 3000) return;
    loadGitSummary();
  }, [page, loadGitSummary]);

  // 进入总览时校准 git 汇总（与修改记录页同策略，30s 内不重复拉）
  useEffect(() => {
    if (page !== 'overview') return;
    if (Date.now() - summaryAt.current < 3000) return;
    loadGitSummary();
  }, [page, loadGitSummary]);

  /**
   * 修改记录项目信息条右端的刷新：后台重拉 git 改动与角标汇总，旧内容保持可见。
   * force 只走按钮这条路：后台巡检刚抓过远程时，进页 / 窗口聚焦都不该再联网一次，
   * 而用户手动点刷新就是在要求「此刻的最新数字」。
   */
  const refreshPage = useCallback(() => {
    loadGit(pid, { background: true, force: true });
    loadGitSummary();
  }, [pid, loadGit, loadGitSummary]);

  /** 静默重拉（窗口聚焦用）：不强制联网，复用巡检刚抓到的远程位置 */
  const reloadPage = useCallback(() => {
    loadGit(pid, { background: true });
    loadGitSummary();
  }, [pid, loadGit, loadGitSummary]);

  // 窗口重新获得焦点时静默校准一次：典型场景是在 IDE / 终端里提交完切回来，
  // 不点刷新也能看到新的提交与工作区状态。git 命令较重，刚加载过 5s 内跳过，
  // 且不打断进行中的加载 / 拉取 / 推送。
  // 焦点事件可能正是「最小化恢复」那一刻：立刻起三个 git 进程会跟首帧抢主线程，
  // 窗口要多白一会儿，所以延后一拍再刷新。
  useEffect(() => {
    if (page !== 'changes' || !pid) return undefined;
    let timer = null;
    const onFocus = () => {
      if (gitLoading || gitRefreshing || gitPulling || gitPushing) return;
      if (Date.now() - lastLoadAt.current < 5000) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(reloadPage, 300);
    };
    window.addEventListener('focus', onFocus);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [page, pid, gitLoading, gitRefreshing, gitPulling, gitPushing, reloadPage]);

  /** 一键快进拉取：成功后清掉提交缓存与右面板选中态，再整页重载（工作区可能已变） */
  const pullGit = useCallback(async () => {
    if (!pid || gitPulling) return;
    const target = pid;
    setGitPulling(true);
    try {
      const res = await api.gitPull(target);
      if (pidRef.current !== target) return; // 拉取期间切了项目：结果属于旧项目，不写回界面
      const n = (res && res.before && res.before.behind) || 0;
      notify(n > 0 ? '已拉取 ' + n + ' 个提交' : '已是最新，无需拉取');
      setGitCommitFiles({});
      setSel(null);
      setContent(null);
      loadGit(target, { background: true });
      loadGitSummary();
    } catch (e) {
      if (pidRef.current === target) notify(e.message, 'warn');
      // 凭据失效：后端已把「需要登录」落进巡检缓存，立刻校准汇总让顶部提示条亮出来
      if (e && (e.code === 'auth_failed' || e.code === 'push_auth')) loadGitSummary();
    } finally {
      setGitPulling(false);
    }
  }, [pid, pidRef, gitPulling, notify, loadGit, loadGitSummary]);

  /** 推送当前分支：提交树与工作区不变，只重载远程位置与角标 */
  const pushGit = useCallback(async () => {
    if (!pid || gitPushing) return;
    const target = pid;
    setGitPushing(true);
    try {
      const res = await api.gitPush(target);
      if (pidRef.current !== target) return; // 推送期间切了项目：结果属于旧项目，不写回界面
      const n = (res && res.before && res.before.ahead) || 0;
      notify(n > 0 ? '已推送 ' + n + ' 个提交' : '已是最新，无需推送');
      loadGit(target, { background: true });
      loadGitSummary();
    } catch (e) {
      if (pidRef.current === target) notify(e.message, 'warn');
      if (e && (e.code === 'auth_failed' || e.code === 'push_auth')) loadGitSummary();
    } finally {
      setGitPushing(false);
    }
  }, [pid, pidRef, gitPushing, notify, loadGit, loadGitSummary]);

  /** 打开提交弹窗：先取一次最新的待审核需求；取不到就按「无需求」降级，仍可手写提交 */
  const openCommit = useCallback(async () => {
    if (!pid) return;
    const target = pid;
    let requirement = null;
    try {
      const { requirements } = await api.pendingRequirements(target);
      requirement = (requirements || []).find((r) => r.status === 'review') || null;
    } catch (_) {}
    if (pidRef.current !== target) return; // 取需求期间切了项目，弹窗不该再开
    setModal({
      type: 'commit',
      requirement,
      changeCount: (gitChanges && gitChanges.counts && gitChanges.counts.total) || 0
    });
  }, [pid, pidRef, gitChanges, setModal]);

  /**
   * 提交改动：成功即关闭弹窗；勾选了自动审核时再验收需求，失败只提示不回滚提交。
   * linkReqId 是弹窗里带需求上下文的那条需求：不管有没有勾自动审核，
   * 这次提交产生的 hash 都会记到它身上（勾不勾只决定是否同时改状态）。
   */
  const submitCommit = useCallback(
    async (message, approveReqId, linkReqId) => {
      if (!pid) throw new Error('没有选中项目');
      const target = pid;
      const res = await api.gitCommit(target, message, linkReqId || null);
      if (pidRef.current !== target) return; // 提交期间切了项目：结果属于旧项目
      setModal(null);

      let msg = res && res.shortSha ? '已提交 ' + res.shortSha : '已提交';
      let warn = null;
      if (approveReqId) {
        try {
          // 传空串而不是不传：备注整条替换为空，与需求中心「留空提交即清空」一致
          await api.setRequirementStatus(approveReqId, 'done', '');
          msg += '，需求已标记完成';
        } catch (e) {
          warn = msg + '，但自动审核失败：' + e.message;
        }
      }
      notify(warn || msg, warn ? 'warn' : undefined);

      loadGit(target, { background: true });
      loadGitSummary();
      reloadRequirements(target);
    },
    [pid, pidRef, notify, setModal, loadGit, loadGitSummary, reloadRequirements]
  );

  /**
   * 验收时顺手提交并推送工作区改动：提交信息取 agent 单独提供的 commitMessage
   * （与提交弹窗预填同一真源），会话回复不会混进来；老交付回落到「#编号 标题」。
   * 没有可提交的改动就跳过提交，只在有未推送提交时仍会推送；推送失败只提示，不阻断验收。
   */
  const commitAndPushPending = useCallback(
    async (requirement) => {
      if (!pid) throw new Error('没有选中项目');
      const target = pid;
      const message =
        buildCommitMessage(requirement).trim() ||
        '#' + requirement.seq + ' ' + String(requirement.title || '').trim();

      let shortSha = '';
      try {
        // 带需求 id：这次验收提交的 hash 要回写到需求详情里，方便之后从需求回看改动
        const res = await api.gitCommit(target, message, requirement.id);
        shortSha = (res && res.shortSha) || '';
      } catch (e) {
        // 没有可提交的改动不是失败：改动可能已在别处提交，接着推送即可
        if (!e || e.code !== 'nothing_to_commit') throw e;
      }

      let pushMsg = '';
      let pushErr = '';
      try {
        const res = await api.gitPush(target);
        const n = (res && res.before && res.before.ahead) || 0;
        pushMsg = n > 0 ? '已推送 ' + n + ' 个提交' : '已是最新，无需推送';
      } catch (e) {
        pushErr = e.message || '推送失败';
        if (e && (e.code === 'auth_failed' || e.code === 'push_auth')) loadGitSummary();
      }

      if (pidRef.current === target) loadGit(target, { background: true });
      loadGitSummary();

      const head = shortSha ? '已提交 ' + shortSha : '没有待提交的改动';
      notify(pushErr ? head + '，但推送失败：' + pushErr : head + '，' + pushMsg, pushErr ? 'warn' : undefined);
      return { shortSha, pushed: !pushErr };
    },
    [pid, pidRef, notify, loadGit, loadGitSummary]
  );

  return {
    gitCommits,
    gitChanges,
    gitRemote,
    gitPulling,
    gitPushing,
    gitHasMore,
    gitLoading,
    gitRefreshing,
    gitLoadingMore,
    gitUnavailable,
    gitError,
    /** gitError 的 code（如 path_missing）：界面据此给出对应的修复入口 */
    gitErrorCode,
    /** 当前提交列表属于哪个项目；目标项目数据尚未落地时为 null */
    gitStatePid,
    gitSummary,
    gitOpen,
    gitCommitFiles,
    sel,
    content,
    loadGit,
    loadGitSummary,
    loadMoreGit,
    toggleGitGroup,
    openCommitDetail,
    openFile,
    reloadPage,
    refreshPage,
    pullGit,
    pushGit,
    openCommit,
    submitCommit,
    commitAndPushPending
  };
}

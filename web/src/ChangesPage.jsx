import { cloneElement, useEffect, useState } from 'react';
import { IC } from './icons.jsx';
import { ContextBar, Empty } from './ui.jsx';

/** 信息条状态：修改记录关心未提交文件数，不再复用「可提新需求」口径 */
function gitStatus({ changes, loading, unavailable, error, errorCode }) {
  if (unavailable) return { text: 'git 不可用', tone: 'muted', title: '未检测到 git 可执行程序' };
  // 路径失效不是环境问题：单独成一条，别让人去查 git 装没装
  if (errorCode === 'path_missing') return { text: '路径不存在', tone: 'busy', title: error };
  if (error) return { text: '读取失败', tone: 'busy', title: error };
  if (loading || !changes) return { text: '正在统计改动…', tone: 'muted' };
  if (!changes.isRepo) return { text: '非 git 仓库', tone: 'muted', title: '该项目路径不是 git 仓库' };
  const n = (changes.counts && changes.counts.total) || 0;
  return n > 0
    ? { text: n + ' 个未提交文件', tone: 'busy', title: '共 ' + n + ' 个未提交文件' }
    : { text: '暂无未提交改动', tone: 'free', title: '工作区干净' };
}

/**
 * 远程同步：拉取 / 推送各一个图标按钮（图标 + ↑n / ↓n，无文字）。
 * 两个按钮常驻，能不能点由状态决定：只有落后且工作区干净才能拉，只有领先才能推；
 * 分叉（两边都有）时两者都必然失败，一并置灰。不可操作的原因都写在 title 里。
 */
function RemoteSync({ remote, pulling, pushing, dirty, onPull, onPush }) {
  /** 推送的两步确认：点一下按钮变蓝，5 秒内再点才真的推 */
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return undefined;
    const t = setTimeout(() => setArmed(false), 5000);
    return () => clearTimeout(t);
  }, [armed]);

  // 位置变了（同步完成 / 切项目）就收起确认态，别让按钮停在半激活
  useEffect(() => {
    setArmed(false);
  }, [remote]);

  if (!remote || !remote.isRepo) return null;

  if (!remote.hasUpstream) {
    return (
      <span className="ctx-remote muted" title="当前分支没有上游分支，无法比较远程位置">
        {IC.cloud}
        未跟踪远程
      </span>
    );
  }

  const ahead = remote.ahead || 0;
  const behind = remote.behind || 0;
  const busy = pulling || pushing;
  const diverged = ahead > 0 && behind > 0;
  const stale = remote.fetched && remote.fetched.ok === false;

  const canPull = !busy && !diverged && behind > 0 && dirty === 0;
  const canPush = !busy && !diverged && ahead > 0;
  const busyHint = pulling ? '正在拉取…' : pushing ? '正在推送…' : null;
  const divergedHint = '本地与远程已分叉，需要手动 merge 或 rebase';

  function pullHint() {
    if (busyHint) return busyHint;
    if (diverged) return divergedHint;
    if (dirty > 0) return '工作区有 ' + dirty + ' 个未提交改动，先提交或暂存再拉取';
    if (behind === 0) return '已是最新，没有要拉取的提交';
    return '执行 git pull --ff-only';
  }

  function pushHint() {
    if (busyHint) return busyHint;
    if (diverged) return divergedHint;
    if (ahead === 0) return '没有待推送的提交';
    if (armed) return '再点一次确认推送（5 秒内有效）';
    return '点按准备把 ' + ahead + ' 个提交推到 ' + remote.upstream;
  }

  const title = (head, why) =>
    [head, why, stale ? '远程位置可能不是最新：' + remote.fetched.error : null].filter(Boolean).join('\n');

  return (
    <>
      {/* 禁用态的按钮收不到 hover，title 必须挂在外层，否则提示不显示 */}
      <span className="ctx-tip" title={title('拉取 ' + remote.upstream, pullHint())}>
        <button className="btn sm ctx-sync" disabled={!canPull} aria-label="拉取" onClick={onPull}>
          {pulling ? <span className="spinner" /> : IC.pull}
          {behind > 0 ? <span className="down">↓{behind}</span> : null}
        </button>
      </span>
      <span className="ctx-tip" title={title('推送 ' + remote.upstream, pushHint())}>
        <button
          className={'btn sm ctx-sync' + (armed ? ' primary' : '')}
          disabled={!canPush}
          aria-label="推送"
          onClick={() => {
            if (!armed) {
              setArmed(true);
              return;
            }
            setArmed(false);
            onPush();
          }}
        >
          {pushing ? <span className="spinner" /> : IC.push}
          {ahead > 0 ? <span className="up">↑{ahead}</span> : null}
        </button>
      </span>
    </>
  );
}

/**
 * 访问远程仓库：纯图标按钮，无文字。
 * 只有一个可浏览的远程时点击直接打开；多个时悬停（或键盘聚焦）展开列表，逐个点开。
 */
function VisitButton({ remotes, onOpenUrl }) {
  const list = (remotes || []).filter((r) => r.web);
  if (!list.length || !onOpenUrl) return null;

  const single = list.length === 1;
  return (
    <div className="visit">
      <button
        className="btn sm icon"
        title={single ? '在浏览器打开 ' + list[0].web : '打开远程仓库（共 ' + list.length + ' 个）'}
        aria-label="在浏览器打开远程仓库"
        onClick={single ? () => onOpenUrl(list[0].web) : undefined}
      >
        {IC.link}
      </button>
      {single ? null : (
        <div className="visit-menu">
          {list.map((r) => (
            <button key={r.name} onClick={() => onOpenUrl(r.web)} title={r.url}>
              <span className="rn">{r.name}</span>
              <span className="ru">{r.web}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * 修改记录 · 中区：项目信息条 + 提交树（由 App 以 children 传入）。
 * 这里只管「能不能看树」的四种前置状态，文件改动内容在右面板（ChangeDiff）。
 * 提交 + 刷新 + 拉取/推送 + 访问远程仓库这组按钮注入给 GitPanel，渲染在「当前改动」标题行右侧。
 */
export default function ChangesPage({
  project,
  projects,
  changes,
  remote,
  pulling,
  pushing,
  loading,
  refreshing,
  unavailable,
  error,
  errorCode,
  onCommit,
  onRefresh,
  onPull,
  onPush,
  onOpenUrl,
  onEditPath,
  children
}) {
  const isRepo = changes ? changes.isRepo : false;
  const dirty = (changes && changes.counts && changes.counts.total) || 0;
  /** 读取失败但手上还有上次的仓库快照：错误只降级成提示条，树照旧显示 */
  const staleError = !!error && isRepo;

  /** 提交按钮的不可点原因，与 RemoteSync 一致挂在 title 上 */
  let commitHint = '把项目目录内的 ' + dirty + ' 个改动提交到本地仓库（自动暂存）';
  if (loading) commitHint = '正在读取工作区改动…';
  else if (unavailable) commitHint = '未检测到 git 可执行程序';
  else if (errorCode === 'path_missing') commitHint = '项目路径不存在，请先修改路径';
  else if (error) commitHint = '读取 git 信息失败';
  else if (!isRepo) commitHint = '该项目不是 git 仓库';
  else if (dirty === 0) commitHint = '工作区干净，没有可提交的改动';

  const actions = (
    <>
      {isRepo && onCommit ? (
        <span className="ctx-tip" title={commitHint}>
          <button
            className="btn sm"
            disabled={loading || dirty === 0}
            onClick={onCommit}
          >
            {IC.commit}
            提交
          </button>
        </span>
      ) : null}
      {onRefresh ? (
        <button
          className="btn sm"
          disabled={refreshing}
          onClick={onRefresh}
          title={refreshing ? '正在刷新…' : '重新读取提交历史与当前改动（顺带抓取远程）'}
          aria-label="刷新"
        >
          {refreshing ? <span className="spinner" /> : IC.refresh}
        </button>
      ) : null}
      <RemoteSync remote={remote} pulling={pulling} pushing={pushing} dirty={dirty} onPull={onPull} onPush={onPush} />
      <VisitButton remotes={remote && remote.remotes} onOpenUrl={onOpenUrl} />
    </>
  );

  /** 错误态的重试：复用信息条上的刷新，失败时按钮自己转圈，不必再找别的入口 */
  const retryButton = onRefresh ? (
    <button
      className="btn sm"
      disabled={refreshing}
      onClick={onRefresh}
      title={refreshing ? '正在重试…' : '重新读取提交历史与当前改动'}
    >
      {refreshing ? <span className="spinner" /> : IC.refresh}
      重试
    </button>
  ) : null;

  return (
    <div className="wrap">
      {project ? (
        <ContextBar
          project={project}
          projects={projects}
          status={gitStatus({ changes, loading, unavailable, error, errorCode })}
        />
      ) : null}
      {loading ? (
        <div className="loading">
          <span className="spinner" />
          正在读取 git 信息…
        </div>
      ) : unavailable ? (
        <Empty
          title="未检测到 git"
          desc="本机未安装或未找到 git 可执行程序，无法读取提交历史与改动。"
          icon={IC.git}
        />
      ) : errorCode === 'path_missing' ? (
        <Empty
          title="项目路径不存在"
          desc={(error ? error + '。' : '项目目录已被移动或删除。') + '修改项目路径后，整页 git 能力即可恢复。'}
          icon={IC.folder}
        >
          {onEditPath ? (
            <button className="btn sm primary" onClick={onEditPath}>
              修改路径
            </button>
          ) : null}
        </Empty>
      ) : error && !isRepo ? (
        <Empty title="读取 git 信息失败" desc={error} icon={IC.git}>
          {retryButton}
        </Empty>
      ) : !isRepo ? (
        <Empty
          title="该项目不是 git 仓库"
          desc="「修改记录」需要项目路径指向一个 git 仓库；请在项目设置里确认本地路径。"
          icon={IC.git}
        />
      ) : children ? (
        <>
          {staleError ? (
            <div className="gerr" role="alert">
              <span className="gi">{IC.alert}</span>
              <span className="gtx">
                <span className="ghead">读取 git 信息失败</span>
                <span className="gwhy" title={error}>
                  {error}
                </span>
                <span className="gkeep">下方仍是上次读取的内容，可能已过期。</span>
              </span>
              {retryButton}
            </div>
          ) : null}
          {cloneElement(children, { actions })}
        </>
      ) : null}
    </div>
  );
}

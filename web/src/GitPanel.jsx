import { CHG } from './constants.js';
import { fmtDateTime } from './format.js';
import { IC } from './icons.jsx';

function Stat({ file }) {
  if (file.binary) {
    return (
      <span className="gstat">
        <span className="bin">二进制</span>
      </span>
    );
  }
  return (
    <span className="gstat">
      {file.added != null ? <span className="add">+{file.added}</span> : null}
      {file.removed != null ? <span className="del">-{file.removed}</span> : null}
    </span>
  );
}

/** 文件行：状态徽标 + 路径 + 增删行数；点击后在右侧面板显示改动 */
function FileRow({ file, active, onClick }) {
  const st = CHG[file.status] || { label: file.status, cls: '' };
  return (
    <div
      className={'grow gfile' + (active ? ' active' : '')}
      onClick={onClick}
      title={file.origPath ? file.origPath + ' → ' + file.path : file.path}
      role="button"
      tabIndex={0}
    >
      <span className={'st ' + st.cls}>{st.label}</span>
      <span className="gpath">{file.path}</span>
      {file.origPath ? <span className="gren">← {file.origPath}</span> : null}
      <Stat file={file} />
    </div>
  );
}

function Twisty({ open }) {
  return <span className={'gtw' + (open ? ' open' : '')}>{IC.chev}</span>;
}

/**
 * 合计增删行数（「当前改动」标题行 / 每条提交行）：沿用文件行的 `.gstat` 样式，
 * 字重跟随所在行。两边都是 0（纯二进制 / 合并提交 / 远程提交还没取到）时不渲染。
 */
function TotalStat({ added, removed, title }) {
  const a = added || 0;
  const d = removed || 0;
  if (!a && !d) return null;
  return (
    <span className="gstat" title={title}>
      {a ? <span className="add">+{a}</span> : null}
      {d ? <span className="del">-{d}</span> : null}
    </span>
  );
}

/**
 * 提交行：中区只列提交信息，点击后在右面板查看该提交的说明与文件清单。
 * isRemote：该提交只在远程（本地还没有），整行置灰；
 * 引用徽标优先显示上游名（提交恰好是上游头），否则退回 %D 的第一个引用。
 */
function CommitNode({ commit, isRemote, sel, remoteSha, remoteUpstream, onOpenCommit }) {
  const isRemoteTip = !!remoteSha && commit.sha === remoteSha;
  const refLabel = isRemoteTip ? remoteUpstream : commit.refs[0] || null;
  const viewing = !!sel && sel.kind === 'commit-info' && sel.sha === commit.sha;
  return (
    <div
      className={'grow gcmt' + (isRemote ? ' remote' : '') + (viewing ? ' active' : '')}
      onClick={() => onOpenCommit(commit.sha)}
      role="button"
      tabIndex={0}
      title={[commit.subject, commit.author, commit.refs.join(' '), fmtDateTime(commit.committedAt)]
        .filter(Boolean)
        .join(' · ')}
    >
      <span className="gsha">{commit.shortSha}</span>
      <span className="gsubj">{commit.subject}</span>
      {/* 这次提交自己的改动量：合并提交、纯二进制提交没有行数，不渲染 */}
      <TotalStat added={commit.added} removed={commit.removed} title="本次提交改动（不含合并提交与二进制文件）" />
      {refLabel ? <span className={'gref' + (isRemoteTip ? ' remote' : '')}>{refLabel}</span> : null}
      <span className="gtime">{fmtDateTime(commit.committedAt)}</span>
    </div>
  );
}

/**
 * 修改记录 · 中区提交树：`当前改动` 与 `提交历史` 两个组节点，平铺列表 + 缩进连线。
 * 「当前改动」标题行右侧由上层注入操作按钮（提交 / 刷新 / 拉取 / 推送 / 访问远程仓库）。
 * 提交历史里「远程有、本地还没有」的提交置灰列在最前面，用分隔行标出远程头的位置。
 * 点提交 / 文件都由上层切换右面板内容。
 */
export default function GitPanel({
  changes,
  commits,
  remote,
  hasMore,
  loading,
  loadingMore,
  unavailable,
  error,
  openGroups,
  onToggleGroup,
  sel,
  onOpenCommit,
  onOpenFile,
  onLoadMore,
  actions
}) {
  if (loading) {
    return (
      <div className="gstate">
        <span className="spinner" />
        正在读取 git 信息…
      </div>
    );
  }
  if (unavailable) return <div className="gstate">未检测到 git，无法读取提交历史与改动。</div>;
  if (error) return <div className="gstate">读取 git 信息失败：{error}</div>;
  if (!changes || !changes.isRepo) return <div className="gstate">该项目不是 git 仓库。</div>;

  const counts = changes.counts || { total: 0 };
  const openWk = !!openGroups.working;
  const openCm = !!openGroups.commits;
  const remoteCommits = remote && remote.hasUpstream ? remote.commits || [] : [];
  const remoteBehind = remote && remote.hasUpstream ? remote.behind || 0 : 0;
  const remoteSha = remote && remote.hasUpstream ? remote.sha : null;
  const remoteUpstream = remote && remote.hasUpstream ? remote.upstream : null;

  const node = (c, isRemote) => (
    <CommitNode
      key={c.sha}
      commit={c}
      isRemote={isRemote}
      sel={sel}
      remoteSha={remoteSha}
      remoteUpstream={remoteUpstream}
      onOpenCommit={onOpenCommit}
    />
  );

  return (
    <div className="gtree">
      <div
        className={'grow grp' + (openWk ? ' open' : '')}
        onClick={() => onToggleGroup('working')}
        role="button"
        tabIndex={0}
      >
        <Twisty open={openWk} />
        <span className="ico">{IC.git}</span>
        <span className="gtitle">当前改动</span>
        {/* 有改动才显示合计；工作区干净时整块不出现 */}
        {counts.total > 0 ? (
          <TotalStat
            added={counts.added}
            removed={counts.removed}
            title={'未提交改动合计（' + counts.total + ' 个文件，不含二进制文件）'}
          />
        ) : null}
        <span className="gn">{counts.total}</span>
        {actions ? (
          // 按钮在可点击的整行里，拦住冒泡，免得点按钮顺带折叠分组
          <div className="gactions" onClick={(e) => e.stopPropagation()}>
            {actions}
          </div>
        ) : null}
      </div>

      {openWk ? (
        changes.clean ? (
          <div className="gstate sm">工作区干净，没有未提交的改动</div>
        ) : (
          <div className="gchildren">
            {changes.files.map((f) => (
              <FileRow
                key={f.path + '|' + (f.origPath || '')}
                file={f}
                active={!!sel && sel.kind === 'working' && sel.path === f.path}
                onClick={() => onOpenFile(f)}
              />
            ))}
          </div>
        )
      ) : null}

      <div
        className={'grow grp' + (openCm ? ' open' : '')}
        onClick={() => onToggleGroup('commits')}
        role="button"
        tabIndex={0}
      >
        <Twisty open={openCm} />
        <span className="ico">{IC.commit}</span>
        <span className="gtitle">提交历史</span>
        {changes.branch ? <span className="gref">{changes.branch}</span> : null}
        <span className="gn">{commits.length + remoteCommits.length}</span>
      </div>

      {openCm ? (
        <>
          {commits.length === 0 && remoteCommits.length === 0 ? (
            <div className="gstate sm">还没有任何提交</div>
          ) : (
            <>
              {remoteCommits.length > 0 ? (
                <>
                  <div className="gchildren">{remoteCommits.map((c) => node(c, true))}</div>
                  <div className="gdivider">
                    <span>
                      远程在此 · {remoteUpstream}
                      {remote.truncated ? ' · 仅显示最近 ' + remoteCommits.length + ' 个' : ''}
                    </span>
                  </div>
                </>
              ) : remoteBehind > 0 ? (
                <div className="gstate sm">远程领先 {remoteBehind} 个提交，但都不在本项目路径范围内</div>
              ) : null}

              {commits.length > 0 ? <div className="gchildren">{commits.map((c) => node(c, false))}</div> : null}
            </>
          )}

          {commits.length > 0 && hasMore ? (
            <div className="gmore">
              <button className="btn sm" disabled={loadingMore} onClick={onLoadMore}>
                {loadingMore ? '加载中…' : '加载更多'}
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

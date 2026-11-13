import { useCallback, useState } from 'react';
import { api } from '../api.js';

/**
 * 凭据失效提示：remoteAuth 来自后端巡检缓存 —— 后台 fetch、进页 fetch、拉取 / 推送失败都会写进去，
 * 所以不论哪条路径撞上登录失效，顶部都会亮起同一条提示，而不是让一堆登录框自己弹。
 * 关闭只对「同一个项目 + 同一段报错」生效；换了项目或报错内容变了，说明是新问题，重新提示。
 */
export function useGitAuthWarning({ gitSummary, projects, pid, page, loadGit, loadGitSummary, notify }) {
  /** 已关闭的 git 凭据提示：存签名（项目 + 报错），换了项目 / 换了报错会重新提示 */
  const [authDismissed, setAuthDismissed] = useState(null);
  /** 「重新检查」进行中：提示条上的检查按钮转圈 */
  const [authRetrying, setAuthRetrying] = useState(false);

  const authRow =
    gitSummary && Array.isArray(gitSummary.projects) ? gitSummary.projects.find((g) => g.remoteAuth) : null;
  const authSig = authRow ? authRow.id + '|' + (authRow.remoteError || '') : null;
  const authProject = authRow ? projects.find((p) => p.id === authRow.id) || null : null;
  const showAuthWarn = !!authRow && authSig !== authDismissed;

  const dismissAuthWarn = useCallback(() => setAuthDismissed(authSig), [authSig]);

  /** 用户登录完点「重新检查」：强制跑一轮远程检查，再刷新汇总，凭据恢复后提示条自动消失 */
  const recheckGitAuth = useCallback(async () => {
    if (authRetrying) return;
    setAuthRetrying(true);
    try {
      await api.remoteCheckNow();
      loadGitSummary();
      if (pid && page === 'changes') loadGit(pid, { background: true, force: true });
    } catch (e) {
      notify(e.message, 'warn');
    } finally {
      setAuthRetrying(false);
    }
  }, [authRetrying, pid, page, loadGit, loadGitSummary, notify]);

  return { authRow, authProject, showAuthWarn, dismissAuthWarn, authRetrying, recheckGitAuth };
}

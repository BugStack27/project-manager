import { IC } from '../icons.jsx';
import TopWarn from './TopWarn.jsx';

/**
 * Git 凭据失效提示条。
 *
 * 后台的 fetch / 拉取已经关掉交互式登录（见主进程 runGit 的 env），凭据失效只会失败，
 * 不会弹登录框；这条提示的作用是把「哪个项目需要登录」摊到界面顶部，由用户自己决定：
 * 去终端里手动登录（「打开终端登录」）、登录完验证一下（「重新检查」），或本次先忽略。
 */
export default function GitAuthBanner({ name, message, busy, canLogin, onLogin, onRetry, onDismiss }) {
  const desc =
    (name ? '项目「' + name + '」' : '有项目') +
    '访问远程仓库时凭据失效' +
    (message ? '：' + message : '') +
    '。本应用已停止弹出登录框，请自行完成登录后点「重新检查」。';

  return (
    <TopWarn icon={IC.lock} title="Git 需要登录" desc={desc}>
      {canLogin && onLogin ? (
        <button className="btn sm primary" onClick={onLogin} title="在系统终端里打开项目目录，手动完成 git 登录">
          {IC.term}
          打开终端登录
        </button>
      ) : null}
      <button className="btn sm" onClick={onRetry} disabled={busy} title="重新抓取远程，验证凭据是否已恢复">
        {busy ? <span className="spinner" /> : IC.refresh}
        {busy ? '检查中…' : '重新检查'}
      </button>
      <button className="wb-close" onClick={onDismiss} title="本次运行不再提示（不影响后台检查）" aria-label="关闭提示">
        {IC.x}
      </button>
    </TopWarn>
  );
}

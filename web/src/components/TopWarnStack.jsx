import DataCorruptBanner from './DataCorruptBanner.jsx';
import GitAuthBanner from './GitAuthBanner.jsx';
import McpFailBanner from './McpFailBanner.jsx';

/**
 * 顶部提示条栈：数据文件损坏 / MCP 未启动 / git 凭据失效。
 * 多条可能同时出现，粘性挂在容器上，避免各自的 sticky 在同一个 top 上叠成一堆。
 */
export default function TopWarnStack({
  corrupt,
  mcpFail,
  mcpRetrying,
  onRetryMcp,
  onDismissMcp,
  onOpenBackup,
  onOpenDataDir,
  showAuthWarn,
  authRow,
  authProject,
  authRetrying,
  onLogin,
  onRecheckAuth,
  onDismissAuth
}) {
  if (!corrupt && !mcpFail && !showAuthWarn) return null;
  return (
    <div className="warnstack">
      {corrupt ? (
        <DataCorruptBanner status={corrupt} onOpenBackup={onOpenBackup} onOpenDataDir={onOpenDataDir} />
      ) : null}
      {mcpFail ? (
        <McpFailBanner error={mcpFail} busy={mcpRetrying} onRetry={onRetryMcp} onDismiss={onDismissMcp} />
      ) : null}
      {showAuthWarn ? (
        <GitAuthBanner
          name={authProject ? authProject.name : authRow.name}
          message={authRow.remoteError}
          busy={authRetrying}
          canLogin={!!authProject}
          onLogin={onLogin}
          onRetry={onRecheckAuth}
          onDismiss={onDismissAuth}
        />
      ) : null}
    </div>
  );
}

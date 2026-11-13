import { IC } from '../icons.jsx';
import { mcpFailDesc, mcpFailTitle } from '../lib/mcp-view.js';
import TopWarn from './TopWarn.jsx';

/**
 * MCP 启动失败提示条：服务没起来时窗口直接把原因与端口摊出来，不必打开 MCP 弹窗或翻终端日志。
 * 「重试」重新走一遍主进程的启动流程（端口需先被释放），成功后本条自动消失；
 * 右侧 × 只是本次运行不再提示，不改变服务状态 —— 弹窗里的未运行提示仍然在。
 */
export default function McpFailBanner({ error, busy, onRetry, onDismiss }) {
  return (
    <TopWarn icon={IC.plug} title={mcpFailTitle(error)} desc={mcpFailDesc(error)}>
      <button
        className="btn sm primary"
        onClick={onRetry}
        disabled={busy}
        title={busy ? undefined : '重新启动 MCP 服务（需先释放被占用的端口）'}
      >
        {IC.refresh}
        {busy ? '重试中…' : '重试'}
      </button>
      <button
        className="wb-close"
        onClick={onDismiss}
        title="本次运行不再提示（不影响 MCP 服务状态）"
        aria-label="关闭提示"
      >
        {IC.x}
      </button>
    </TopWarn>
  );
}

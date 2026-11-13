import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';

/**
 * MCP / AI 接入：启动失败快照、重试、接入弹窗的打开。
 * 失败提示条与弹窗里的重试按钮共用 mcpRetrying，避免两处各转各的圈。
 */
export function useMcp({ notify, setModal }) {
  /** MCP 启动失败快照：非空时顶部提示条给出原因 / 端口 / 重试（关闭仅隐藏，服务状态不变） */
  const [mcpFail, setMcpFail] = useState(null);
  /** 重试启动 MCP 进行中 */
  const [mcpRetrying, setMcpRetrying] = useState(false);

  // MCP 启动失败只在启动时发生一次：首屏就把原因与端口摊到窗口顶部，
  // 免得用户以为服务在跑、agent 连不上时还要去开弹窗或翻终端日志
  useEffect(() => {
    api
      .mcpInfo()
      .then((info) => {
        if (info && !info.url && info.error) setMcpFail(info.error);
      })
      .catch(() => {});
  }, []);

  /** 打开 AI 接入弹窗：取端点信息、两段接入说明与 Agent 注册表，任一失败也照常打开（各自降级） */
  const openMcp = useCallback(async () => {
    let info = null;
    let prompt = null;
    let workerPrompt = null;
    let agents = [];
    try {
      info = await api.mcpInfo();
    } catch (_) {}
    try {
      prompt = await api.scoutPrompt();
    } catch (_) {}
    try {
      workerPrompt = await api.workerPrompt();
    } catch (_) {}
    try {
      const res = await api.agents();
      agents = (res && res.agents) || [];
    } catch (_) {}
    setModal({ type: 'mcp', info, prompt, workerPrompt, agents });
  }, [setModal]);

  /**
   * 重试启动 MCP：主进程那边的失败不会自己变好，必须用户先释放端口再点。
   * 成功即撤掉提示条并同步弹窗里的端点信息；失败就把新的原因留在条上。
   */
  const retryMcp = useCallback(async () => {
    if (mcpRetrying) return false;
    setMcpRetrying(true);
    try {
      const info = await api.mcpRetry();
      const ok = !!(info && info.url);
      setMcpFail(ok ? null : (info && info.error) || { message: '重试后仍未启动', port: null });
      // 弹窗可能正开着：不同步它就会出现「服务已起来、弹窗还说未运行」的自相矛盾
      setModal((m) => (m && m.type === 'mcp' ? { ...m, info } : m));
      notify(ok ? 'MCP 服务已启动' : 'MCP 服务仍未启动', ok ? 'info' : 'warn');
      return ok;
    } catch (e) {
      notify(e.message, 'warn');
      return false;
    } finally {
      setMcpRetrying(false);
    }
  }, [mcpRetrying, notify, setModal]);

  return { mcpFail, setMcpFail, mcpRetrying, openMcp, retryMcp };
}

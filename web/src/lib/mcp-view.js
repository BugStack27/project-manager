/* MCP 启动失败的文案：主进程只交出 { code, port, message }，怎么讲由界面统一决定。
   顶部提示条与 MCP 弹窗共用这两句，避免同一件事在两处说得不一样。 */

/** 提示条标题：端口已知就带在标题上，用户一眼看到该放掉哪个端口 */
export function mcpFailTitle(error) {
  return error && error.port ? 'MCP 服务未启动（端口 ' + error.port + '）' : 'MCP 服务未启动';
}

/**
 * 提示条说明。端口被占用是最常见的一种，单独说清楚「怎么办」；
 * 其余错误（权限、绑定失败等）原样透出主进程的 message，不做猜测性翻译 ——
 * 所以兜底那句只说「再试 / 重启」，不假定是端口问题。
 */
export function mcpFailDesc(error) {
  const port = error && error.port;
  if (error && error.code === 'EADDRINUSE') {
    return (
      '端口' +
      (port ? ' ' + port + ' ' : '') +
      '被其他程序占用，AI 助手现在连不上。释放该端口后点「重试」即可，不必重启应用。'
    );
  }
  return (error && error.message ? error.message : '启动时出现未知错误') + '。可点「重试」再试一次；仍失败请重启应用。';
}

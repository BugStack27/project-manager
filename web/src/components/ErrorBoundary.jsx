import { Component } from 'react';
import { IC } from '../icons.jsx';
import { Empty } from '../ui.jsx';

/**
 * 渲染端兜底：一次未捕获的渲染异常不该让整个窗口变成白屏。
 * 与主进程的 crash 记录分工不同 —— 这里能就地恢复（重新加载），主进程那份负责留现场。
 * 异常通过 window.pm.crash.record 落到 <数据目录>/crash/，与主进程崩溃同目录、
 * 共用同一个「导出诊断包」出口，用户只要发一个文件就有完整上下文。
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
    this.reload = this.reload.bind(this);
    this.exportPack = this.exportPack.bind(this);
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    try {
      window.pm.crash.record({
        message: String((error && error.message) || error || '未知错误'),
        stack: String((error && error.stack) || ''),
        componentStack: String((info && info.componentStack) || '')
      });
    } catch (_) {}
  }

  reload() {
    window.location.reload();
  }

  exportPack() {
    try {
      window.pm.crash.export();
    } catch (_) {}
  }

  render() {
    if (!this.state.error) return this.props.children;
    const msg = String((this.state.error && this.state.error.message) || '未知错误');
    return (
      <div className="wrap">
        <Empty
          title="界面出错了"
          desc={'这一屏没能画出来：' + msg + '。异常已经记进崩溃记录，可以导出诊断包一起发出来。'}
          icon={IC.alert}
        >
          <button className="btn sm" onClick={this.exportPack} title="把版本、平台与崩溃记录打成一个 JSON 文件">
            导出诊断包
          </button>
          <button className="btn sm primary" onClick={this.reload} title="重新加载界面（不会丢失已保存的数据）">
            重新加载界面
          </button>
        </Empty>
      </div>
    );
  }
}

import { IC } from '../icons.jsx';
import { Modal } from '../ui.jsx';

/**
 * 更新弹窗：只负责「把状态机说清楚 + 给出下一步那个按钮」。
 * 状态由主进程 updater 推送（pm:update），这里不本地推断经过 —— 点完等推送，
 * 否则界面会先于事实宣布「已下载」。
 *
 * 「导出诊断包」放在这里而不是藏进菜单：出问题时用户最可能打开的就是这个弹窗，
 * 让他一步拿到能发出来的东西。
 */
function timeText(ts) {
  if (!ts) return '还没检查过';
  try {
    return new Date(ts).toLocaleString();
  } catch (_) {
    return '—';
  }
}

export default function UpdateModal({ state, onAction, onExport, onClose, notify }) {
  const s = state || {};
  const phase = s.phase || 'idle';
  const current = s.current || '—';
  const busy = phase === 'checking' || phase === 'downloading';

  const primary =
    phase === 'available'
      ? { act: 'download', label: '下载更新' }
      : phase === 'downloaded'
        ? { act: 'install', label: '重启并安装' }
        : { act: 'check', label: '检查更新' };

  const disabledPrimary =
    busy || phase === 'unsupported' || phase === 'unconfigured';

  const run = async (act) => {
    try {
      await onAction(act);
      if (act === 'install') {
        notify('正在退出并安装更新…');
        onClose();
      }
    } catch (e) {
      notify((e && e.message) || '操作失败', 'warn');
    }
  };

  let body = null;
  if (phase === 'checking') {
    body = <p className="upd-line">正在检查…</p>;
  } else if (phase === 'up-to-date') {
    body = (
      <p className="upd-line">
        已是最新版本 <b>v{current}</b>
        <span className="upd-dim"> · 上次检查 {timeText(s.checkedAt)}</span>
      </p>
    );
  } else if (phase === 'available') {
    body = (
      <p className="upd-line">
        发现新版本 <b>v{s.version || '?'}</b>
      </p>
    );
  } else if (phase === 'downloading') {
    body = (
      <>
        <p className="upd-line">
          正在下载 <b>v{s.version || current}</b>
          <span className="upd-dim"> · {s.percent || 0}%</span>
        </p>
        <div className="upd-bar">
          <span style={{ width: Math.max(2, Math.min(100, s.percent || 0)) + '%' }} />
        </div>
      </>
    );
  } else if (phase === 'downloaded') {
    body = (
      <p className="upd-line">
        <b>v{s.version || '?'}</b> 已下载完成，重启后自动安装。
        <span className="upd-dim">正在运行的命令会先被停止。</span>
      </p>
    );
  } else if (phase === 'unsupported') {
    body = (
      <p className="upd-line">
        当前是开发版，不检查更新。
        <span className="upd-dim">只有打包安装的版本才会走更新通道。</span>
      </p>
    );
  } else if (phase === 'unconfigured') {
    body = (
      <p className="upd-line">
        还没有配置更新源。
        <span className="upd-dim">在 package.json 的 build.publish 里填好镜像仓后重新打包，安装包会带上 app-update.yml。</span>
      </p>
    );
  } else {
    body = (
      <p className="upd-line">
        上次检查 {timeText(s.checkedAt)}
      </p>
    );
  }

  return (
    <Modal onClose={onClose}>
      <h2>版本更新</h2>
      <p className="sub">
        当前版本 <b>v{current}</b> · 检查到新版本后由你决定何时下载与重启
      </p>

      {body}

      {phase === 'error' && s.error ? <p className="mcp-err">{s.error}</p> : null}

      <div className="mfoot split">
        <div className="left">
          <button className="btn" onClick={onExport} title="把版本、平台、崩溃记录打成一个 JSON">
            {IC.archive}导出诊断包
          </button>
        </div>
        <span className="ctx-tip" title={busy ? '正在处理，稍等' : primary.label}>
          <button
            className={'btn ' + (phase === 'downloaded' ? 'primary' : '')}
            disabled={disabledPrimary}
            onClick={() => run(primary.act)}
          >
            {primary.label}
          </button>
        </span>
      </div>
    </Modal>
  );
}

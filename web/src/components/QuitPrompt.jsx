import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { IC } from '../icons.jsx';
import { Modal } from '../ui.jsx';

/**
 * 退出前的「分离 / 停止 / 取消」询问，由主进程在 before-quit 时推过来。
 *
 * 为什么不用系统消息框：那是另一套视觉（浅色系统框 vs 应用卡片），Windows 上
 * `type:'question'` 还会画成蓝底白 i 的信息图标——而这里是在要用户做一个选择。
 * 用应用自己的 Modal，三个动作也才能带上各自的说明，不用靠一长串 detail 硬讲。
 *
 * 主进程 8 秒收不到回话会自行回落系统弹窗，所以这里不做任何阻塞逻辑，
 * 回话失败也照常收起——真要退不出去还有那边兜着。
 */
export default function QuitPrompt() {
  const [ask, setAsk] = useState(null);

  useEffect(() => {
    return api.onQuitAsk((payload) => {
      // dismiss：主进程等超时了，改用系统弹窗，这边必须收起
      if (payload && payload.dismiss) {
        setAsk(null);
        return;
      }
      setAsk(payload || { count: 0, items: [], total: 0 });
    });
  }, []);

  if (!ask) return null;

  const items = ask.items || [];
  const total = ask.total || items.length;
  const more = total - items.length;

  function answer(mode) {
    setAsk(null);
    try {
      const p = api.answerQuit(mode);
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (_) {}
  }

  return (
    <Modal onClose={() => answer('cancel')}>
      <h2>退出项目管理台</h2>
      <p className="sub">有 {total} 个命令正在运行，退出前先决定怎么处理它们。</p>

      <ul className="quit-runs">
        {items.map((c, i) => (
          <li key={i}>
            <span className="qr-dot" />
            {c.name ? <span className="qr-name">{c.name}</span> : null}
            <span className="qr-cmd" title={c.text}>
              {c.text}
            </span>
          </li>
        ))}
        {more > 0 ? <li className="qr-more">…等共 {total} 个命令</li> : null}
      </ul>

      <div className="quit-opts">
        <button type="button" className="quit-opt default" autoFocus onClick={() => answer('detach')}>
          <span className="qo-ico detach">{IC.term}</span>
          <span className="qo-txt">
            <b>分离并退出</b>
            <em>应用关掉，进程继续在后台跑、日志继续写</em>
          </span>
          <span className="qo-tag">默认</span>
        </button>

        <button type="button" className="quit-opt" onClick={() => answer('stop')}>
          <span className="qo-ico stop">{IC.stop}</span>
          <span className="qo-txt">
            <b>停止并退出</b>
            <em>先结束这 {total} 个进程及其子进程，再关闭应用</em>
          </span>
        </button>
      </div>

      <div className="mfoot">
        <button type="button" className="btn" onClick={() => answer('cancel')}>
          取消
        </button>
      </div>
    </Modal>
  );
}

import { IC } from '../icons.jsx';
import TopWarn from './TopWarn.jsx';

/**
 * 手机端通信需要用户介入：频道失效要重新扫码；隧道或本机服务没起来则打开弹窗看原因。
 * 不处理就一直收不到接入点，所以挂在窗口顶部，而不是等用户点进弹窗才发现。
 */
export default function MobileRepairBanner({ kind, message, onOpen }) {
  const rescan = kind === 'channel_not_found';
  const title = rescan ? '手机端通信需要重新配对' : '手机端通信未就绪';
  const desc = message || (rescan
    ? '当前网关上没有原来的频道，请重新配对后让手机重新扫码'
    : '远程通道没有准备好，打开手机端通信查看原因');
  return (
    <TopWarn icon={IC.link} title={title} desc={desc}>
      <button className="btn sm primary" onClick={onOpen}>
        {rescan ? '去重新配对' : '去处理'}
      </button>
    </TopWarn>
  );
}

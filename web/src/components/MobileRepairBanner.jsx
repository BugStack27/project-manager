import { IC } from '../icons.jsx';
import TopWarn from './TopWarn.jsx';

/**
 * 频道在当前网关上不存在（换过网关或已过期）时，只能靠手机重新扫码恢复。
 * 不处理就一直收不到接入点，所以挂在窗口顶部，而不是等用户点进弹窗才发现。
 */
export default function MobileRepairBanner({ message, onOpen }) {
  const desc = message || '当前网关上没有原来的频道，请重新配对后让手机重新扫码';
  return (
    <TopWarn icon={IC.link} title="手机端通信需要重新配对" desc={desc}>
      <button className="btn sm primary" onClick={onOpen}>
        去重新配对
      </button>
    </TopWarn>
  );
}

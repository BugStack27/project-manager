import { IC } from '../icons.jsx';
import TopWarn from './TopWarn.jsx';

/**
 * 数据文件损坏提示条。
 * store 解析失败时会保留原 db.json 并锁写，本次运行的数据改动不会落盘，
 * 所以提示条不可关闭，只提供「备份与恢复」「数据文件」两个出口。
 */
export default function DataCorruptBanner({ status, onOpenBackup, onOpenDataDir }) {
  const count = status.backupCount || 0;
  return (
    <TopWarn
      title="数据文件损坏，已按空库启动"
      desc={
        '原 db.json 已原样保留，本次运行的数据改动不会保存。' +
        (count > 0 ? ' 检测到 ' + count + ' 份可用快照，可直接恢复。' : ' 暂无可用快照，可到数据目录中找回原文件。')
      }
      tip={status.message ? '解析错误：' + status.message : undefined}
    >
      <button className="btn sm" onClick={onOpenDataDir}>
        {IC.folder}
        数据文件
      </button>
      <button className="btn sm primary" onClick={onOpenBackup}>
        {IC.archive}
        备份与恢复
      </button>
    </TopWarn>
  );
}

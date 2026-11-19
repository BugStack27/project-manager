import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { fmtDateTime } from '../format.js';
import { IC } from '../icons.jsx';
import { Modal } from '../ui.jsx';

/**
 * 已归档需求弹窗：归档是应用内唯一没有回头路的动作，这里补上查看与一键恢复。
 * 数据直接读数据目录的 archive/（跨项目），恢复后回到原项目的「已完成」里。
 */
export default function ArchiveModal({ onClose, onRestored, notify }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.archivedRequirements();
      setItems(res.requirements || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function restore(item) {
    if (busyId) return;
    setBusyId(item.id);
    try {
      await api.restoreRequirement(item.id);
      setItems((list) => list.filter((x) => x.id !== item.id));
      notify(
        '#' + item.seq + ' 已恢复到' + (item.projectName ? '「' + item.projectName + '」' : '需求列表')
      );
      onRestored();
    } catch (e) {
      // 恢复失败时保留这一行：用户能看清是哪条没成功，必要时刷新再试
      notify(e.message, 'warn');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Modal wide onClose={busyId ? () => {} : onClose}>
      <h2>已归档需求</h2>
      <p className="archreq-hint">
        归档的需求不在列表与计数里。恢复后会回到原项目的「已完成」，状态与备注保持不变。
      </p>

      {loading ? (
        <div className="backup-state">正在读取归档…</div>
      ) : error ? (
        <div className="backup-state">
          <span>{error}</span>
          <button className="btn sm" onClick={load}>
            重试
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="backup-state">
          还没有归档的需求。在已完成列表里点「归档」才会把需求搬到这里。
        </div>
      ) : (
        <div className="archreq-list">
          {items.map((item) => (
            <div className="archreq-row" key={item.id}>
              <div className="archreq-main">
                <div className="archreq-title" title={item.title}>
                  <span className="mono">#{item.seq}</span>
                  <span className="archreq-name">{item.title}</span>
                  {item.projectName ? <span className="archreq-proj">{item.projectName}</span> : null}
                </div>
                <div className="archreq-meta">
                  已完成 · 归档于 {fmtDateTime(item.archivedAt)}
                  {item.projectExists ? '' : ' · 原项目已移除，无法恢复'}
                </div>
              </div>
              <button
                className="btn sm"
                disabled={!item.projectExists || !!busyId}
                title={item.projectExists ? '恢复到原项目的已完成列表' : '原项目已彻底移除，无法恢复'}
                onClick={() => restore(item)}
              >
                {busyId === item.id ? '恢复中…' : '恢复'}
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="mfoot split">
        <div className="left">
          <button className="btn" onClick={load} disabled={loading || !!busyId}>
            {IC.refresh}刷新
          </button>
        </div>
        <button className="btn" onClick={onClose} disabled={!!busyId}>
          关闭
        </button>
      </div>
    </Modal>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { IC } from '../icons.jsx';
import { DangerButton, Modal } from '../ui.jsx';

/** 快照文件大小的展示口径；几份 JSON 快照，KB 级足够 */
function fmtSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

/**
 * 备份与恢复弹窗。
 * 列出每日快照（最近 7 天）与手动安全备份，展示日期 / 大小 / 内容计数，
 * 两步确认后调用主进程恢复：先保全当前库，再覆盖 db.json 并自动重启。
 */
export default function BackupModal({ onClose, notify }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sel, setSel] = useState(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState(null);
  const [stoppingAll, setStoppingAll] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setRestoreError(null);
    try {
      const res = await api.backups();
      const list = res.backups || [];
      setData(res);
      // 默认选中最新一份可用快照；刷新后原选中项已失效时同样回退
      setSel((cur) => {
        const still = list.find((b) => b.name === cur && b.valid);
        const first = list.find((b) => b.valid);
        return still ? cur : first ? first.name : null;
      });
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const list = (data && data.backups) || [];
  const selected = list.find((b) => b.name === sel) || null;
  const groups = [
    { kind: 'daily', title: '每日快照 · 最近 7 天', rows: list.filter((b) => b.kind === 'daily') },
    { kind: 'manual', title: '手动安全备份 · 长期保留', rows: list.filter((b) => b.kind === 'manual') }
  ].filter((g) => g.rows.length);

  async function restore() {
    if (!selected || restoring) return;
    setRestoring(true);
    setRestoreError(null);
    try {
      await api.restoreBackup(selected.name);
      const when = selected.date + (selected.time ? ' ' + selected.time : '');
      notify('已恢复到 ' + when + '，应用即将重启');
    } catch (e) {
      setRestoring(false);
      // 有命令在运行时后端会拒绝：就地给「全部停止并重试」，不必逐个项目去启动台停
      setRestoreError({ message: e.message, code: e.code || null });
      notify(e.message, 'warn');
    }
  }

  /** 跨项目停掉全部运行中命令，确认没有残留后再走一次恢复 */
  async function stopAllAndRetry() {
    if (stoppingAll || restoring) return;
    setStoppingAll(true);
    try {
      const res = await api.stopAllCommands();
      const remaining = (res && res.remaining) || 0;
      if (remaining) {
        const err = new Error('仍有 ' + remaining + ' 条命令没有退出，请到启动台处理后再恢复');
        err.code = 'commands_running';
        throw err;
      }
      setRestoreError(null);
      setStoppingAll(false);
      await restore();
      return;
    } catch (e) {
      setRestoreError({ message: e.message, code: e.code || null });
      notify(e.message, 'warn');
    }
    setStoppingAll(false);
  }

  function row(b) {
    const on = b.name === sel;
    return (
      <button
        key={b.name}
        type="button"
        role="radio"
        aria-checked={on}
        className={'backup-row' + (on ? ' on' : '') + (b.valid ? '' : ' bad')}
        disabled={!b.valid || restoring || stoppingAll}
        title={b.valid ? b.name : '快照文件无法解析，不能恢复'}
        onClick={() => setSel(b.name)}
      >
        <span className="bradio">{on ? IC.check : null}</span>
        <span className="bmain">
          <span className="bdate">{b.date + (b.time ? ' ' + b.time : '')}</span>
          <span className="bmeta">
            {b.valid
              ? b.projectCount + ' 项目 · ' + b.requirementCount + ' 需求 · ' + b.commandCount + ' 命令'
              : '文件损坏，不可恢复'}
          </span>
        </span>
        {b.valid ? null : <span className="bbad">无法解析</span>}
        <span className="bsize">{fmtSize(b.size)}</span>
      </button>
    );
  }

  return (
    <Modal wide onClose={restoring || stoppingAll ? () => {} : onClose}>
      <h2>备份与恢复</h2>
      {loading ? (
        <div className="backup-state">正在读取快照…</div>
      ) : error ? (
        <div className="backup-state">
          <span>{error}</span>
          <button className="btn sm" onClick={load}>
            重试
          </button>
        </div>
      ) : groups.length === 0 ? (
        <div className="backup-state">还没有可用快照。应用每天首次写入前会自动生成一份。</div>
      ) : (
        <div className="backup-list">
          {groups.map((g) => (
            <section key={g.kind}>
              <div className="backup-group-hd">
                {g.title}
                <span>{g.rows.length}</span>
              </div>
              <div role="radiogroup" aria-label={g.title}>
                {g.rows.map(row)}
              </div>
            </section>
          ))}
        </div>
      )}

      {data && data.dir ? (
        <p className="backup-dir" title={data.dir}>
          快照目录：{data.dir}
        </p>
      ) : null}

      {restoreError ? (
        <div className="berr">
          <span>{restoreError.message}</span>
          {restoreError.code === 'commands_running' ? (
            <button className="btn sm" onClick={stopAllAndRetry} disabled={stoppingAll}>
              {stoppingAll ? '正在全部停止…' : '全部停止并重试'}
            </button>
          ) : null}
        </div>
      ) : null}

      {restoring ? (
        <div className="bwait">
          <span className="spinner" />
          正在恢复并重启应用…
        </div>
      ) : (
        <div className="mfoot split">
          <div className="left">
            <button className="btn" onClick={load} disabled={loading || stoppingAll}>
              {IC.refresh}刷新
            </button>
          </div>
          <button className="btn" onClick={onClose} disabled={stoppingAll}>
            取消
          </button>
          <DangerButton
            key={sel || 'none'}
            label="恢复此快照"
            confirmLabel="确认恢复并重启"
            onConfirm={restore}
            disabled={!selected || stoppingAll}
          />
        </div>
      )}
    </Modal>
  );
}

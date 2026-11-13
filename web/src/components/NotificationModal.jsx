import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Modal } from '../ui.jsx';

const ROWS = [
  {
    key: 'reviewReady',
    label: '需求交付待审核',
    hint: 'agent 交付后进入待审核时提醒'
  },
  {
    key: 'commandFailed',
    label: '命令异常退出',
    hint: '命令非 0 退出或启动失败时提醒；同一命令 5 分钟内只提醒一次'
  },
  {
    key: 'aiRequirement',
    label: 'AI 新增需求',
    hint: 'AI 巡检提交新需求时提醒；60 秒内的多条合并为一条'
  }
];

/** 通知设置：总开关 + 三类事件开关；托盘角标不受这里影响 */
export default function NotificationModal({ onClose, notify }) {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    api
      .notificationSettings()
      .then((res) => {
        if (alive) setSettings(res.notifications);
      })
      .catch((e) => {
        if (alive) setError(e.message || '读取通知设置失败');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [tick]);

  function set(key, value) {
    setSettings((s) => (s ? { ...s, [key]: value } : s));
  }

  async function save() {
    if (saving || !settings) return;
    setSaving(true);
    setError('');
    try {
      const res = await api.saveNotificationSettings(settings);
      setSettings(res.notifications);
      notify('通知设置已保存');
      onClose();
    } catch (e) {
      setError(e.message || '保存失败');
      setSaving(false);
    }
  }

  return (
    <Modal onClose={onClose}>
      <h2>通知设置</h2>

      {loading ? (
        <div className="loading">
          <span className="spinner" />
          正在读取…
        </div>
      ) : null}

      {error ? (
        <p className="sub" style={{ color: 'var(--red-text)' }}>
          {error}
          {!settings ? (
            <button className="btn sm" style={{ marginLeft: 8 }} onClick={() => setTick((n) => n + 1)}>
              重试
            </button>
          ) : null}
        </p>
      ) : null}

      {settings ? (
        <>
          <div className="field">
            <label className="checkline">
              <input
                type="checkbox"
                checked={!!settings.enabled}
                disabled={saving}
                onChange={(e) => set('enabled', e.target.checked)}
              />
              <span>启用系统通知</span>
            </label>
            <div className="hintline">关闭后三类都不发；需求、审计与托盘角标不受影响。</div>
          </div>

          <div className="field">
            <label>通知类型</label>
            {ROWS.map((row) => (
              <label className="checkline" key={row.key} title={row.hint}>
                <input
                  type="checkbox"
                  checked={!!settings[row.key]}
                  disabled={saving || !settings.enabled}
                  onChange={(e) => set(row.key, e.target.checked)}
                />
                <span>{row.label}</span>
              </label>
            ))}
          </div>

          <div className="mfoot">
            <button className="btn sm" onClick={onClose} disabled={saving}>
              取消
            </button>
            <button className="btn sm primary" onClick={save} disabled={saving}>
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </>
      ) : !loading ? (
        <div className="mfoot">
          <button className="btn sm" onClick={onClose}>
            关闭
          </button>
        </div>
      ) : null}
    </Modal>
  );
}

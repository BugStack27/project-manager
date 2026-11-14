import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { DangerButton, Modal } from '../ui.jsx';

function clock(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** 通道状态在主进程算，这里只翻成人话 */
function stateText(info) {
  if (!info.settings.enabled) return '未开启';
  if (!info.status.connected) return info.status.error ? '连接失败' : '正在连接…';
  return '已连接 ntfy';
}

/**
 * 手机端通信：桌面端用 ntfy 把「待审核」「待回答」推给手机，两端共用一套随机 topic 与连接密钥，
 * 消息在本地加密后再发，ntfy 只看到密文。
 *
 * 入口：左栏「设置与数据」→「通知与集成」→「手机端通信」。
 * 手机端是独立实现：二维码里的 JSON（server / topic / key）就是全部接入信息，协议见 doc/mobile-link.md。
 */
export default function MobileLinkModal({ onClose, notify }) {
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  /** 草稿只在首次加载时灌入：轮询刷新不能把用户正在编辑的地址冲掉 */
  const draftReady = useRef(false);

  const load = useCallback(async (silent) => {
    if (!silent) setLoading(true);
    try {
      const data = await api.mobileInfo();
      setInfo(data);
      setError('');
      if (!draftReady.current) {
        setUrl(data.settings.ntfyUrl);
        setToken(data.settings.token);
        draftReady.current = true;
      }
    } catch (e) {
      setError(e.message || '读取手机端通信状态失败');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /** 打开期间每 3 秒刷新一次在线状态；关掉弹窗就停，不做后台轮询 */
  useEffect(() => {
    const timer = setInterval(() => load(true), 3000);
    return () => clearInterval(timer);
  }, [load]);

  async function toggleEnabled(checked) {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      const res = await api.saveMobileSettings({ enabled: checked });
      setInfo((cur) => (cur ? { ...cur, settings: res.settings, session: res.session } : cur));
      await load(true);
      notify(checked ? '已开启手机端通道' : '已关闭手机端通道');
    } catch (e) {
      setError(e.message || '保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function saveConn() {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      const res = await api.saveMobileSettings({ ntfyUrl: url, token });
      setUrl(res.settings.ntfyUrl);
      setToken(res.settings.token);
      setInfo((cur) => (cur ? { ...cur, settings: res.settings, session: res.session } : cur));
      await load(true);
      notify('已保存 ntfy 配置');
    } catch (e) {
      setError(e.message || '保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function rotate() {
    if (rotating) return;
    setRotating(true);
    setError('');
    try {
      const data = await api.mobileRotate();
      setInfo(data);
      notify('已生成新会话，手机端需要重新扫码');
    } catch (e) {
      setError(e.message || '重新生成会话失败');
    } finally {
      setRotating(false);
    }
  }

  async function copy(text, okMsg) {
    if (!text) {
      notify('没有可复制的内容', 'warn');
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      notify(okMsg);
    } catch (_) {
      notify('复制失败，请手动选择文本复制', 'warn');
    }
  }

  const st = info ? info.status : null;
  const key = info ? info.session.key : '';
  const masked = key ? '•'.repeat(16) : '';

  return (
    <Modal onClose={onClose} wide>
      <h2>手机端通信</h2>
      <p className="sub">
        桌面端用 ntfy 把「待审核」「待回答」推给手机，消息先本地加密再发，ntfy
        只看到密文。手机端是独立实现，接入信息就是下面二维码里的 server / topic / key。
      </p>

      {loading && !info ? (
        <div className="loading">
          <span className="spinner" />
          正在读取…
        </div>
      ) : null}

      {error ? (
        <p className="sub" style={{ color: 'var(--red-text)' }}>
          {error}
          {!info ? (
            <button className="btn sm" style={{ marginLeft: 8 }} onClick={() => load()}>
              重试
            </button>
          ) : null}
        </p>
      ) : null}

      {info ? (
        <>
          <div className="ml-state">
            <span
              className={
                'ml-dot' + (info.settings.enabled ? (st.connected ? ' on' : ' wait') : '')
              }
            />
            <b>{stateText(info)}</b>
            <span className="ml-dim">
              手机 {st.clientOnline ? '在线' : '离线'}
              {st.clientLastSeenAt ? ' · ' + clock(st.clientLastSeenAt) : ''}
            </span>
            <span className="ml-dim">待推送 {st.pending || 0}</span>
            {st.lastPublishAt ? (
              <span className="ml-dim">上次发送 {clock(st.lastPublishAt)}</span>
            ) : null}
          </div>
          {st.error ? <p className="ml-err">{st.error}</p> : null}

          <div className="field">
            <label className="checkline">
              <input
                type="checkbox"
                checked={!!info.settings.enabled}
                disabled={saving}
                onChange={(e) => toggleEnabled(e.target.checked)}
              />
              <span>启用手机端通道</span>
            </label>
            <div className="hintline">
              开启后桌面端订阅 ntfy，只在等待审核 / 等待回答时推送；关闭即断开，不留后台连接。
            </div>
          </div>

          <div className="field">
            <label htmlFor="ml-url">ntfy 服务器</label>
            <div className="ml-row">
              <input
                id="ml-url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://ntfy.sh"
                spellCheck={false}
              />
              <input
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="访问令牌（可选，公共 ntfy.sh 不用填）"
                spellCheck={false}
              />
              <button className="btn sm" onClick={saveConn} disabled={saving}>
                保存
              </button>
            </div>
            <div className="hintline">自建 ntfy 需要鉴权时填访问令牌；公共 ntfy.sh 留空即可。</div>
          </div>

          <div className="ml-connect">
            <div className="ml-qr" dangerouslySetInnerHTML={{ __html: info.qrSvg }} />
            <div className="ml-info">
              <div className="ml-kv">
                <span>topic</span>
                <code>{info.session.topic}</code>
                <button
                  className="btn sm ghost"
                  onClick={() => copy(info.session.topic, '已复制 topic')}
                >
                  复制
                </button>
              </div>
              <div className="ml-kv">
                <span>连接密钥</span>
                <code>{showKey ? key : masked}</code>
                <button className="btn sm ghost" onClick={() => setShowKey((v) => !v)}>
                  {showKey ? '隐藏' : '显示'}
                </button>
                <button
                  className="btn sm ghost"
                  onClick={() => copy(key, '已复制连接密钥')}
                >
                  复制
                </button>
              </div>
              <div className="ml-kv">
                <span>创建于</span>
                <em>{clock(info.session.createdAt)}</em>
                {info.session.rotatedAt ? (
                  <em>最近轮换 {clock(info.session.rotatedAt)}</em>
                ) : null}
              </div>
              <div className="ml-acts">
                <button
                  className="btn sm"
                  onClick={() => copy(info.connect, '已复制连接信息')}
                >
                  复制连接信息
                </button>
                <DangerButton
                  label="重新生成会话"
                  confirmLabel="确认重新生成"
                  onConfirm={rotate}
                  disabled={rotating}
                />
              </div>
              <p className="hintline">
                手机端扫二维码即可拿到 ntfy 地址、topic 与密钥；重新生成后旧会话立即失效，手机端需要重扫。
              </p>
            </div>
          </div>
        </>
      ) : null}

      <div className="mfoot">
        <button className="btn primary" onClick={onClose}>
          完成
        </button>
      </div>
    </Modal>
  );
}

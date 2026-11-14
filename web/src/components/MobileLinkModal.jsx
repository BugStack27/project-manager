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
  return '已连接 PushGo';
}

/**
 * 手机端通信（PushGo Pull 版）。
 *
 * 桌面端注册一个 PushGo 设备、创建频道，把网关 + 频道 + 密码放进二维码；
 * 手机端扫码后订阅同一频道，双方用 Pull/ACK 收发加密消息。
 * 这是 Pull 原型：设备路由暂用 fcm + 随机 provider token 进入 Pull 队列，
 * 不依赖真实 FCM 送达；正式版可替换成 PushGo 私有 WSS。
 */
export default function MobileLinkModal({ onClose, notify }) {
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [gateway, setGateway] = useState('');
  /** 草稿只在首次加载时灌入：轮询刷新不能把用户正在编辑的地址冲掉 */
  const draftReady = useRef(false);

  const load = useCallback(async (silent) => {
    if (!silent) setLoading(true);
    try {
      const data = await api.mobileInfo();
      setInfo(data);
      setError('');
      if (!draftReady.current) {
        setGateway(data.settings.gateway);
        draftReady.current = true;
      }
    } catch (e) {
      setError(e.message || '读取 PushGo 通道状态失败');
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
      notify(checked ? '已开启 PushGo 通道' : '已关闭 PushGo 通道');
    } catch (e) {
      setError(e.message || '保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function saveGateway() {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      const res = await api.saveMobileSettings({ gateway });
      setGateway(res.settings.gateway);
      setInfo((cur) => (cur ? { ...cur, settings: res.settings, session: res.session } : cur));
      await load(true);
      notify('已保存 PushGo 网关');
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
      notify('已生成新的 PushGo 频道，手机端需要重新扫码');
    } catch (e) {
      setError(e.message || '重新生成频道失败');
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
  const session = info ? info.session : null;
  const password = session ? session.channelPassword : '';
  const masked = password ? '•'.repeat(Math.min(16, password.length)) : '';

  return (
    <Modal onClose={onClose} wide>
      <h2>手机端通信</h2>
      <p className="sub">
        桌面端与手机端各自注册一个 PushGo 设备、订阅同一频道，消息先本地加密再上传，网关只看到密文。
        手机端扫码即可拿到网关、频道与密码。
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
              <span>启用 PushGo 通道</span>
            </label>
            <div className="hintline">
              开启后桌面端每 15 秒拉一次手机答案、每分钟互发心跳；关闭即停止轮询，不留后台请求。
            </div>
          </div>

          <div className="field">
            <label htmlFor="ml-gateway">PushGo 网关</label>
            <div className="ml-row">
              <input
                id="ml-gateway"
                value={gateway}
                onChange={(e) => setGateway(e.target.value)}
                placeholder="https://gateway.pushgo.dev"
                spellCheck={false}
              />
              <button className="btn sm" onClick={saveGateway} disabled={saving}>
                保存
              </button>
            </div>
            <div className="hintline">
              公共网关可用 https://gateway.pushgo.dev 或 https://gateway.pushgo.cn；自建网关填自己的地址。
              更换网关会生成新频道，手机端需要重新扫码。
            </div>
          </div>

          {session && session.channelId ? (
            <div className="ml-connect">
              <div className="ml-qr" dangerouslySetInnerHTML={{ __html: info.qrSvg }} />
              <div className="ml-info">
                <div className="ml-kv">
                  <span>频道 ID</span>
                  <code>{session.channelId}</code>
                  <button
                    className="btn sm ghost"
                    onClick={() => copy(session.channelId, '已复制频道 ID')}
                  >
                    复制
                  </button>
                </div>
                <div className="ml-kv">
                  <span>频道密码</span>
                  <code>{showPassword ? password : masked}</code>
                  <button className="btn sm ghost" onClick={() => setShowPassword((v) => !v)}>
                    {showPassword ? '隐藏' : '显示'}
                  </button>
                  <button
                    className="btn sm ghost"
                    onClick={() => copy(password, '已复制频道密码')}
                  >
                    复制
                  </button>
                </div>
                <div className="ml-kv">
                  <span>创建于</span>
                  <em>{clock(session.createdAt)}</em>
                  {session.rotatedAt ? <em>最近轮换 {clock(session.rotatedAt)}</em> : null}
                </div>
                <div className="ml-acts">
                  <button
                    className="btn sm"
                    onClick={() => copy(info.connect, '已复制连接信息')}
                  >
                    复制连接信息
                  </button>
                  <DangerButton
                    label="重新生成频道"
                    confirmLabel="确认重新生成"
                    onConfirm={rotate}
                    disabled={rotating}
                  />
                </div>
                <p className="hintline">
                  手机端扫码后会自动注册设备并订阅该频道；重新生成后旧频道立即失效，手机端需要重扫。
                </p>
              </div>
            </div>
          ) : (
            <p className="sub">正在创建 PushGo 频道…</p>
          )}

          <p className="hintline" style={{ marginTop: 12 }}>
            当前是 Pull 原型：最多 15 秒延迟，单条上限 32 KB；公共网关没有每日条数限制，但受每分钟请求频率限制。
            正式版可切换为 PushGo 私有 WSS 通道。
          </p>
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

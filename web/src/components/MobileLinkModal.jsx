import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { DangerButton, Modal } from '../ui.jsx';

/**
 * 传输层报错自带实现名（「PushGo HTTP 502」之类）。页面上只给用户看得懂的说法，
 * 原文塞进 title，排查时鼠标停一下还能看到。
 */
function plainError(text) {
  const s = String(text || '');
  return /pushgo/i.test(s) ? '暂时连不上手机端服务，正在自动重试' : s;
}

/**
 * 远程通道错误 → 一句人话。
 * 隧道重连是常态（临时隧道没有 SLA），不该催用户动手；只有「拿不到 cloudflared」
 * 和「本机服务没起来」这两种才给重试按钮。
 */
function tunnelText(err) {
  if (!err) return '';
  if (err.code === 'cloudflared_download_failed' || err.code === 'cloudflared_missing') {
    return '远程通道没准备好：' + err.message;
  }
  if (err.code === 'mcp_down') return '远程通道没准备好：本机服务没起来';
  return '远程通道断开，正在自动重连';
}

function tunnelRetryable(err) {
  return !!err && (err.code === 'mcp_down' || String(err.code || '').indexOf('cloudflared') === 0);
}

/** 通道状态在主进程算，这里只翻成人话 */
function stateText(info) {
  if (!info.settings.enabled) return '未开启';
  if (!info.status.connected) return info.status.error ? '连接失败' : '正在连接…';
  return '已连接';
}

function clock(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** 手机端装好之后才谈得上扫码配对，下载入口固定指向手机端仓库的 Release 页 */
const MOBILE_RELEASES_URL = 'https://github.com/BugStack27/project-manager-mobile/releases/latest';

/**
 * 手机端通信。
 *
 * 界面只露「启用 + 配对二维码 + 频道 ID + 频道密码」。
 *
 * 网关不出现在界面上：它只承担「下发地址与中转」这一件事，业务状态、频道与密码都在本地生成，
 * 用户不需要为「地址从哪来」做决定，所以干脆不给配置入口，固定走默认值。
 * 传输细节见 doc/pushgo-link.md。
 */
export default function MobileLinkModal({ onClose, notify }) {
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  /** 远程通道状态：手机端通信一开就自动起隧道，失败时这里给一个重试出口 */
  const [tunnel, setTunnel] = useState(null);
  const [retrying, setRetrying] = useState(false);

  const load = useCallback(async (silent) => {
    if (!silent) setLoading(true);
    try {
      const data = await api.mobileInfo();
      setInfo(data);
      setError('');
      if (data.settings.enabled) {
        // 远程通道是附加信息：取不到不该把整个弹窗变成错误态
        try {
          setTunnel(await api.tunnelInfo());
        } catch (_) {
          setTunnel(null);
        }
      } else {
        setTunnel(null);
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
      notify(checked ? '已开启手机端通信' : '已关闭手机端通信');
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
      notify('已重新生成配对码，手机端需要重新扫码');
    } catch (e) {
      setError(e.message || '重新生成频道失败');
    } finally {
      setRotating(false);
    }
  }

  async function retryTunnel() {
    if (retrying) return;
    setRetrying(true);
    try {
      setTunnel(await api.tunnelRetry());
    } catch (e) {
      notify(e.message || '重试失败', 'warn');
    } finally {
      setRetrying(false);
    }
  }

  /** 下载页交给系统浏览器打开：Electron 窗口里直接跳外链会把应用本身带走 */
  async function openDownload() {
    try {
      await api.openUrl(MOBILE_RELEASES_URL);
    } catch (e) {
      notify(e.message || '无法打开下载页面', 'warn');
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
        开启后，桌面端会把访问地址与令牌推给手机，手机据此直接读取待审核的交付、待回答的问题，
        以及项目与改动。这条通道只负责下发接入点，不承载审批内容。
      </p>
      <p className="ml-dl">
        <span>手机上还没装？</span>
        <button className="btn sm ghost" onClick={openDownload}>
          前往 GitHub 下载
        </button>
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
            <span className="ml-dim">{st.hasEndpoint ? '已下发接入点' : '等待隧道地址'}</span>
            {st.lastPublishAt ? <span className="ml-dim">最近 {clock(st.lastPublishAt)}</span> : null}
          </div>
          {st.error ? (
            <p className="ml-err" title={st.error}>
              {plainError(st.error)}
            </p>
          ) : null}

          {tunnel && tunnel.preparing ? (
            <p className="hintline">正在准备远程通道：首次需要下载 cloudflared（约 40MB）…</p>
          ) : null}
          {tunnel && tunnel.error ? (
            <p className="ml-err" title={tunnel.error.message}>
              {tunnelText(tunnel.error)}
              {tunnelRetryable(tunnel.error) ? (
                <button
                  className="btn sm"
                  style={{ marginLeft: 8 }}
                  onClick={retryTunnel}
                  disabled={retrying}
                >
                  {retrying ? '重试中…' : '重试'}
                </button>
              ) : null}
            </p>
          ) : null}

          <div className="field">
            <label className="checkline">
              <input
                type="checkbox"
                checked={!!info.settings.enabled}
                disabled={saving}
                onChange={(e) => toggleEnabled(e.target.checked)}
              />
              <span>启用手机端通信</span>
            </label>
            <div className="hintline">关闭后手机拿不到接入点，也就连不上这台桌面端；本地一切照常。</div>
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
                <div className="ml-acts">
                  <button
                    className="btn sm"
                    onClick={() => copy(info.connect, '已复制配对信息')}
                  >
                    复制配对信息
                  </button>
                  <DangerButton
                    label="重新配对"
                    confirmLabel="确认重新配对"
                    onConfirm={rotate}
                    disabled={rotating}
                  />
                </div>
                <p className="hintline">
                  手机端扫上方二维码即可配对，也可以粘贴配对信息；重新配对后旧手机需要重扫。
                </p>
              </div>
            </div>
          ) : (
            <p className="sub">正在准备配对码…</p>
          )}
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

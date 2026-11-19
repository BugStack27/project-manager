import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { Modal } from '../ui.jsx';

/** 一轮自动拉取结果的一句话摘要：手动执行与上次启动结果共用 */
function describe(run) {
  if (!run) return '';
  const parts = [];
  if (run.pulled) parts.push('拉取 ' + run.pulled + ' 个' + (run.commits ? '（共 ' + run.commits + ' 个提交）' : ''));
  if (run.failed) parts.push('失败 ' + run.failed + ' 个');
  return parts.length ? parts.join(' · ') : '已是最新，没有需要拉取的提交';
}

/** 进度列表里单个项目的状态文案：等待 / 正在同步 / 已同步完 / 已跳过 / 失败 */
function progressText(it) {
  if (!it || it.state === 'waiting') return '等待中';
  if (it.state === 'running') return '正在同步…';
  if (it.status === 'pulled') return '已同步' + (it.commits ? ' ' + it.commits + ' 个提交' : '');
  if (it.status === 'failed') return it.message || '失败';
  if (it.code === 'up_to_date') return '已是最新';
  return it.message || '已跳过';
}

/** 后台巡检间隔的人话（600000 → 「10 分钟」） */
function every(ms) {
  const min = Math.round((ms || 0) / 60000);
  if (!min) return '';
  return min >= 60 ? Math.round(min / 60) + ' 小时' : min + ' 分钟';
}

/** 时间戳只到分钟：弹窗里不需要秒，短一点更好扫 */
function clock(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/**
 * 代码同步：先给「现在该做什么」——有更新就一键拉取，没更新就一句话交代，
 * 再往下才是自动同步的两个开关和最近一轮结果。
 */
export default function GitSettingsModal({ onClose, notify }) {
  const [settings, setSettings] = useState(null);
  const [status, setStatus] = useState(null);
  const [scan, setScan] = useState(null);
  /** 本轮逐项目进度：一键拉取期间轮询 autoPullStatus 拿到，结束后清空 */
  const [progress, setProgress] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  /** 正在跑的动作：'' | 'pull' | 'check' */
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [s, st, rc] = await Promise.all([api.gitSettings(), api.autoPullStatus(), api.remoteCheckStatus()]);
      setSettings(s.git);
      setStatus(st);
      setScan(rc);
      // 打开弹窗时可能已有一轮拉取在跑（启动自动拉取 / 另一个入口触发的）：直接接管它的进度
      if (st && st.running && st.progress) setProgress(st.progress);
    } catch (e) {
      setError(e.message || '读取代码同步设置失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * 有拉取在跑就轮询进度：一键拉取与「打开弹窗时启动拉取还没结束」共用同一条路径，
   * 逐项目显示等待 / 正在同步 / 已完成。跑完后把最终状态落回 status，进度列表收掉。
   */
  const statusRunning = !!(status && status.running);
  useEffect(() => {
    if (!statusRunning) return undefined;
    let alive = true;
    const tick = async () => {
      try {
        const st = await api.autoPullStatus();
        if (!alive) return;
        if (st && st.progress) setProgress(st.progress);
        if (st && !st.running) {
          setStatus(st);
          setProgress(null);
          api.remoteCheckStatus().then(setScan).catch(() => {});
        }
      } catch (_) {
        // 进度只是辅助信息，取不到不影响拉取本身
      }
    };
    tick();
    const timer = setInterval(tick, 700);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [statusRunning]);

  /** 开关即时生效：勾上就存，不必再找「保存」按钮；失败回滚并说明原因 */
  async function toggleSetting(key, checked) {
    if (saving || busy || !settings) return;
    const prev = settings;
    setSettings({ ...prev, [key]: checked });
    setSaving(true);
    setError('');
    try {
      const res = await api.saveGitSettings({ ...prev, [key]: checked });
      setSettings(res.git);
    } catch (e) {
      setSettings(prev);
      setError(e.message || '保存失败');
    } finally {
      setSaving(false);
    }
  }

  /** 立刻联网检查一轮远程：与定时器跑的是同一段逻辑，手动触发不受总开关拦截 */
  async function checkRemote() {
    if (busy) return;
    setBusy('check');
    setError('');
    try {
      await api.remoteCheckNow();
      setScan(await api.remoteCheckStatus());
    } catch (e) {
      setError(e.message || '检查失败');
    } finally {
      setBusy('');
    }
  }

  /**
   * 一键拉取：不看自动开关，把所有项目快进拉一遍（与「立即检查」同一口径：
   * 手点下去就说明此刻想同步）。多仓库时等待可能很久，所以先置 running，
   * 由下面的轮询把逐项目进度画出来；拉完再巡检一轮刷新待拉取数。
   */
  async function pullAll() {
    if (busy) return;
    setBusy('pull');
    setError('');
    setProgress(null);
    setStatus((s) => ({ running: true, last: s ? s.last : null }));
    try {
      const res = await api.autoPullNow(true);
      setStatus({ running: false, last: res });
      // 用最终结果覆盖最后一次轮询：避免轮询恰好停在「还有几个没标完」的中间态
      if (res && Array.isArray(res.items)) {
        setProgress({
          total: res.total,
          done: res.total,
          items: res.items.map((it) => ({ ...it, state: 'done' }))
        });
      }
      notify('同步完成：' + describe(res));
      setBusy('check');
      await api.remoteCheckNow();
      setScan(await api.remoteCheckStatus());
    } catch (e) {
      setError(e.message || '拉取失败');
    } finally {
      setProgress(null);
      setBusy('');
    }
  }

  const last = status && status.last;
  /** 待拉取明细：只列真的落后上游的项目，顺序跟侧栏项目顺序一致 */
  const behindItems = ((scan && scan.items) || []).filter((it) => it.behind > 0);
  const behindCommits = behindItems.reduce((n, it) => n + (it.behind || 0), 0);
  /** 失败列表：成功数已经在摘要里了，逐条列出来只为了看谁没拉成 */
  const failures = (last && last.items ? last.items : []).filter((it) => it.status === 'failed');

  const currentSyncing = ((progress && progress.items) || []).find((it) => it.state === 'running');
  const progressSub =
    progress && progress.total
      ? '已完成 ' + progress.done + '/' + progress.total + (currentSyncing ? ' · 正在同步 ' + currentSyncing.name : '')
      : '逐个项目快进合并，稍等片刻';

  let heroTitle = '还没检查过远程';
  let heroSub = '点「检查更新」看看有没有新提交';
  if (busy === 'pull') {
    heroTitle = '正在同步…';
    heroSub = progressSub;
  } else if (busy === 'check') {
    heroTitle = '正在检查远程…';
    heroSub = '只抓取引用，不改动代码';
  } else if (statusRunning) {
    // 打开弹窗时启动自动拉取还没跑完：给出同一份逐项目进度，并挡住会撞车的按钮
    heroTitle = '正在同步…';
    heroSub = progressSub;
  } else if (behindItems.length) {
    heroTitle = behindItems.length + ' 个项目有新提交';
    heroSub = '共 ' + behindCommits + ' 个提交待拉取' + (scan && scan.last ? ' · 检查于 ' + clock(scan.last.finishedAt) : '');
  } else if (scan && scan.items && scan.items.length) {
    heroTitle = '全部项目已是最新';
    heroSub = scan.last ? '检查于 ' + clock(scan.last.finishedAt) : '';
  }

  return (
    <Modal onClose={onClose}>
      <h2>代码同步</h2>
      <p className="sub">把项目代码拉到最新；有未提交改动的项目会自动跳过，不会被覆盖。</p>

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
            <button className="btn sm" style={{ marginLeft: 8 }} onClick={load}>
              重试
            </button>
          ) : null}
        </p>
      ) : null}

      {settings ? (
        <>
          <div className="gs-hero">
            <div className="gs-hero-l">
              <div className="gs-hero-t">{heroTitle}</div>
              <div className="gs-hero-s">{heroSub}</div>
            </div>
            <div className="gs-hero-r">
              <button className="btn sm ghost" onClick={checkRemote} disabled={!!busy || saving || statusRunning} title="重新查询远程有没有新提交">
                {busy === 'check' ? '检查中…' : '检查更新'}
              </button>
              <button
                className="btn sm primary"
                onClick={pullAll}
                disabled={!!busy || saving || statusRunning}
                title="把所有项目快进拉取到最新"
              >
                {busy === 'pull' ? '拉取中…' : '一键拉取'}
              </button>
            </div>
          </div>

          {progress && progress.items && progress.items.length ? (
            <ul className="apull-list gs-progress">
              {progress.items.map((it) => (
                <li key={it.projectId} className={(it.status === 'failed' ? 'failed ' : '') + it.state}>
                  <span className="nm">{it.name}</span>
                  <span className="nt">
                    {it.state === 'running' ? <span className="spinner" /> : null}
                    {progressText(it)}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}

          {!progress && behindItems.length ? (
            <ul className="apull-list gs-behind">
              {behindItems.map((it) => (
                <li key={it.projectId}>
                  <span className="nm">{it.name}</span>
                  <span className="nt" title={it.error || it.upstream || ''}>
                    {'↓' + it.behind}
                    {it.upstream ? ' · ' + it.upstream : ''}
                    {it.error ? ' · 抓取失败，数字可能过期' : ''}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}

          {last ? (
            <div className="gs-last">
              上次同步：{describe(last)}
              {last.finishedAt ? ' · ' + clock(last.finishedAt) : ''}
            </div>
          ) : null}

          {failures.length ? (
            <ul className="apull-list gs-behind">
              {failures.map((it) => (
                <li key={it.projectId} className="failed">
                  <span className="nm">{it.name}</span>
                  <span className="nt">{it.message || '拉取失败'}</span>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="gs-sec">
            <div className="gs-sec-h">
              自动同步
              <span className="auto">{saving ? '保存中…' : '改动即时保存'}</span>
            </div>

            <label className="checkline">
              <input
                type="checkbox"
                checked={!!settings.autoPullOnLaunch}
                disabled={saving || !!busy}
                onChange={(e) => toggleSetting('autoPullOnLaunch', e.target.checked)}
              />
              <span>启动时自动拉取代码</span>
            </label>
            <div className="hintline">每次打开软件拉取一次；项目设置里可单独覆盖。</div>

            <label className="checkline">
              <input
                type="checkbox"
                checked={!!settings.remoteCheck}
                disabled={saving || !!busy}
                onChange={(e) => toggleSetting('remoteCheck', e.target.checked)}
              />
              <span>后台定期检查远程更新</span>
            </label>
            <div className="hintline">
              只查不改{scan && scan.intervalMs ? '，每 ' + every(scan.intervalMs) + ' 一次' : ''}，用来在左栏提示哪个项目有代码没拉。
            </div>
          </div>

          <div className="mfoot">
            <button className="btn sm primary" onClick={onClose} disabled={saving || !!busy}>
              完成
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

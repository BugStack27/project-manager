import { useEffect, useState } from 'react';
import {
  DEFAULT_BINDINGS,
  SHORTCUT_ACTIONS,
  bindingOf,
  formatBinding,
  isAllowedBinding,
  isModifierOnly,
  sameBinding
} from '../lib/shortcuts.js';
import { Modal } from '../ui.jsx';

/** 按键胶囊：把绑定拆成 Ctrl / Shift / K 这样的小块，与命令面板里的 kbd 同款观感 */
function KeyChips({ binding }) {
  return formatBinding(binding)
    .filter(Boolean)
    .map((t, i) => <kbd key={i}>{t}</kbd>);
}

/**
 * 快捷键查看与设置。入口：左栏「设置与数据」→ 键盘快捷键，或默认的 Ctrl / ⌘ + /。
 * 修改走「录制」：点修改后按下一组键即生效并持久化；Esc 只取消录制，不关弹窗。
 * 校验与冲突判断都在 useShortcuts.setBinding 里，这里只负责展示错误。
 */
export default function ShortcutSettingsModal({
  bindings,
  setBinding,
  resetOne,
  resetAll,
  onClose,
  notify
}) {
  /** 正在录制的动作 id（null = 不在录制） */
  const [recordingId, setRecordingId] = useState(null);
  /** 录制中按住的修饰键预览：只有按下主键才会真正保存 */
  const [preview, setPreview] = useState(null);
  /** 当前行的错误提示 { id, msg }：非法组合 / 冲突 */
  const [error, setError] = useState(null);
  /** 「全部恢复默认」的二次确认态，4 秒后自动撤销 */
  const [confirmAll, setConfirmAll] = useState(false);

  useEffect(() => {
    if (!confirmAll) return undefined;
    const t = setTimeout(() => setConfirmAll(false), 4000);
    return () => clearTimeout(t);
  }, [confirmAll]);

  useEffect(() => {
    if (!recordingId) return undefined;
    const onKey = (e) => {
      // 录制期间吞掉所有按键：既不触发浏览器默认行为，也不让 Modal 的 Esc 关掉整层
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        setRecordingId(null);
        setPreview(null);
        setError(null);
        return;
      }
      const next = bindingOf(e);
      if (isModifierOnly(e)) {
        // 只按修饰键时把主键清空：胶囊里只显示已按下的修饰键，后面跟一个「…」等主键
        setPreview({ ...next, key: '' });
        return;
      }
      if (!isAllowedBinding(next)) {
        setPreview(next);
        setError({ id: recordingId, msg: '快捷键需要包含 Ctrl / ⌘ 或 Alt' });
        return;
      }
      const msg = setBinding(recordingId, next);
      if (msg) {
        setPreview(next);
        setError({ id: recordingId, msg });
        return;
      }
      setRecordingId(null);
      setPreview(null);
      setError(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [recordingId, setBinding]);

  function startRecord(id) {
    if (recordingId === id) {
      setRecordingId(null);
      setPreview(null);
      setError(null);
      return;
    }
    setRecordingId(id);
    setPreview(null);
    setError(null);
  }

  function restoreOne(id) {
    if (recordingId) {
      setRecordingId(null);
      setPreview(null);
    }
    const msg = resetOne(id);
    setError(msg ? { id, msg } : null);
  }

  function restoreAll() {
    if (!confirmAll) {
      setConfirmAll(true);
      return;
    }
    setConfirmAll(false);
    setRecordingId(null);
    setPreview(null);
    setError(null);
    resetAll();
    notify('已恢复全部默认快捷键');
  }

  return (
    <Modal onClose={onClose} wide>
      <h2>键盘快捷键</h2>
      <p className="sub">
        点「修改」后按下新的组合键即可生效，修改会立即保存在本机。快捷键在弹窗打开或输入框聚焦时不生效。
      </p>

      <ul className="sc-list">
        {SHORTCUT_ACTIONS.map((a) => {
          const recording = recordingId === a.id;
          const isDefault = sameBinding(bindings[a.id], DEFAULT_BINDINGS[a.id]);
          const err = error && error.id === a.id ? error.msg : null;
          return (
            <li className={'sc-row' + (recording ? ' recording' : '')} key={a.id}>
              <div className="sc-main">
                <span className="sc-name">
                  {a.label}
                  {recording ? <span className="sc-badge">录制中</span> : null}
                </span>
                <span className="sc-desc">{a.desc}</span>
                {err ? (
                  <span className="sc-err" role="alert">
                    {err}
                  </span>
                ) : null}
              </div>

              <div className="sc-keys">
                {recording ? (
                  preview && preview.key ? (
                    <KeyChips binding={preview} />
                  ) : preview ? (
                    <>
                      <KeyChips binding={preview} />
                      <span className="sc-more">…</span>
                    </>
                  ) : (
                    <span className="sc-wait">按下组合键…</span>
                  )
                ) : (
                  <KeyChips binding={bindings[a.id]} />
                )}
              </div>

              <div className="sc-acts">
                <button className="btn sm" onClick={() => startRecord(a.id)}>
                  {recording ? '取消' : '修改'}
                </button>
                <button
                  className="btn sm ghost"
                  disabled={isDefault}
                  title={isDefault ? '已经是默认组合' : '恢复默认组合'}
                  onClick={() => restoreOne(a.id)}
                >
                  恢复默认
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <p className="sc-foot-note">组合键必须包含 Ctrl / ⌘ 或 Alt；与其它动作重复时不会保存。</p>

      <div className="mfoot split">
        <div className="left">
          <button className={'btn sm ' + (confirmAll ? 'danger' : 'ghost')} onClick={restoreAll}>
            {confirmAll ? '确认全部恢复默认？' : '全部恢复默认'}
          </button>
        </div>
        <button className="btn primary" onClick={onClose}>
          完成
        </button>
      </div>
    </Modal>
  );
}

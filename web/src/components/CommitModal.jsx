import { useEffect, useRef, useState } from 'react';
import { fmtDateTime } from '../format.js';
import { IC } from '../icons.jsx';
import { COMMIT_TYPES, buildCommitMessage, splitCommitMessage, stripCommitPrefix } from '../lib/commit-message.js';
import { Modal } from '../ui.jsx';

function ErrorLine({ msg }) {
  if (!msg) return null;
  return (
    <p className="sub" style={{ color: 'var(--red-text)', marginBottom: 10 }}>
      {msg}
    </p>
  );
}

/**
 * 修改记录 · 提交弹窗。
 * 提交信息分标题 / 正文两块：标题左侧内嵌类型选择，选中后提交时自动补 `类型: ` 前缀。
 * 有 requirement（待审核）时预填 agent 单独提供的提交信息，并可勾选「提交后自动审核」。
 * 给用户的交付说明属于会话记录，不在这里出现，也就不会被当成提交正文。
 */
export default function CommitModal({ project, requirement, changeCount, onClose, onSubmit }) {
  const initial = splitCommitMessage(buildCommitMessage(requirement));
  const [subject, setSubject] = useState(initial.subject);
  const [body, setBody] = useState(initial.body);
  /** 选中的提交类型（空串 = 不加前缀）；agent 写好的标准前缀预选，拆标题时才不会丢 */
  const [commitType, setCommitType] = useState(initial.type || '');
  const [typeOpen, setTypeOpen] = useState(false);
  /** 自动审核只在存在待审核需求时有意义，且默认勾选 */
  const [approve, setApprove] = useState(!!requirement);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const typeRef = useRef(null);

  // 点下拉以外的地方收起菜单（输入框、正文、弹窗空白都算）
  useEffect(() => {
    if (!typeOpen) return undefined;
    const onDown = (e) => {
      if (!typeRef.current || !typeRef.current.contains(e.target)) setTypeOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [typeOpen]);

  const activeType = COMMIT_TYPES.find((t) => t.value === commitType);
  /** 标题去掉前缀后必须有内容：只剩一个 `feat:` 不算可提交 */
  const canSubmit = !busy && stripCommitPrefix(subject).trim().length > 0;

  function pickType(value) {
    setCommitType(value);
    setTypeOpen(false);
  }

  async function submit(e) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setTypeOpen(false);
    setErr('');

    const title = stripCommitPrefix(subject).trim();
    const head = commitType ? commitType + ': ' + title : title;
    const message = body.trim() ? head + '\n\n' + body.trim() : head;
    try {
      await onSubmit(message, approve && requirement ? requirement.id : null);
    } catch (e2) {
      setErr(e2.message || '提交失败');
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose}>
      <form onSubmit={submit}>
        <h2>提交改动</h2>
        <p className="sub">
          {project.name} · {changeCount} 个文件将被暂存并提交到本地（不推送）
        </p>

        <ErrorLine msg={err} />

        {requirement ? (
          <>
            <div className="oldnote">
              <span>
                待审核需求 #{requirement.seq} · {requirement.title}
                {requirement.completion
                  ? ' · ' +
                    (requirement.completion.agentName || requirement.completion.agent) +
                    ' ' +
                    fmtDateTime(requirement.completion.at)
                  : ''}
              </span>
              <p>
                {requirement.completion && requirement.completion.commitMessage
                  ? '提交信息由 agent 单独提供，已原样预填在下方；给用户的交付说明只留在往返记录，不会写进 git 提交。'
                  : 'agent 未提供独立的提交信息，下方沿用「#编号 标题」；给用户的交付说明只留在往返记录，不会写进 git 提交。'}
              </p>
            </div>
            <div className="field">
              <label className="checkline">
                <input
                  type="checkbox"
                  checked={approve}
                  disabled={busy}
                  onChange={(e) => setApprove(e.target.checked)}
                />
                提交后把该需求标记为已完成（自动审核）
              </label>
              <div className="hintline">不勾选则需求仍停在待审核，之后可在需求中心手动验收</div>
            </div>
          </>
        ) : (
          <p className="sub">当前没有待审核的需求。</p>
        )}

        <div className="field">
          <label>提交信息</label>
          <div className="commit-box">
            <div className="commit-head">
              <div className="commit-type" ref={typeRef}>
                <button
                  type="button"
                  className={'commit-type-btn' + (commitType ? ' set t-' + commitType : '')}
                  disabled={busy}
                  onClick={() => setTypeOpen((o) => !o)}
                >
                  {commitType || '类型'}
                  {IC.chevDown}
                </button>
                {typeOpen ? (
                  <div className="commit-type-menu" role="listbox">
                    <button
                      type="button"
                      className={'opt t-none' + (commitType ? '' : ' active')}
                      onClick={() => pickType('')}
                    >
                      <span className="v">无前缀</span>
                      <span className="d">标题前不加类型</span>
                    </button>
                    {COMMIT_TYPES.map((t) => (
                      <button
                        type="button"
                        key={t.value}
                        className={'opt t-' + t.value + (commitType === t.value ? ' active' : '')}
                        onClick={() => pickType(t.value)}
                      >
                        <span className="v">{t.value}</span>
                        <span className="d">{t.desc}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <input
                autoFocus
                className="commit-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="提交标题，例如：完成 xxx"
                spellCheck={false}
              />
            </div>
            <textarea
              className="commit-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="补充说明（选填）"
              spellCheck={false}
            />
          </div>
          <div className="hintline">
            {activeType
              ? activeType.value + '：' + activeType.desc
              : '标题左侧选类型后，提交时会自动补前缀（如 feat: ）'}
          </div>
          <div className="hintline">将自动 git add -A（项目目录范围）后提交</div>
        </div>

        <div className="mfoot">
          <button type="button" className="btn sm" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button type="submit" className="btn sm primary" disabled={!canSubmit}>
            {busy ? '提交中…' : '提交'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

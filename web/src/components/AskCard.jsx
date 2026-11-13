import { useState } from 'react';
import MarkdownText from './MarkdownText.jsx';
import { fmtClock, fmtDateTime } from '../format.js';
import { IC } from '../icons.jsx';

/**
 * 一条待回答的提问。
 *
 * 服务端允许一条需求同时挂多条提问，所以每张卡自己持有草稿与提交态：
 * 答完第一条不会把第二条写了一半的字冲掉，也不会让两条共用一个「提交中」。
 * 顺序号只在多条时显示，单条时保持原来的样子。
 */
export default function AskCard({ question, index, total, skills, onAnswer }) {
  const [answer, setAnswer] = useState('');
  const [answering, setAnswering] = useState(false);
  const [err, setErr] = useState('');

  async function submit() {
    if (answering || !onAnswer) return;
    const text = answer.trim();
    if (!text) {
      setErr('回答不能为空');
      return;
    }
    setAnswering(true);
    setErr('');
    try {
      await onAnswer(text, question.id);
      setAnswer('');
    } catch (e) {
      setErr(e.message || '提交失败');
    } finally {
      setAnswering(false);
    }
  }

  const label = total > 1 ? `第 ${index + 1}/${total} 条提问` : '卡在这里等你回答';
  const options = Array.isArray(question.options) ? question.options : [];

  return (
    <div className="rd-ask">
      <div className="rd-ask-hd">
        <span className="rd-ask-ico">{IC.chat}</span>
        <b>{question.agentName || question.agent}</b>
        <span className="rd-ask-wait">{label}</span>
        <span className="meta">{fmtDateTime(question.at)}</span>
      </div>
      <MarkdownText
        className="rd-ask-q"
        skills={Array.isArray(question.skills) ? question.skills : skills}
      >
        {question.text}
      </MarkdownText>
      {question.expiresAt ? (
        <p className="rd-ask-hint">
          {fmtClock(question.expiresAt)} 前不回答，
          {question.default
            ? '按默认继续：' +
              (question.default.length > 60
                ? question.default.slice(0, 60) + '…'
                : question.default)
            : '这次提问作废（不再补答）'}
        </p>
      ) : null}
      {options.length ? (
        <div className="rd-ask-opts">
          {/* 候选只负责「省打字」：点一下填进回答框，仍可改完再提交，避免误点写错答案 */}
          {options.map((opt) => (
            <button
              key={opt}
              className={'rd-ask-opt' + (answer.trim() === opt ? ' sel' : '')}
              onClick={() => setAnswer(opt)}
              title="填入回答框，可改完再提交"
            >
              {opt}
            </button>
          ))}
        </div>
      ) : null}
      {/* 复用 .field textarea 的输入框样式，面板里不再另写一套 */}
      <div className="field">
        <textarea
          rows={3}
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          placeholder="回答会写进往返记录；同一个 agent 下一轮自动接着做"
        />
      </div>
      {err ? <p className="rd-err">{err}</p> : null}
      <div className="rd-ask-foot">
        {/* disabled 的按钮收不到 hover，原因必须挂在能悬停的外层 */}
        <span
          className="rd-ask-tip"
          title={!answer.trim() ? '先填写回答再提交' : '把回答写进往返记录，让 agent 继续'}
        >
          <button className="btn sm primary" onClick={submit} disabled={answering || !answer.trim()}>
            {answering ? '提交中…' : total > 1 ? '回答这条' : '回答并继续'}
          </button>
        </span>
      </div>
    </div>
  );
}

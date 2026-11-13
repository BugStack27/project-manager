import { STATUS } from '../constants.js';

/**
 * 需求引用的悬停信息窗：与项目卡（.phover）同族，只摊开「是哪条 / 现在什么状态 / 讲了什么」。
 * 正文就在服务端解析结果 reqRefs[].body 里，不必再打一次接口；
 * 摘要折叠空白后截断，卡片不能比正文还长。点 chip 才看完整需求。
 */
const SUMMARY_MAX = 240;

function summary(body) {
  const s = String(body || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  return s.length > SUMMARY_MAX ? s.slice(0, SUMMARY_MAX) + '…' : s;
}

export default function RequirementHoverCard({ req, left, top, onEnter, onLeave }) {
  if (!req) return null;
  const st = STATUS[req.status];
  const text = summary(req.body);

  return (
    <div className="rqhover" style={{ left, top }} onMouseEnter={onEnter} onMouseLeave={onLeave} role="tooltip">
      <div className="rq-head">
        <span className="rq-seq">#{req.seq}</span>
        <span className="rq-title">{req.title || '（无标题）'}</span>
      </div>
      <div className="rq-status">
        <span className="rq-badge">{st ? st.label : req.status || '状态未知'}</span>
        <span className="rq-hint">点击打开这条需求</span>
      </div>
      <div className="rq-body">{text || '（无正文）'}</div>
    </div>
  );
}

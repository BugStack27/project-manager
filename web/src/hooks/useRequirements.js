import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { UNFINISHED } from '../constants.js';

/**
 * 状态变更后给用户的提示文案。
 * 每个出口的措辞只在这里定一次：调用方（列表行、详情面板、弹窗）都只是转发，不各自拼句子。
 */
function statusNotice(r, status, feedback) {
  if (r.status === 'candidate' && status === 'todo') return '已采纳，进入未开始，agent 可以认领了';
  if (r.status === 'review' && status === 'doing') {
    return feedback ? '已打回，原因会随认领返回给 agent' : '已打回，等待 agent 继续修改';
  }
  if (r.status === 'review' && status === 'done') return '审核通过';
  if (status === 'todo' && feedback) return '已撤销，原因会随认领返回给 agent';
  if (status === 'todo' && r.claim) return '已撤销，认领已释放';
  return { doing: '进入进行中', done: '已完成', rejected: '已拒绝', todo: '已撤销回未开始' }[status];
}

/**
 * 需求中心的数据与动作：列表加载 / 轮询、筛选、右面板选中项，
 * 以及需求的新建、状态流转、详情保存、回答与删除。
 */
export function useRequirements({ page, pid, project, modal, notify, setModal, loadProjects, openRight }) {
  const [reqs, setReqs] = useState([]);
  const [reqLoading, setReqLoading] = useState(false);
  const [filter, setFilter] = useState('unfinished');
  /** 需求中心右面板正在查看的需求 id（null = 未选中，显示提示） */
  const [selReqId, setSelReqId] = useState(null);

  /** reqs 属于哪个项目：切项目时旧数据还在 state 里，不能拿它做默认选中 */
  const reqsPid = useRef(null);

  const loadReqs = useCallback(
    async (id, silent) => {
      if (!id) return;
      if (!silent) setReqLoading(true);
      try {
        const { requirements } = await api.requirements(id);
        setReqs(requirements);
        reqsPid.current = id;
        return requirements;
      } catch (e) {
        if (!silent) notify(e.message, 'warn');
      } finally {
        if (!silent) setReqLoading(false);
      }
    },
    [notify]
  );

  /** 静默刷新需求列表：提交改动验收完需求后，右面板要跟着更新 */
  const reloadRequirements = useCallback((id) => loadReqs(id, true), [loadReqs]);

  useEffect(() => {
    if (!pid) {
      setReqs([]);
      reqsPid.current = null;
      setFilter('unfinished');
      return;
    }
    setFilter('unfinished');
    loadReqs(pid);
  }, [pid, loadReqs]);

  // 切换项目时清空右面板选中项，避免详情指向上一项目的需求
  useEffect(() => {
    setSelReqId(null);
  }, [pid]);

  useEffect(() => {
    if (page !== 'req' || !pid) return undefined;
    const t = setInterval(() => loadReqs(pid, true), 5000);
    return () => clearInterval(t);
  }, [page, pid, loadReqs]);

  /* ── 动作 ─────────────────────────────────── */

  function openNewRequirement() {
    if (!project) return;
    setModal({ type: 'requirement' });
  }

  async function saveRequirement(data) {
    const res = await api.createRequirement(pid, data);
    const candidate = res.requirement.status === 'candidate';
    notify((candidate ? '已放进候选池 #' : '已创建需求 #') + res.requirement.seq);
    setModal(null);
    // 放进候选池就切到候选池页签：留在「未完成」里会看不到刚建的那条，像没保存成功
    if (candidate) setFilter('candidate');
    await Promise.all([loadReqs(pid, true), loadProjects()]);
  }

  /** 详情面板内保存：改标题 / 正文 / 备注后落库并刷新列表与统计 */
  async function saveRequirementDetail(r, patch) {
    try {
      await api.updateRequirement(r.id, patch);
      notify('需求已更新');
      await Promise.all([loadReqs(pid, true), loadProjects()]);
    } catch (e) {
      notify(e.message, 'warn');
      throw e;
    }
  }

  /** 回答 agent 的提问：写回往返记录并清掉这条待回答标记，随后刷新列表与计数 */
  async function answerRequirement(r, text, qid) {
    try {
      await api.answerRequirement(r.id, text, qid);
      notify('已回答 #' + r.seq + ' 的提问');
      await Promise.all([loadReqs(pid, true), loadProjects()]);
    } catch (e) {
      notify(e.message, 'warn');
      throw e;
    }
  }

  /** 真正落库的状态变更；note 传 undefined 表示不动备注，feedback 只在打回 / 撤销重开时使用 */
  async function applyStatus(r, status, note, feedback) {
    try {
      await api.setRequirementStatus(r.id, status, note, feedback);
      const label = statusNotice(r, status, feedback);
      notify(label ? '#' + r.seq + ' ' + label : '状态已更新');
      await Promise.all([loadReqs(pid, true), loadProjects()]);
    } catch (e) {
      notify(e.message, 'warn');
      await Promise.all([loadReqs(pid, true), loadProjects()]);
      throw e;
    }
  }

  /** 待审核详情里点「通过」：不填备注，直接完成并唤醒挂起的交付请求 */
  async function approveRequirement(r) {
    await applyStatus(r, 'done');
  }

  /** 待审核详情里点「继续回复」：打回并带上修改意见，agent 接着做后再次交付 */
  async function replyRequirement(r, text) {
    const t = String(text || '').trim();
    if (!t) throw new Error('回复不能为空');
    await applyStatus(r, 'doing', undefined, t);
  }

  /**
   * 点「标记已完成 / 拒绝 / 打回 / 撤销已完成」先弹窗：终态下原备注（AI 提需求时的判断）通常已过时，
   * 用这条备注整条替换；打回与撤销重开则填原因，存独立字段回传给 agent。开始、进行中撤销直接落库。
   */
  function changeStatus(r, status) {
    const reject = r.status === 'review' && status === 'doing';
    // 撤销已完成的任务要问原因：否则 agent 重新认领时只看到上一轮「通过」，不知道任务为什么被重开
    const reopen = r.status === 'done' && status === 'todo';
    if (status === 'done' || status === 'rejected' || reject || reopen) {
      setModal({ type: 'status', requirement: r, status });
      return;
    }
    applyStatus(r, status).catch(() => {});
  }

  /** 状态弹窗提交：完成/拒绝写备注，打回与撤销重开写原因；成功关弹窗，失败把错误抛回表单展示 */
  async function confirmStatusNote(text) {
    const { requirement, status } = modal;
    if (status === 'todo' || (requirement.status === 'review' && status === 'doing')) {
      await applyStatus(requirement, status, undefined, text);
    } else {
      await applyStatus(requirement, status, text);
    }
    setModal(null);
  }

  /** 点需求行：在右面板显示详情（右面板收起时自动展开） */
  function openRequirement(r) {
    setSelReqId(r.id);
    openRight();
  }

  /** 删除需求（右面板「删除需求」按钮）：删完接着看下一条未完成 */
  async function deleteRequirement(r) {
    try {
      await api.deleteRequirement(r.id);
      const [list] = await Promise.all([loadReqs(pid, true), loadProjects()]);
      // 终态页签里不补位：补到列表看不见的未完成需求，与「右面板跟列表一致」相悖
      const pickNext = filter === 'unfinished';
      const next = pickNext ? (list || []).find((x) => UNFINISHED.includes(x.status)) : null;
      setSelReqId((cur) => (cur === r.id ? (next ? next.id : null) : cur));
      notify('需求已删除');
    } catch (e) {
      notify(e.message, 'warn');
    }
  }

  /**
   * 归档已完成的需求：记录搬到数据目录的 archive/<项目id>/，列表与计数随之消失。
   * 归档后选中项一定失效，直接清空——不补选，已完成条目本来就该从眼前退场。
   */
  async function archiveRequirement(r) {
    try {
      const res = await api.archiveRequirement(r.id);
      await Promise.all([loadReqs(pid, true), loadProjects()]);
      setSelReqId((cur) => (cur === r.id ? null : cur));
      // 带上落盘位置（archive/<项目目录>/<编号>-<id>.json），用户不用猜文件去哪了
      notify('#' + r.seq + ' 已归档到 ' + ((res && res.file) || 'archive/'));
    } catch (e) {
      notify(e.message, 'warn');
      throw e;
    }
  }

  /* 按 id 解析选中项：列表轮询刷新后仍取最新数据；外部删除后自然回空态 */
  const selReq = selReqId ? reqs.find((r) => r.id === selReqId) || null : null;

  /**
   * 解锁 / 撤销解锁。这两个动作只影响「下一轮 /next 要不要把这条进行中的任务还给认领人」，
   * 不改状态、不动认领，所以不需要二次确认弹窗；但一定要提示清楚它放行的是谁。
   */
  async function unlockRequirement(r) {
    try {
      await api.unlockRequirement(r.id);
      await Promise.all([loadReqs(pid, true), loadProjects()]);
      const who = (r.claim && (r.claim.agentName || r.claim.agent)) || 'agent';
      notify('#' + r.seq + ' 已解锁，' + who + ' 下一轮可以继续这条任务');
    } catch (e) {
      notify(e.message, 'warn');
      await Promise.all([loadReqs(pid, true), loadProjects()]);
    }
  }

  async function relockRequirement(r) {
    try {
      await api.relockRequirement(r.id);
      await Promise.all([loadReqs(pid, true), loadProjects()]);
      notify('#' + r.seq + ' 已收回解锁，项目重新锁住');
    } catch (e) {
      notify(e.message, 'warn');
      await Promise.all([loadReqs(pid, true), loadProjects()]);
    }
  }

  return {
    reqs,
    reqLoading,
    filter,
    setFilter,
    selReqId,
    setSelReqId,
    reqsPid,
    selReq,
    loadReqs,
    reloadRequirements,
    openNewRequirement,
    saveRequirement,
    saveRequirementDetail,
    answerRequirement,
    approveRequirement,
    replyRequirement,
    changeStatus,
    confirmStatusNote,
    openRequirement,
    deleteRequirement,
    archiveRequirement,
    unlockRequirement,
    relockRequirement
  };
}

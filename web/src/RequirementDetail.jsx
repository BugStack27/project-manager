import { useEffect, useState } from "react";
import { api } from "./api.js";
import AskCard from "./components/AskCard.jsx";
import EvidenceNote from "./components/EvidenceNote.jsx";
import { hoverProps } from "./components/HoverCardLayer.jsx";
import MarkdownText from "./components/MarkdownText.jsx";
import ProjectRefInput from "./components/ProjectRefInput.jsx";
import { STATUS } from "./constants.js";
import { fmtClock, fmtDateTime } from "./format.js";
import { usePendingChanges } from "./hooks/usePendingChanges.js";
import { IC } from "./icons.jsx";
import { actorName, eventSummary, eventTime, eventTypeLabel, groupByDay } from "./lib/events-view.js";
import { skillMissing, skillTip } from "./lib/skill-refs.js";
import { DangerButton, Modal, PanelClose } from "./ui.jsx";

/** 复制的纯内容：标题 + 正文 + 备注 + 打回 / 撤销原因；空段落整段跳过，不留多余空行 */
function buildContentText(r) {
  const parts = [String(r.title || "").trim()];
  const body = String(r.body || "").trim();
  if (body) parts.push(body);
  const note = String(r.note || "").trim();
  if (note) parts.push("备注：" + note);
  const feedback = String((r.feedback && r.feedback.note) || "").trim();
  if (feedback) {
    parts.push((r.feedback.kind === "reopen" ? "撤销原因：" : "打回原因：") + feedback);
  }
  return parts.join("\n\n");
}

/**
 * 复制给执行 agent 的认领 + 完成指令：不重复正文，认领接口会返回完整需求与项目路径。
 * 只对未开始 / 进行中生成（不能拿 UNFINISHED 当判据，它含 review）。
 * agentId 由用户在弹窗里选定后写入；不传时才退回「你的AgentID」占位。
 * 备注不写死示例：agent 照抄示例会把无关内容写进交付记录。
 * 交付指令给出 note / commitMessage 两个字段并说明分工，避免会话回复被当成提交信息。
 * 编码要求写在文案里：agent 用 GBK 手拼 URL 或 body 会让交付文本变成不可逆乱码。
 */
function buildAgentText(r, project, agentId) {
  if (!r.id || (r.status !== "todo" && r.status !== "doing")) return "";
  const seqLabel =
      r.seq === undefined || r.seq === null || r.seq === "" ? "" : ` / #${r.seq}`;
    
  const id = encodeURIComponent(r.id);
  const agent = String(agentId || "").trim() || "你的AgentID";

  const lines = [`任务：${String(r.title || "").trim()}（${r.id}${seqLabel}）`];
  if (project && project.name) {
    lines.push(`项目：${project.name}`);
  }
  // 引用项目写在指令里：agent 一拿到这条消息就知道要先理解别的项目，不必等认领后才发现
  const refs = (Array.isArray(r.refs) ? r.refs : []).filter((x) => x.projectId);
  if (refs.length) {
    lines.push(
      `引用项目：${refs
        .map((x) => x.name + (x.path ? `（${x.path}）` : ""))
        .join("、")} —— 认领后 requirement.refs 里有路径与该项目未完成的需求，先读懂它们再动手，且不要改它们`
    );
  }
  // 技能要求也写进指令：agent 一拿到就知道要去读哪份 SKILL.md，不必等认领后才发现缺技能
  const skills = (Array.isArray(r.skills) ? r.skills : []).filter((x) => x.skillId);
  if (skills.length) {
    lines.push(
      `使用技能：${skills
        .map((x) => x.name + (x.dir ? `（${x.dir}）` : ""))
        .join("、")} —— 认领后 requirement.skills 里有 entry（SKILL.md 的绝对路径），先读 entry 照它做；exists 为 false 表示目录已不在，用 /ask 问用户，不要 /release`
    );
  }
  lines.push(
    `1. 认领与获取任务详情：GET http://127.0.0.1:7318/claim?taskId=${id}&agent=${agent}`,
    `2. 完成后交付：POST http://127.0.0.1:7318/complete，body {"taskId":"${r.id}","agent":"${agent}","note":"给用户的回复","commitMessage":"标准 git 提交信息"}`,
    `3. 有必须由人拍板的问题：POST http://127.0.0.1:7318/ask，body {"taskId":"${r.id}","agent":"${agent}","text":"问题","options":["候选一","候选二"]}`,
    `4. 做不下去就释放：POST http://127.0.0.1:7318/release，body {"taskId":"${r.id}","agent":"${agent}","note":"原因"}`,
    "交付分两段：note 是给用户看的会话回复（进往返记录）；commitMessage 是独立的标准 git 提交信息，汇总本次全部改动，只用于一键提交，不进往返记录、打回后不保留。两段都按 UTF-8 JSON 写，不要把会话内容写进 commitMessage。",
    "---",
    "按上面流程执行：认领后从接口取完整需求再动手，做完交付；有必须由人拍板的问题就提问后结束本轮，做不下去就释放。除这四个动作接口、GET /skill/<技能id> 与 GET /skills 外，不允许调用其他 7318 接口。",
    `编码要求：GET 的参数先按 UTF-8 编码再做 percent-encode；POST 的 body 直接写 UTF-8 JSON（正文长时可写进临时文件用 --data-binary @文件发送）。不要用 GBK / 系统默认编码。`,
    agentId
      ? `上面指令里的 agent 已是你的固定 AgentID（${agent}），原样使用，不要自己起名字或改名。任务不可重复认领或重复交付。此项不写入计划文档。`
      : "把「你的AgentID」换成接入说明里写定的固定 ID；不要自己起名字或改名。任务不可重复认领或重复交付。此项不写入计划文档。",
  );
  return lines.join("\n");
}

/**
 * 复制给 Agent 前的选择弹窗：必须选一个已登记的 Agent，确认后把它的 AgentID 写进指令。
 * 不选中就不允许复制，避免 agent 自己起名导致任务认领后找不回。
 */
function AgentCopyModal({ requirement, project, onClose, notify }) {
  /** null = 列表加载中；[] = 还没有创建任何 Agent */
  const [list, setList] = useState(null);
  const [agentId, setAgentId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    api
      .agents()
      .then((res) => {
        if (!alive) return;
        const items = (res && res.agents) || [];
        setList(items);
        setAgentId(items.length === 1 ? items[0].id : "");
      })
      .catch((e) => {
        if (!alive) return;
        setList([]);
        setErr(e.message || "读取 Agent 列表失败");
      });
    return () => {
      alive = false;
    };
  }, []);

  const selected = (list || []).find((a) => a.id === agentId) || null;

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    if (!selected) {
      setErr("先选择一个 Agent");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      await navigator.clipboard.writeText(
        buildAgentText(requirement, project, selected.id)
      );
      notify("已复制给「" + selected.name + "」（AgentID：" + selected.id + "）");
      onClose();
    } catch (_) {
      setErr("复制失败，请手动选择文本复制");
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose}>
      <form onSubmit={submit}>
        <h2>复制给 Agent</h2>
        <p className="sub">
          #{requirement.seq}「{requirement.title}」· 指令会写入所选 Agent 的 AgentID
        </p>

        {err ? <p className="rd-err">{err}</p> : null}

        <div className="field">
          <label>复制给</label>
          {list === null ? (
            <div className="hintline">读取 Agent 列表…</div>
          ) : list.length ? (
            <>
              <select
                autoFocus
                value={agentId}
                disabled={busy}
                onChange={(e) => {
                  setAgentId(e.target.value);
                  setErr("");
                }}
                aria-label="选择 Agent"
              >
                <option value="">请选择 Agent</option>
                {list.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}（{a.id}）
                  </option>
                ))}
              </select>
              <div className="hintline">
                名称用于识别，真正写进指令的是工作台分配的 AgentID
              </div>
            </>
          ) : (
            <div className="hintline">
              还没有创建任何 Agent。先到「设置与数据 → 通知与集成 → AI 接入」创建，再回来复制。
            </div>
          )}
        </div>

        {selected ? (
          <div className="ai-selected">
            <span className="ai-selected-lbl">AgentID</span>
            <span className="ai-selected-id">{selected.id}</span>
          </div>
        ) : null}

        <div className="mfoot">
          <button type="button" className="btn sm" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button
            type="submit"
            className="btn sm primary"
            disabled={busy || !selected}
            title={selected ? "复制并写入 AgentID" : "先选择一个 Agent"}
          >
            {busy ? "复制中…" : "复制"}
          </button>
        </div>
      </form>
    </Modal>
  );
}


/** 往返记录的消息类型：文案 + 图标 + 配色；顺序按时间正序，最早的轮次在上 */
const THREAD_KIND = {
  delivery: { label: "交付", icon: IC.push, tone: "delivery" },
  rejection: { label: "打回", icon: IC.x, tone: "rejection" },
  reopen: { label: "撤销", icon: IC.back, tone: "rejection" },
  approval: { label: "通过", icon: IC.check, tone: "approval" },
  rejected: { label: "拒绝", icon: IC.x, tone: "rejected" },
  question: { label: "提问", icon: IC.chat, tone: "question" },
  answer: { label: "回答", icon: IC.chat, tone: "answer" },
  fallback: { label: "默认继续", icon: IC.auto, tone: "muted" },
  timeout: { label: "提问超时", icon: IC.alert, tone: "muted" },
  release: { label: "释放", icon: IC.alert, tone: "muted" },
};

/**
 * 旧需求没有 thread 时，用 completion / feedback 拼出同样形状的两条，
 * 免得升级后详情里一片空白 —— 这两个字段没有迁移，也不打算迁移。
 */
function legacyThread(r) {
  const out = [];
  if (r.completion) {
    out.push({
      id: "c",
      at: r.completion.at,
      role: "agent",
      kind: "delivery",
      agent: r.completion.agent,
      agentName: r.completion.agentName,
      text: r.completion.note || ""
    });
  }
  if (r.feedback) {
    out.push({
      id: "f",
      at: r.feedback.at,
      role: "user",
      kind: r.feedback.kind === "reopen" ? "reopen" : "rejection",
      agent: null,
      text: r.feedback.note || ""
    });
  }
  return out.sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

/**
 * 按轮次分组：一次交付开启新一轮，交付前的问答归该轮。
 * 入参按时间正序，返回的轮次也正序，渲染时直接按顺序铺开。
 */
function groupRounds(items) {
  const out = [];
  let rounds = 0;
  for (const m of items) {
    if (m.kind === "delivery") rounds += 1;
    const round = Math.max(rounds, 1);
    const last = out[out.length - 1];
    if (last && last.round === round) last.items.push(m);
    else out.push({ round, items: [m] });
  }
  return out;
}

/**
 * 右面板：单条需求详情（扁平直铺，无卡片）+ 面板内编辑 + 删除 + 底部复制（内容 / Agent 指令）。
 *
 * 调用方用 `key={requirement.id}` 挂载：切换需求即重建组件，
 * 编辑草稿随之清空，也避免列表 5s 轮询刷新对象引用时把正在输入的内容冲掉。
 */
export default function RequirementDetail({
  requirement,
  project,
  projects,
  onOpenProject,
  onOpenRequirement,
  onSave,
  onDelete,
  onArchive,
  onStatus,
  onAnswer,
  onApprove,
  onReply,
  onUnlock,
  onRelock,
  onOpenAudit,
  onViewChanges,
  onClose,
  notify,
}) {
  const [editing, setEditing] = useState(false);
  /** 编辑草稿：只在点「编辑」时从需求取值，编辑期间不跟随轮询刷新 */
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  /** 待审核回复草稿：通过 / 继续回复只作用于当前这次交付，轮询刷新不冲掉输入 */
  const [reply, setReply] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [reviewErr, setReviewErr] = useState("");
  /** 验收时工作区还有未提交改动：大概率就是这次交付的代码，给一个顺手提交推送的选项 */
  const pending = usePendingChanges(requirement.projectId, requirement.status === "review");
  const [commitPush, setCommitPush] = useState(true);
  /** 「复制给 Agent」前必须先选接收方：弹窗里选定后把 AgentID 写进指令 */
  const [agentCopyOpen, setAgentCopyOpen] = useState(false);
  /** 事件时间线：最近 6 条，需求 updatedAt 变化后重拉 */
  const [timeline, setTimeline] = useState([]);
  const [timelineLoading, setTimelineLoading] = useState(true);
  const [timelineError, setTimelineError] = useState("");

  useEffect(() => {
    let alive = true;
    // 有往返记录时不再拉时间线：对话已经覆盖交付 / 打回 / 问答，明细统一走审计日志
    if ((requirement.thread || []).length) {
      setTimeline([]);
      setTimelineError("");
      setTimelineLoading(false);
      return;
    }
    setTimelineLoading(true);
    setTimelineError("");
    api
      .requirementTimeline(requirement.id, null, 6)
      .then((res) => {
        if (alive) setTimeline(res.events || []);
      })
      .catch((e) => {
        if (alive) setTimelineError(e.message || "时间线加载失败");
      })
      .finally(() => {
        if (alive) setTimelineLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [requirement.id, requirement.updatedAt, (requirement.thread || []).length]);

  const st = STATUS[requirement.status];
  const body = String(requirement.body || "").trim();
  const note = String(requirement.note || "").trim();
  /** 跨项目引用：服务端按正文解析好的结果（重名、归档、找不到都已判定），界面只负责展示与跳转 */
  const refs = Array.isArray(requirement.refs) ? requirement.refs : [];
  /** 本项目需求引用 `@{#序号}`：服务端解析，exists:false 表示序号对不上（归档/删除/写错） */
  const reqRefs = Array.isArray(requirement.reqRefs) ? requirement.reqRefs : [];
  /** 本项目文件引用 `@{file:路径}`：服务端解析，只给绝对路径与是否存在，不预读内容 */
  const fileRefs = Array.isArray(requirement.fileRefs) ? requirement.fileRefs : [];
  /** 技能关联：同样由服务端按正文 `{UseSkill:x}` 解析，`exists:false` 表示目录已不在 */
  const skills = Array.isArray(requirement.skills) ? requirement.skills : [];
  const updated =
    requirement.updatedAt && requirement.updatedAt !== requirement.createdAt;

  function startEdit() {
    setErr(null);
    setDraft({
      title: requirement.title || "",
      body: requirement.body || "",
      note: requirement.note || "",
    });
    setEditing(true);
  }

  function cancelEdit() {
    setDraft(null);
    setEditing(false);
    setErr(null);
  }

  async function copyText(text, ok) {
    try {
      await navigator.clipboard.writeText(text);
      notify(ok);
    } catch (_) {
      notify("复制失败，请手动选择文本复制", "warn");
    }
  }

  /** 文件引用 chip 点击：用系统默认程序打开本项目内的文件，越界 / 密钥由主进程拒绝 */
  async function openRefFile(path) {
    try {
      await api.revealFile(requirement.projectId, path);
    } catch (e) {
      notify(e.message || "无法打开该文件", "warn");
    }
  }

  const claim = requirement.claim;
  /** 界面展示 Agent 名称，注册表里查不到（已删除 / 历史名字）才退回 AgentID */
  const claimName = claim ? claim.agentName || claim.agent : "";
  const agentText = buildAgentText(requirement, project);
  const timelineGroups = groupByDay(timeline);
  const question = requirement.question;
  /** 待回答的提问可以有多条（老数据只有 question 一个字段，这里兜底成单元素列表） */
  const questions = Array.isArray(requirement.questions)
    ? requirement.questions
    : question
      ? [question]
      : [];
  const completion = requirement.completion;
  const rawThread = requirement.thread || [];
  // 待回答的那几条提问由回复框完整呈现，列表里不再重复一遍：优先按 qid 对上，老消息退回时间戳
  const pendingQids = new Set(questions.map((q) => q.id).filter(Boolean));
  const pendingAts = new Set(questions.map((q) => q.at).filter(Boolean));
  const isPendingQuestion = (m) =>
    m.kind === "question" && (m.qid ? pendingQids.has(m.qid) : pendingAts.has(m.at));
  // 待审核的这次交付由验收区块完整呈现，往返记录里不再重复
  const pendingReviewAt = requirement.status === "review" && completion ? completion.at : null;
  // 旧需求的 completion / feedback 只在 thread 里没有同一条时才补进来：
  // 升级后第一次再交付会让 thread 变得非空，但旧的打回原因不该因此从面板上消失
  const seen = new Set(rawThread.map((m) => m.kind + "@" + m.at));
  const thread = rawThread
    .concat(legacyThread(requirement).filter((m) => !seen.has(m.kind + "@" + m.at)))
    .sort((a, b) => String(a.at).localeCompare(String(b.at)))
    .filter(
      (m) =>
        !isPendingQuestion(m) &&
        !(pendingReviewAt && m.kind === "delivery" && m.at === pendingReviewAt)
    );
  // 轮次与轮内都正序：从上往下按时间读，最新的在最后
  const threadRounds = groupRounds(thread);
  const legacy = !timelineLoading && !timelineError && timeline.length === 0;
  const creatorName = requirement.source === "ai" ? "AI 巡检" : "我";
  // 往返记录已覆盖交付 / 打回 / 问答，完整事件明细统一从审计日志看
  const openAudit = onOpenAudit
    ? () =>
        onOpenAudit({
          projectId: requirement.projectId,
          requirementId: requirement.id,
          requirementLabel: `#${requirement.seq} ${requirement.title}`,
        })
    : null;

  /** 验收通过：结束 agent 这一轮的等待，任务进入已完成 */
  async function approve() {
    if (reviewing || !onApprove) return;
    setReviewing(true);
    setReviewErr("");
    try {
      await onApprove(pending > 0 && commitPush);
    } catch (e) {
      setReviewErr(e.message || "提交失败");
    } finally {
      setReviewing(false);
    }
  }

  /** 继续回复：把意见带回 agent，需求回到进行中，它接着改完再交付 */
  async function submitReply() {
    if (reviewing || !onReply) return;
    const text = reply.trim();
    if (!text) {
      setReviewErr("先写清楚要继续改什么");
      return;
    }
    setReviewing(true);
    setReviewErr("");
    try {
      await onReply(text);
      setReply("");
    } catch (e) {
      setReviewErr(e.message || "提交失败");
    } finally {
      setReviewing(false);
    }
  }

  async function save() {
    if (busy || !draft) return;
    const title = draft.title.trim();
    if (!title) {
      setErr("标题不能为空");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await onSave({ title, body: draft.body, note: draft.note });
      setDraft(null);
      setEditing(false);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function del() {
    setBusy(true);
    setErr(null);
    try {
      await onDelete();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  /** 归档：记录搬到数据目录的 archive/<项目id>/，之后列表里不再出现 */
  async function archive() {
    setBusy(true);
    setErr(null);
    try {
      await onArchive();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rd">
      <div className="rd-hd">
        <span className={"pill " + st.cls}>{st.label}</span>
        <span className={"src" + (requirement.source === "ai" ? " ai" : "")}>
          {requirement.source === "ai" ? "AI" : "手动"}
        </span>
        <span className="meta mono">#{requirement.seq}</span>
        {claim ? (
          <span
            className="src claim"
            title={
              "由 " + claimName + " 于 " + fmtDateTime(claim.at) + " 认领"
            }
          >
            {claimName}
          </span>
        ) : null}
        <div className="rd-tools">
          {editing ? (
            <>
              <button
                className="btn sm ghost"
                onClick={cancelEdit}
                disabled={busy}
                title="放弃改动"
              >
                取消
              </button>
              <button
                className="btn sm primary"
                onClick={save}
                disabled={busy}
                title="保存改动"
              >
                {busy ? "保存中…" : "保存"}
              </button>
            </>
          ) : (
            <>
              {requirement.status === "done" && onArchive ? (
                <DangerButton
                  label="归档"
                  confirmLabel="确认归档"
                  disabled={busy}
                  onConfirm={archive}
                />
              ) : null}
              {/* 终态的撤销从看板卡片挪到这里：卡片不再为两个按钮多占一行，
                  done 走状态弹窗填原因（agent 重开时要知道为什么被撤） */}
              {(requirement.status === "done" || requirement.status === "rejected") &&
              onStatus ? (
                <button
                  className="btn sm ghost"
                  onClick={() => onStatus(requirement, "todo")}
                  disabled={busy}
                  title="撤销这条需求，回到未开始重新排队"
                >
                  撤销
                </button>
              ) : null}
              <DangerButton
                icon={IC.trash}
                label={busy ? "删除中…" : "删除需求"}
                confirmLabel="确认删除"
                disabled={busy}
                onConfirm={del}
              />
              <button
                className="btn sm icon ghost"
                onClick={startEdit}
                title="编辑需求"
                aria-label="编辑需求"
              >
                {IC.pencil}
              </button>
            </>
          )}
          {/* 抽屉没有标题栏，关闭入口挂在这一行的末尾 */}
          {onClose ? <PanelClose onClick={onClose} /> : null}
        </div>
      </div>

      {editing && draft ? (
        <>
          <div className="rd-edit">
            <div className="field">
              <label>标题</label>
              <input
                autoFocus
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder="一句话说明要做什么"
              />
            </div>
            <div className="field">
              <label>正文</label>
              <ProjectRefInput
                value={draft.body}
                onChange={(next) => setDraft({ ...draft, body: next })}
                projects={projects}
                currentProjectId={requirement.projectId}
                currentSeq={requirement.seq}
                rows={6}
                placeholder="背景、期望效果、约束条件… 输入 @ 引用项目/需求/文件，/ 指定要用的技能"
              />
            </div>
            <div className="field">
              <label>备注（可选）</label>
              {/* AI 巡检的证据坐标一条就能写到 200+ 字符，人工复核说明也常是多句：
                  单行 input 只能横向滚，改成多行。证据解析按「· 证据：」截取，换行不影响 */}
              <textarea
                className="rd-note-input"
                rows={3}
                value={draft.note}
                onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                placeholder="例如：夜间巡检提出 / 已与某分支冲突"
              />
            </div>
          </div>
          {err ? <p className="rd-err">{err}</p> : null}
        </>
      ) : (
        <>
          <h2 className="rd-title">{requirement.title}</h2>
          <div className="rd-meta">
            <span className="meta">
              创建 <b>{fmtDateTime(requirement.createdAt)}</b>
            </span>
            {updated ? (
              <span className="meta">
                更新 <b>{fmtDateTime(requirement.updatedAt)}</b>
              </span>
            ) : null}
          </div>

          {/* 候选需求的可见性要说清：它不在未完成里、也派不出去，避免用户以为 agent 视而不见 */}
          {requirement.status === "candidate" ? (
            <p className="rd-cand">
              候选需求：不计入未完成，也不会派给 agent。想做了在列表里点「采纳」，采纳后进入未开始。
            </p>
          ) : null}

          <div className="rd-sec">正文</div>
          {body ? (
            <MarkdownText
              className="rd-body"
              refs={refs}
              reqRefs={reqRefs}
              fileRefs={fileRefs}
              skills={skills}
              projectId={requirement.projectId}
              onOpenProject={onOpenProject}
              onOpenRequirement={onOpenRequirement}
              onOpenFile={openRefFile}
            >
              {body}
            </MarkdownText>
          ) : (
            <div className="rd-empty">（无正文）</div>
          )}

          {refs.length ? (
            <div className="rd-refs">
              <span className="rd-refs-lead">引用项目</span>
              {/* 这一行的信息就是 agent 认领时能拿到的：路径、还有几条未完成 ——
                  用户据此判断引用指得对不对，不必先复制给 agent 试一次。
                  悬停出与侧栏同一张项目信息卡（路径 / 计数都在卡上），原来那份 title 已撤掉：
                  两套提示一起弹很影响观感。归档另有行内角标，重名则看卡上的路径认是哪个项目。 */}
              {refs.map((ref) => (
                <button
                  key={ref.name}
                  type="button"
                  className={"rd-ref" + (ref.projectId ? "" : " miss")}
                  aria-disabled={!ref.projectId}
                  {...hoverProps.project(ref.projectId)}
                  onClick={() => {
                    if (ref.projectId && onOpenProject) onOpenProject(ref.projectId);
                  }}
                  title={
                    ref.projectId
                      ? undefined
                      : "没有找到这个项目：检查名字是否写错，或重新输入 @ 选一个"
                  }
                >
                  <span className="rd-ref-name">@{ref.name}</span>
                  {ref.archived ? <i className="rd-ref-tag">已归档</i> : null}
                  {ref.pendingCount ? (
                    <i className="rd-ref-tag">{ref.pendingCount} 条未完成</i>
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}

          {reqRefs.length ? (
            <div className="rd-refs">
              <span className="rd-refs-lead">引用需求</span>
              {/* 只引用本项目的需求：点一下跳到那条需求详情；序号对不上（归档/删除/写错）标失效。
                  与引用项目同一套悬停信息窗（标题 / 状态 / 正文摘要），能出卡就不挂原生 title。 */}
              {reqRefs.map((rq) => (
                <button
                  key={rq.name}
                  type="button"
                  className={"rd-ref rd-req" + (rq.exists ? "" : " miss")}
                  aria-disabled={!rq.exists}
                  {...hoverProps.requirement(rq)}
                  onClick={() => {
                    if (rq.exists && onOpenRequirement) onOpenRequirement(rq.requirementId);
                  }}
                  title={
                    rq.exists
                      ? undefined
                      : "没有找到本项目需求 #" + rq.seq + "：检查序号是否写错，或该需求已归档/删除"
                  }
                >
                  <span className="rd-ref-name">
                    #{rq.seq}
                    {rq.exists && rq.title ? " · " + rq.title : ""}
                  </span>
                  {rq.exists && rq.status ? (
                    <i className="rd-ref-tag">{(STATUS[rq.status] && STATUS[rq.status].label) || rq.status}</i>
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}

          {fileRefs.length ? (
            <div className="rd-refs">
              <span className="rd-refs-lead">引用文件</span>
              {/* 只引用本项目的文件：点一下用系统默认程序打开；悬停就地读内容（行号 + 语法高亮）。
                  不存在/越界/密钥/目录标失效，这些退回原生 title 说明原因，不出内容窗。 */}
              {fileRefs.map((fr) => {
                const fHover = hoverProps.file(fr, requirement.projectId);
                return (
                  <button
                    key={fr.name}
                    type="button"
                    className={"rd-ref rd-file" + (fr.exists && !fr.restricted ? "" : " miss")}
                    aria-disabled={!fr.exists || fr.restricted}
                    {...fHover}
                    onClick={() => {
                      if (fr.exists && !fr.restricted) openRefFile(fr.path);
                    }}
                    title={
                      fHover
                        ? undefined
                        : fr.restricted
                          ? "该文件不提供打开（密钥/凭据/依赖目录）：" + fr.path
                          : fr.exists
                            ? (fr.directory ? "目录：" : "打开文件：") + (fr.absPath || fr.path)
                            : "文件不存在（可能已改名或删除）：" + fr.path
                    }
                  >
                    <span className="rd-ref-name">{fr.path}</span>
                    {fr.restricted ? (
                      <i className="rd-ref-tag">密钥</i>
                    ) : fr.exists ? (
                      fr.directory ? <i className="rd-ref-tag">目录</i> : null
                    ) : (
                      <i className="rd-ref-tag">不存在</i>
                    )}
                  </button>
                );
              })}
            </div>
          ) : null}

          {skills.length ? (
            <div className="rd-refs">
              <span className="rd-refs-lead">使用技能</span>
              {/* 与项目引用同一套来源（服务端解析）：这里只展示，不提供跳转，
                  所以用 span 而不是 button —— 长得像按钮却点不动比不做成按钮更糟。
                  技能是目录，不按 Agent 归属过滤：目录记在谁名下都能读。
                  能出信息窗就不再挂 title（两套一起弹很碍眼），失效态才用原生提示说明原因。 */}
              {skills.map((sk) => (
                <span
                  key={sk.name}
                  className={"rd-ref rd-skill" + (skillMissing(sk) ? " miss" : "")}
                  {...hoverProps.skill(sk)}
                  title={skillMissing(sk) ? skillTip(sk) : undefined}
                >
                  <span className="rd-ref-name">{"{UseSkill:" + sk.name + "}"}</span>
                  {sk.skillId && !sk.exists ? (
                    <i className="rd-ref-tag">目录已不在</i>
                  ) : null}
                  {sk.ambiguous ? <i className="rd-ref-tag">同名多个</i> : null}
                </span>
              ))}
            </div>
          ) : null}

          {note ? (
            <>
              <div className="rd-sec">备注</div>
              {/* 能解析出证据坐标就变成可悬停查看的 chip；人工复核备注原样输出 */}
              <EvidenceNote note={note} projectId={requirement.projectId} />
            </>
          ) : null}

          {questions.length && requirement.status === "doing" ? (
            <div className="rd-asks">
              {/* 多条提问并排挂在这里：每条各自持有草稿与提交态，答完一条不影响另一条 */}
              {questions.map((q, i) => (
                <AskCard
                  key={q.id || q.at || i}
                  question={q}
                  index={i}
                  total={questions.length}
                  skills={skills}
                  onAnswer={(text, qid) => (onAnswer ? onAnswer(text, qid) : Promise.resolve())}
                />
              ))}
            </div>
          ) : null}

          {requirement.status === "review" && completion ? (
            <div className="rd-ask rd-review">
              <div className="rd-ask-hd">
                <span className="rd-ask-ico">{IC.check}</span>
                <b>{completion.agentName || completion.agent || "Agent"}</b>
                <span className="rd-ask-wait">已交付，等你验收</span>
                <span className="meta">{fmtDateTime(completion.at)}</span>
              </div>
              <MarkdownText
                className="rd-ask-q"
                skills={Array.isArray(completion.skills) ? completion.skills : skills}
              >
                {completion.note || "（agent 未填写给用户的回复）"}
              </MarkdownText>
              <div className="field">
                {/* 打回意见也要能点名技能：与正文编辑器共用同一套 @ / 候选，
                    写成 {UseSkill:id} 后由服务端并入 requirement.skills（见 views.skillText） */}
                <ProjectRefInput
                  value={reply}
                  onChange={setReply}
                  projects={projects}
                  currentProjectId={requirement.projectId}
                  currentSeq={requirement.seq}
                  rows={3}
                  disabled={reviewing}
                  placeholder="写清楚还要改什么；输入 / 指定这次要用的技能"
                />
              </div>
              {reviewErr ? <p className="rd-err">{reviewErr}</p> : null}
              {pending > 0 ? (
                <div className="field">
                  <div className="checkrow">
                    <label className="checkline">
                      <input
                        type="checkbox"
                        checked={commitPush}
                        disabled={reviewing}
                        onChange={(e) => setCommitPush(e.target.checked)}
                      />
                      <span>提交并推送当前 {pending} 个文件的改动</span>
                    </label>
                    <button
                      type="button"
                      className="linklike"
                      onClick={() => onViewChanges && onViewChanges()}
                      disabled={reviewing}
                    >
                      查看改动
                    </button>
                  </div>
                </div>
              ) : null}
              <div className="rd-ask-foot">
                <button
                  className="btn sm ok"
                  onClick={approve}
                  disabled={reviewing}
                  title="验收通过，任务完成"
                >
                  {IC.check}通过
                </button>
                {/* disabled 的按钮收不到 hover，原因必须挂在能悬停的外层 */}
                <span
                  className="rd-ask-tip"
                  title={!reply.trim() ? "先写清楚要继续改什么" : "回复后 agent 继续开发"}
                >
                  <button
                    className="btn sm primary"
                    onClick={submitReply}
                    disabled={reviewing || !reply.trim()}
                  >
                    {reviewing ? "提交中…" : "继续回复"}
                  </button>
                </span>
              </div>
            </div>
          ) : null}

          {threadRounds.length ? (
            <>
              <div className="rd-sec">往返记录</div>
              <div className="rd-thread">
                {threadRounds.map((g) => (
                  <div className="rd-round" key={g.round}>
                    <div className="rd-round-hd">第 {g.round} 轮</div>
                    {g.items.map((m) => {
                      const k = THREAD_KIND[m.kind] || { label: m.kind, tone: "muted" };
                      return (
                        <div
                          className={"rd-msg " + (m.role === "user" ? "me" : "agent")}
                          key={m.id}
                        >
                          <div className={"rd-bubble tone-" + k.tone}>
                            <div className="rd-msg-hd">
                              <span className="rd-msg-ico">{k.icon}</span>
                              <span className="rd-msg-who">
                                {m.role === "user" ? "我" : m.agentName || m.agent || "Agent"}
                              </span>
                              <span className="rd-msg-kind">{k.label}</span>
                              <span className="meta">{fmtDateTime(m.at)}</span>
                            </div>
                            <MarkdownText
                              className="rd-msg-text"
                              skills={Array.isArray(m.skills) ? m.skills : skills}
                            >
                              {m.text || "（没有填写内容）"}
                            </MarkdownText>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
              {openAudit ? (
                <div className="rd-events">
                  <span>事件记录</span>
                  <button
                    className="btn sm ghost"
                    onClick={openAudit}
                    title="在审计日志中查看该需求的全部事件"
                  >
                    查看全部
                  </button>
                </div>
              ) : null}
            </>
          ) : null}

          {threadRounds.length ? null : (
            <>
              <div className="rd-sec">时间线</div>
              {timelineLoading ? (
                <div className="rd-tl-loading">
                  <span className="spinner" />
                  加载中…
                </div>
              ) : timelineError ? (
                <p className="rd-err">时间线加载失败：{timelineError}</p>
              ) : timeline.length ? (
                <>
                  <div className="rd-tl">
                    {timelineGroups.map((g) => (
                      <div className="rd-tl-day" key={g.key}>
                        <div className="rd-tl-dayhd">{g.label}</div>
                        {g.items.map((ev) => (
                          <div className="rd-tl-item" key={ev.id}>
                            <span className="rd-tl-dot" />
                            <span className="rd-tl-body">
                              <span className="rd-tl-line">
                                <b>{eventTypeLabel(ev.type)}</b>
                                <span className="rd-tl-actor">{actorName(ev.actor)}</span>
                                <span className="rd-tl-time">{eventTime(ev)}</span>
                              </span>
                              <span className="rd-tl-sum">{eventSummary(ev)}</span>
                            </span>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                  {openAudit ? (
                    <button
                      className="btn sm ghost rd-tl-more"
                      onClick={openAudit}
                      title="在审计日志中查看该需求的全部事件"
                    >
                      查看全部
                    </button>
                  ) : null}
                </>
              ) : legacy ? (
                <>
                  <div className="rd-tl-item">
                    <span className="rd-tl-dot" />
                    <span className="rd-tl-body">
                      <span className="rd-tl-line">
                        <b>创建</b>
                        <span className="rd-tl-actor">{creatorName}</span>
                        <span className="rd-tl-time">{fmtClock(requirement.createdAt)}</span>
                      </span>
                      <span className="rd-tl-sum">
                        需求创建于 {fmtDateTime(requirement.createdAt)}
                      </span>
                    </span>
                  </div>
                  <div className="rd-tl-hint">历史事件从本版本开始记录</div>
                </>
              ) : null}
            </>
          )}

          <div className="rd-foot">
            {err ? <p className="rd-err">{err}</p> : null}
            <div className="rd-actions">
              <button
                className="btn sm"
                onClick={() =>
                  copyText(buildContentText(requirement), "已复制需求内容")
                }
                title="复制需求内容（标题 + 正文 + 备注 + 打回 / 撤销原因）"
              >
                {IC.copy}
                <span>复制内容</span>
              </button>
              {/* 解锁只在进行中且已被认领时有意义：这时项目被这条任务锁住，谁都派不进来 */}
              {requirement.status === "doing" && claim ? (
                requirement.unlock ? (
                  <>
                    <span
                      className="rd-lock-state"
                      title={
                        "已于 " +
                        fmtDateTime(requirement.unlock.at) +
                        " 解锁：下一轮 /next 会把这条任务还给 " +
                        claimName +
                        "，拿到后项目重新锁住（一次授权只放行一轮）"
                      }
                    >
                      已解锁 · 等 {claimName} 领取
                    </span>
                    <button
                      className="btn sm ghost"
                      onClick={() => onRelock && onRelock()}
                      title="收回解锁：项目重新锁住，agent 下一轮领不到它（通行证还没被取走才有效）"
                    >
                      <span>收回</span>
                    </button>
                  </>
                ) : (
                  <button
                    className="btn sm"
                    onClick={() => onUnlock && onUnlock()}
                    title={
                      "项目因这条进行中的任务被锁住：任何 agent（含 " +
                      claimName +
                      "）都认领不到它。" +
                      "解开后只放行 " +
                      claimName +
                      " 一轮，被取走即重新锁住"
                    }
                  >
                    {IC.lock}
                    <span>解锁项目</span>
                  </button>
                )
              ) : null}
              {agentText ? (
                <button
                  className={"btn sm" + (claim ? " claimed" : "")}
                  disabled={!!claim}
                  onClick={() => setAgentCopyOpen(true)}
                  title={
                    claim
                      ? "已由 " +
                        claimName +
                        " 于 " +
                        fmtDateTime(claim.at) +
                        " 认领"
                      : "先选择复制给哪个 Agent，确认后把它的 AgentID 写进认领指令"
                  }
                >
                  {IC.plug}
                  <span>
                    {claim ? `已被 ${claimName} 认领` : "复制给 Agent"}
                  </span>
                </button>
              ) : null}
            </div>
          </div>
        </>
      )}

      {agentCopyOpen ? (
        <AgentCopyModal
          requirement={requirement}
          project={project}
          onClose={() => setAgentCopyOpen(false)}
          notify={notify}
        />
      ) : null}
    </div>
  );
}

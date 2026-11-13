import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api.js";
import { IC } from "../icons.jsx";
import { mcpFailDesc } from "../lib/mcp-view.js";
import {
    invalidateAgentList,
    invalidateSkills,
    sameOrUnder,
    skillsUnder,
} from "../lib/skill-refs.js";
import { DangerButton, Modal } from "../ui.jsx";

const TABS = [
  { id: "agents", label: "Agent 管理" },
  { id: "scout", label: "自动提需求" },
  { id: "worker", label: "自动认领" },
  { id: "mcp", label: "MCP" },
];

/**
 * AI 接入弹窗：四个页签 —— Agent 管理 / 自动提需求 / 自动认领 / MCP。
 *
 * Agent 管理页负责登记执行 agent：输入名称或选一个内置常见客户端即创建，工作台自动分配 AgentID；
 * 后续所有页签共用选中的 Agent，复制执行接入说明时把固定 ID 写进提示词。
 * 自动提需求 / 自动认领是「怎么用」的说明页 + 一个复制按钮：复制出去的接入说明本身不含业务规则，
 * 只让 AI 每次运行去 GET /prompt/<id>.txt 取当前手册，所以改手册后不用在 AI 端重配。
 * 最后一个页签是原来的 MCP 服务：状态、客户端配置、重试。
 *
 * 入口唯一：左栏底部「设置与数据」→「通知与集成」→「AI 接入」。
 */
export default function AiAccessModal({
  info,
  prompt,
  workerPrompt,
  agents,
  busy,
  onRetry,
  onClose,
  notify,
}) {
  const [tab, setTab] = useState("agents");

  /**
   * Agent 注册表：必须先创建并选中一个 Agent，才能复制执行接入说明。
   * 名称是给用户看的，复制时写进提示词的是自动分配的 AgentID。
   */
  const [agentList, setAgentList] = useState(
    Array.isArray(agents) ? agents : [],
  );
  const [agentId, setAgentId] = useState(
    Array.isArray(agents) && agents.length === 1 ? agents[0].id : "",
  );
  useEffect(() => {
    const list = Array.isArray(agents) ? agents : [];
    setAgentList(list);
    setAgentId((cur) =>
      cur && list.some((a) => a.id === cur)
        ? cur
        : list.length === 1
          ? list[0].id
          : "",
    );
  }, [agents]);

  const selectedAgent = agentList.find((a) => a.id === agentId) || null;

  /** 添加 Agent 的弹窗：快速选择本机已装客户端，或自定义名称 + 目录 */
  const [addOpen, setAddOpen] = useState(false);
  const [addBusy, setAddBusy] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDirs, setNewDirs] = useState([]);
  const [agentErr, setAgentErr] = useState("");
  /** 检测到的本机客户端（候选，不自动建 Agent、不扫技能） */
  const [clients, setClients] = useState([]);
  /** 正在编辑技能目录的 Agent 与草稿 */
  const [editId, setEditId] = useState("");
  const [editDirs, setEditDirs] = useState([]);

  /**
   * 技能清单：**只扫已添加 Agent 自己配的目录**，所以没添加 Agent 时它就是空的。
   * 它不参与派发 —— 需求里的 {UseSkill:id} 全局解析，谁认领谁拿到路径。
   */
  const [skillInfo, setSkillInfo] = useState(null);
  const [skillBusy, setSkillBusy] = useState(false);

  async function refreshSkills() {
    try {
      const data = await api.skills();
      setSkillInfo(data || null);
      // 输入框那份缓存也要失效，否则补全还停在旧清单上
      invalidateSkills();
    } catch (_) {}
  }

  async function refreshClients() {
    try {
      const d = await api.clients();
      setClients((d && d.clients) || []);
    } catch (_) {}
  }

  useEffect(() => {
    refreshSkills();
    refreshClients();
  }, []);

  const skillList =
    skillInfo && Array.isArray(skillInfo.skills) ? skillInfo.skills : [];

  async function rescanSkills() {
    if (skillBusy) return;
    setSkillBusy(true);
    try {
      const data = await api.rescanSkills();
      setSkillInfo(data || null);
      invalidateSkills();
      notify(
        "已重新扫描：" +
          ((data && data.skills && data.skills.length) || 0) +
          " 项技能",
      );
    } catch (e) {
      notify("扫描失败：" + e.message, "warn");
    }
    setSkillBusy(false);
  }

  /** 注册表变了就重取：卡片上的技能数来自清单，清单又随目录变 */
  async function refreshAgents() {
    try {
      const res = await api.agents();
      const list = (res && res.agents) || [];
      setAgentList(list);
      // 技能悬浮窗显示的「所属 Agent」名字也来自这份注册表，缓存跟着作废
      invalidateAgentList();
      setAgentId((cur) =>
        cur && list.some((a) => a.id === cur)
          ? cur
          : list.length === 1
            ? list[0].id
            : "",
      );
    } catch (_) {}
    await refreshSkills();
    // 「本机已装」里的「已登记」标记也依赖注册表，一起刷新，否则刚加的 Agent 还显示「添加」
    await refreshClients();
  }

  function openAdd() {
    setAddOpen(true);
    setAgentErr("");
    setNewName("");
    setNewDirs([]);
  }

  async function submitAgent(name, client, dirs) {
    if (addBusy) return;
    const nm = String(name || "").trim();
    if (!nm) {
      setAgentErr("先输入 Agent 名称");
      return;
    }
    setAddBusy(true);
    setAgentErr("");
    try {
      const res = await api.createAgent(nm, client, dirs);
      setAddOpen(false);
      await refreshAgents();
      notify(
        "已添加 Agent「" + res.agent.name + "」，AgentID：" + res.agent.id,
      );
    } catch (e) {
      setAgentErr(e.message || "添加 Agent 失败");
    } finally {
      setAddBusy(false);
    }
  }

  /** 快速选择：名字取客户端名，目录取它的默认技能目录，一步登记完 */
  function quickAdd(c) {
    submitAgent(c.label, c.client, c.dir ? [c.dir] : []);
  }

  /** 某个目录已经挂在哪些 Agent 名下：本地判断，登记完立刻生效，不必等一次往返 */
  function agentsUsingDir(dir) {
    return agentList.filter((a) =>
      (a.skillDirs || []).some((d) => sameOrUnder(dir, d.path)),
    );
  }

  function chooseFolder(done) {
    api
      .pickFolder("")
      .then((res) => {
        if (res && !res.canceled && res.path) done(res.path);
      })
      .catch(() => {});
  }

  async function deleteAgentProfile(agent) {
    try {
      await api.deleteAgent(agent.id);
      setAgentId((cur) => (cur === agent.id ? "" : cur));
      await refreshAgents();
      notify("已删除 Agent「" + agent.name + "」");
    } catch (e) {
      setAgentErr(e.message || "删除 Agent 失败");
    }
  }

  function startEdit(agent) {
    setEditId(agent.id);
    setEditDirs((agent.skillDirs || []).map((d) => d.path));
    setAgentErr("");
  }

  async function saveDirs(agent) {
    try {
      await api.setAgentSkillDirs(agent.id, editDirs.filter(Boolean));
      setEditId("");
      await refreshAgents();
      notify("已更新「" + agent.name + "」的技能目录");
    } catch (e) {
      setAgentErr(e.message || "保存目录失败");
    }
  }

  function copyWorkerPrompt() {
    if (!selectedAgent) {
      notify("先创建并选中一个 Agent，才能复制接入说明", "warn");
      return;
    }
    const stub = workerPrompt && workerPrompt.stub;
    if (!stub) {
      notify("执行接入说明尚未就绪，请重启应用后重试", "warn");
      return;
    }
    const text = stub.replace(/\{\{\s*agent\s*\}\}/g, selectedAgent.id);
    copyTo(
      text,
      "已复制执行接入说明（AgentID：" + selectedAgent.id + "）",
      "执行接入说明为空",
    );
  }

  const running = !!(info && info.url);
  const known = !!info;
  const err = (info && info.error) || null;
  const stateText = running ? "运行中" : known ? "未运行" : "状态未知";
  const statePort = !running && err && err.port ? "端口 " + err.port : "";
  const cfg = JSON.stringify(
    {
      mcpServers: {
        "project-manager": {
          url: (info && info.url) || "http://127.0.0.1:7318/mcp",
        },
      },
    },
    null,
    2,
  );

  async function copyTo(text, okMsg, emptyMsg) {
    if (!text) {
      notify(emptyMsg, "warn");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      notify(okMsg);
    } catch (_) {
      notify("复制失败，请手动选择文本复制", "warn");
    }
  }

  return (
    <Modal onClose={onClose} wide>
      <h2>AI 接入</h2>
      <div className="seg ai-seg">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={tab === t.id ? "active" : ""}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "agents" ? (
        <>
          <div className="ai-agent-hd">
            <b>已添加</b>
            <span>
              {agentList.length
                ? agentList.length + " 个 · 共 " + skillList.length + " 项技能"
                : "还没有 Agent"}
            </span>
          </div>

          <div className="ai-agent-new">
            <button className="btn primary" onClick={openAdd}>
              添加 Agent
            </button>
            <button
              className="btn"
              onClick={rescanSkills}
              disabled={skillBusy || !agentList.length}
              title={
                agentList.length
                  ? "重新扫描已添加 Agent 的技能目录"
                  : "先添加 Agent 才会扫描技能"
              }
            >
              {skillBusy ? "扫描中…" : "重新扫描"}
            </button>
          </div>

          {agentList.length ? (
            <div className="ai-agent-list">
              {agentList.map((a) => {
                const dirs = a.skillDirs || [];
                const total = skillList.filter((s) =>
                  (s.agents || []).includes(a.id),
                ).length;
                return (
                  <div className="ai-card" key={a.id}>
                    <div className="ai-card-hd">
                      <span className="ai-card-name">{a.name}</span>
                      <span className="ai-card-id">{a.id}</span>
                      <span className="ai-card-act">
                        <button className="btn sm" onClick={() => startEdit(a)}>
                          配置目录
                        </button>
                        <DangerButton
                          label="删除"
                          confirmLabel="确认删除"
                          onConfirm={() => deleteAgentProfile(a)}
                        />
                      </span>
                    </div>

                    {editId === a.id ? (
                      <>
                        {(editDirs.length ? editDirs : [""]).map((d, i) => (
                          <div className="ai-dir-edit" key={i}>
                            <input
                              value={d}
                              onChange={(e) =>
                                setEditDirs((cur) =>
                                  cur.map((x, j) =>
                                    j === i ? e.target.value : x,
                                  ),
                                )
                              }
                              placeholder="技能目录，例如 ~/.claude/skills"
                            />
                            <button
                              className="btn sm"
                              onClick={() =>
                                chooseFolder((p) =>
                                  setEditDirs((cur) =>
                                    cur.map((x, j) => (j === i ? p : x)),
                                  ),
                                )
                              }
                            >
                              选择
                            </button>
                            <button
                              className="btn sm"
                              onClick={() =>
                                setEditDirs((cur) =>
                                  cur.filter((_, j) => j !== i),
                                )
                              }
                            >
                              删除
                            </button>
                          </div>
                        ))}
                        <div className="ai-agent-new">
                          <button
                            className="btn sm"
                            onClick={() => setEditDirs((cur) => cur.concat(""))}
                          >
                            添加目录
                          </button>
                          <button
                            className="btn sm primary"
                            onClick={() => saveDirs(a)}
                          >
                            保存
                          </button>
                          <button
                            className="btn sm"
                            onClick={() => setEditId("")}
                          >
                            取消
                          </button>
                        </div>
                      </>
                    ) : dirs.length ? (
                      <div className="ai-card-dirs">
                        {dirs.map((d) => {
                          const n = skillsUnder(skillList, d.path).length;
                          return (
                            <div
                              className={"ai-dir" + (d.exists ? "" : " miss")}
                              key={d.path}
                            >
                              <span className="ai-dir-path" title={d.path}>
                                {d.path}
                              </span>
                              <span className="ai-dir-n">
                                {d.exists ? n + " 个技能" : "目录不存在"}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="ai-agent-note">
                        没有配技能目录：这个 Agent 不参与技能扫描。
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="ai-agent-empty">
              还没有 Agent。点「添加 Agent」——
              本机已装的客户端会直接列出来，点一下就能添加。
            </p>
          )}

          {agentErr ? <p className="ai-agent-err">{agentErr}</p> : null}
        </>
      ) : null}

      {tab === "scout" ? (
        <>
          <p className="ai-lead">
            让 AI 定时读一遍项目——看代码、git
            记录和历史需求，把值得做的改进写成需求提交进来。
            <b>它只提需求，不改代码。</b>
          </p>
          <ol className="ai-steps">
            <li>
              <b>复制接入说明</b>点下面的按钮。这段只是指针：每次都让 AI
              来取最新巡检手册。
            </li>
            <li>
              <b>建一个定时任务</b>粘到支持定时运行的 AI
              客户端里，建议每天一次、放在低峰时段。
            </li>
            <li>
              <b>回来决定做不做</b>
              需求先落在「候选池」，不是自动开工；点「采纳」才进未开始、才会被
              agent 认领。项目的「AI 巡检」开关关掉就不再提。
            </li>
          </ol>
          <div className="mfoot split">
            <div className="left">
              <button
                className="btn"
                onClick={() =>
                  copyTo(
                    prompt && prompt.stub,
                    "已复制巡检接入说明，粘贴给 AI 助手创建定时任务",
                    "巡检接入说明尚未就绪，请重启应用后重试",
                  )
                }
                title="复制巡检接入说明，粘贴给 AI 助手创建定时任务"
              >
                {IC.search}复制巡检接入说明
              </button>
            </div>
            <button className="btn primary" onClick={onClose}>
              完成
            </button>
          </div>
        </>
      ) : null}

      {tab === "worker" ? (
        <>
          <p className="ai-lead">
            让 AI 来取活：自己认领、开发、交付。
            <b>你验收并提交后，这个项目才会继续派下一条。</b>
          </p>
          <ol className="ai-steps">
            <li>
              <b>先在「Agent 管理」创建 Agent</b>只需创建一次，名称与 AgentID
              创建后固定。
            </li>
            <li>
              <b>在本页选择要使用的 Agent</b>然后复制接入说明，AgentID
              会自动写进去。同一个 Agent 只跑一个进程；要多开就多建几个
              Agent，分别复制。
            </li>
            <li>
              <b>在需求中心盯着</b>
              它交付后变「待审核」；它提问时需求行会标「待回答」，你在详情里回一句，它最多等
              5 分钟。
            </li>
          </ol>

          <div className="ai-selected">
            <span className="ai-selected-lbl">使用 Agent</span>
            <select
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
              disabled={!agentList.length}
              aria-label="选择 Agent"
            >
              <option value="">
                {agentList.length ? "请选择 Agent" : "还没有 Agent"}
              </option>
              {agentList.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            {selectedAgent ? (
              <span className="ai-selected-id">{selectedAgent.id}</span>
            ) : null}
            {!agentList.length ? (
              <span className="ai-selected-none">
                请先到「Agent 管理」创建。
              </span>
            ) : null}
          </div>

          <div className="ai-rules">
            <div>
              <b>不派活的情况</b>
              项目里有进行中任务、有未审核的交付、或工作区有未提交改动。
            </div>
            <div>
              <b>它不会提交代码</b>
              改动留在工作区，你验收后自己提交；提交前这个项目不会派新活。
            </div>
          </div>
          <div className="mfoot split">
            <div className="left">
              <span
                className="ai-copy-tip"
                title={
                  selectedAgent
                    ? "复制时写入 AgentID：" + selectedAgent.id
                    : "先在「Agent 管理」创建并选中一个 Agent"
                }
              >
                <button
                  className="btn"
                  onClick={copyWorkerPrompt}
                  disabled={!selectedAgent}
                >
                  {IC.play}
                  {selectedAgent ? "复制执行接入说明" : "先去选择 Agent"}
                </button>
              </span>
            </div>
          </div>
        </>
      ) : null}

      {tab === "mcp" ? (
        <>
          <p className="sub">
            把下面的配置注册到支持 MCP 的 AI
            客户端，客户端就能自动发现工具（查项目、查需求、提需求）。前面两个页签的定时任务不走
            MCP，不需要这段配置。
          </p>
          <div className={"mcp-state" + (running ? " is-run" : "")}>
            <span
              className={"plight" + (running ? " plight-run" : " is-off")}
            />
            <span className="mcp-state-text">{stateText}</span>
            {running ? (
              <span className="mcp-state-dim is-url" title={info.url}>
                {info.url}
              </span>
            ) : statePort ? (
              <span className="mcp-state-dim">{statePort}</span>
            ) : null}
          </div>
          <pre className="mcp-cfg">{cfg}</pre>
          {running ? null : (
            <p className="mcp-err">
              {(known
                ? err
                  ? mcpFailDesc(err)
                  : "没拿到启动失败的具体原因，端口 7318 可能被其他程序占用，点「重试」再试一次。"
                : "没能从主进程取到服务状态，点「重试」重新确认一次。") +
                " 上面的配置仍可复制。"}
            </p>
          )}
          <div className="mfoot split">
            <div className="left">
              <button
                className="btn"
                onClick={() => copyTo(cfg, "已复制 MCP 配置", "配置为空")}
                title="复制 MCP 客户端配置"
              >
                {IC.check}复制配置
              </button>
              {running ? null : (
                <button
                  className="btn"
                  onClick={onRetry}
                  disabled={busy}
                  title={
                    busy
                      ? undefined
                      : "重新启动 MCP 服务（需先释放被占用的端口）"
                  }
                >
                  {IC.refresh}
                  {busy ? "重试中…" : "重试"}
                </button>
              )}
            </div>
            <button className="btn primary" onClick={onClose}>
              完成
            </button>
          </div>
        </>
      ) : null}
      {addOpen
        ? createPortal(
            <div className="modal" role="dialog" aria-label="添加 Agent">
              <div className="scrim" onClick={() => setAddOpen(false)} />
              <div className="card wide">
                <h2>添加 Agent</h2>
                <p className="sub">
                  选一个本机已装的客户端，或自己填名称与技能目录。只有添加过的
                  Agent 的目录会被扫描。
                </p>

                <div className="ai-agent">
                  <div className="ai-agent-hd">
                    <b>本机已装</b>
                    <span>{clients.filter((c) => c.exists).length} 个</span>
                  </div>
                  {clients.filter((c) => c.exists).length ? (
                    clients
                      .filter((c) => c.exists)
                      .map((c) => {
                        // 本地注册表优先：刚登记完这一行要立刻变「已登记」，不能等下一次拉取
                        const owners = agentsUsingDir(c.dir);
                        const used =
                          owners.length > 0 || (c.agents || []).length > 0;
                        const who = owners.length
                          ? owners[0].name +
                            (owners.length > 1
                              ? " +" + (owners.length - 1)
                              : "")
                          : "";
                        return (
                          <button
                            key={c.client}
                            type="button"
                            className="ai-pick"
                            disabled={used || addBusy}
                            onClick={() => quickAdd(c)}
                            title={
                              used
                                ? "这个目录已经登记在" +
                                  (owners.length
                                    ? "「" +
                                      owners.map((o) => o.name).join("」「") +
                                      "」名下"
                                    : " Agent 名下")
                                : "点一下直接添加"
                            }
                          >
                            <span className="ai-pick-name">{c.label}</span>
                            <span className="ai-pick-dir">{c.dir}</span>
                            <span
                              className={
                                "ai-pick-tag" + (used ? " done" : " add")
                              }
                            >
                              {used
                                ? who
                                  ? "已登记 · " + who
                                  : "已登记"
                                : "添加"}
                            </span>
                          </button>
                        );
                      })
                  ) : (
                    <p className="ai-agent-empty">
                      没检测到已知客户端，用下面的自定义添加。
                    </p>
                  )}
                </div>

                <div className="ai-agent">
                  <div className="ai-agent-hd">
                    <b>自定义</b>
                    <span>名称和技能目录都可以自己填</span>
                  </div>
                  <div className="ai-agent-new">
                    <input
                      value={newName}
                      onChange={(e) => {
                        setNewName(e.target.value);
                        setAgentErr("");
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter")
                          submitAgent(newName, null, newDirs);
                      }}
                      placeholder="Agent 名称，例如 my-claude"
                      maxLength={64}
                      aria-label="Agent 名称"
                    />
                  </div>
                  {newDirs.length ? (
                    newDirs.map((d, i) => (
                      <div className="ai-dir-edit" key={i}>
                        <input
                          value={d}
                          onChange={(e) =>
                            setNewDirs((cur) =>
                              cur.map((x, j) => (j === i ? e.target.value : x)),
                            )
                          }
                          placeholder="技能目录，例如 ~/.claude/skills"
                        />
                        <button
                          className="btn sm"
                          onClick={() =>
                            chooseFolder((p) =>
                              setNewDirs((cur) =>
                                cur.map((x, j) => (j === i ? p : x)),
                              ),
                            )
                          }
                        >
                          选择
                        </button>
                        <button
                          className="btn sm"
                          onClick={() =>
                            setNewDirs((cur) => cur.filter((_, j) => j !== i))
                          }
                        >
                          删除
                        </button>
                      </div>
                    ))
                  ) : (
                    <p className="ai-agent-note">
                      没有目录也可以先添加，之后再补。
                    </p>
                  )}
                  <div className="ai-agent-new">
                    <button
                      className="btn sm"
                      onClick={() => setNewDirs((cur) => cur.concat(""))}
                    >
                      添加目录
                    </button>
                  </div>
                </div>

                {agentErr ? <p className="ai-agent-err">{agentErr}</p> : null}

                <div className="mfoot">
                  <button className="btn" onClick={() => setAddOpen(false)}>
                    取消
                  </button>
                  <button
                    className="btn primary"
                    onClick={() => submitAgent(newName, null, newDirs)}
                    disabled={addBusy}
                  >
                    {addBusy ? "添加中…" : "添加"}
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </Modal>
  );
}

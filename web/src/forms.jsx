import { useEffect, useState } from 'react';
import { api } from './api.js';
import ProjectRefInput from './components/ProjectRefInput.jsx';
import { usePendingChanges } from './hooks/usePendingChanges.js';
import { IC } from './icons.jsx';
import { DangerButton, Modal } from './ui.jsx';

function ErrorLine({ msg }) {
  if (!msg) return null;
  return <p className="sub" style={{ color: 'var(--red-text)', marginBottom: 10 }}>{msg}</p>;
}

/** 路径输入框 + 系统文件夹选择器 */
function FolderField({ value, onChange, placeholder }) {
  const [picking, setPicking] = useState(false);
  const [err, setErr] = useState('');

  async function pick() {
    if (picking) return;
    setPicking(true);
    setErr('');
    try {
      const res = await api.pickFolder(value.trim());
      if (res && res.path) onChange(res.path);
    } catch (e) {
      setErr((e.message || '无法打开文件夹选择器') + '，可以直接手动输入路径');
    } finally {
      setPicking(false);
    }
  }

  return (
    <>
      <div className="inputrow">
        <input
          className="mono"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          spellCheck={false}
        />
        <button type="button" className="btn" onClick={pick} disabled={picking}>
          {picking ? '等待选择…' : <>{IC.folder}选择…</>}
        </button>
      </div>
      {err ? (
        <div className="hintline" style={{ color: 'var(--red-text)' }}>
          {err}
        </div>
      ) : null}
    </>
  );
}

/* ── 项目 ─────────────────────────────────────── */

/** 文件夹路径最后一段作为默认项目名 */
function folderName(p) {
  return String(p || '').split(/[\\/]/).filter(Boolean).pop() || '';
}

export function ProjectForm({ mode, project, initialPath, onClose, onSave, onArchive }) {
  const [name, setName] = useState(project ? project.name : folderName(initialPath));
  const [path, setPath] = useState(project ? project.path : initialPath || '');
  const [aiScout, setAiScout] = useState(project ? project.aiScout !== false : true);
  /** 三态：'inherit' 跟随全局，「启动自动拉取」总开关关掉时一键让所有项目回到不拉 */
  const [autoPull, setAutoPull] = useState(
    project && typeof project.autoPull === 'boolean' ? String(project.autoPull) : 'inherit'
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const editing = mode === 'edit';

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErr('');
    try {
      await onSave({
        name: name.trim(),
        path: path.trim(),
        aiScout,
        autoPull: autoPull === 'inherit' ? null : autoPull === 'true'
      });
    } catch (e2) {
      setErr(e2.message);
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose}>
      <form onSubmit={submit}>
        <h2>{editing ? '项目设置' : '新建项目'}</h2>
        {!editing ? <p className="sub">登记到项目注册表 · 需求中心与启动台共用同一份</p> : null}

        <ErrorLine msg={err} />

        <div className="field">
          <label>项目名</label>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如 stock-sdk"
            spellCheck={false}
          />
        </div>

        <div className="field">
          <label>本地路径</label>
          {editing ? (
            <FolderField value={path} onChange={setPath} placeholder="D:\job\stock-sdk" />
          ) : (
            <input
              className="mono readonly"
              value={path}
              readOnly
              spellCheck={false}
              title={path}
            />
          )}
        </div>

        <div className="field">
          <label>AI 巡检</label>
          <label className="checkline">
            <input
              type="checkbox"
              checked={aiScout}
              disabled={busy}
              onChange={(e) => setAiScout(e.target.checked)}
            />
            <span>允许 AI 巡检给该项目提需求</span>
          </label>
        </div>

        <div className="field">
          <label>启动自动拉取</label>
          <select
            value={autoPull}
            disabled={busy}
            onChange={(e) => setAutoPull(e.target.value)}
            aria-label="启动自动拉取"
          >
            <option value="inherit">跟随全局设置</option>
            <option value="true">开启：软件启动时拉取本项目</option>
            <option value="false">关闭：启动时跳过本项目</option>
          </select>

        </div>

        <div className={'mfoot' + (editing ? ' split' : '')}>
          {editing ? (
            <div className="left">
              <DangerButton
                label="归档项目"
                confirmLabel="确认归档"
                disabled={busy}
                onConfirm={async () => {
                  setBusy(true);
                  try {
                    await onArchive();
                  } catch (e2) {
                    setErr(e2.message);
                    setBusy(false);
                  }
                }}
              />
            </div>
          ) : null}
          <button type="button" className="btn sm" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button type="submit" className="btn sm primary" disabled={busy}>
            {busy ? '保存中…' : editing ? '保存' : '创建项目'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ── 需求 ─────────────────────────────────────── */

/** 新建需求弹窗。改需求不在这里——需求中心右面板的详情页内直接编辑保存 */
export function RequirementForm({ project, projects, onClose, onSave }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [note, setNote] = useState('');
  /** 候选：想法还不成熟、先别让 agent 开工；默认不勾，与「新建就是待办」的直觉一致 */
  const [candidate, setCandidate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErr('');
    try {
      await onSave({ title: title.trim(), body, note, candidate });
    } catch (e2) {
      setErr(e2.message);
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose}>
      <form onSubmit={submit}>
        <h2>新建需求</h2>
        <p className="sub">
          {project.name + ' · 提交后状态为' + (candidate ? '「候选池」' : '「未开始」')}
        </p>

        <ErrorLine msg={err} />

        <div className="field">
          <label>标题</label>
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="一句话说明要做什么"
          />
        </div>

        <div className="field">
          <label>正文</label>
          <ProjectRefInput
            value={body}
            onChange={setBody}
            projects={projects}
            currentProjectId={project.id}
            rows={6}
            placeholder="背景、期望效果、约束条件… 输入 @ 引用项目/需求/文件，/ 指定要用的技能"
          />
        </div>

        <div className="field">
          <label className="checkline">
            <input
              type="checkbox"
              checked={candidate}
              disabled={busy}
              onChange={(e) => setCandidate(e.target.checked)}
            />
            <span>先放进候选池（候选）</span>
          </label>
        </div>

        <div className="field">
          <label>备注（可选）</label>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="例如：夜间巡检提出 / 已与某分支冲突"
          />
        </div>

        <div className="mfoot">
          <button type="button" className="btn sm" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button type="submit" className="btn sm primary" disabled={busy}>
            {busy ? '保存中…' : '创建需求'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ── 需求状态备注 ─────────────────────────────── */

/**
 * 标记已完成 / 拒绝 / 打回 / 撤销已完成时的弹窗。
 * 完成与拒绝的备注留空也能提交——原备注（多为 AI 提需求时的判断）此时通常已过时，留空即清空。
 * 打回与撤销重开不同：原因写进独立反馈字段，agent 下次认领会读到，所以必填。
 */
export function RequirementStatusForm({ requirement, status, onClose, onConfirm, onNavigate }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const done = status === 'done';
  /** 待审核需求点「通过」：同一个 done 状态，但这是验收动作，文案要换掉 */
  const approve = done && requirement.status === 'review';
  /** 打回：待审核 → 进行中，原因回传给 agent */
  const reject = requirement.status === 'review' && status === 'doing';
  /** 撤销已完成：回未开始，原因同样回传给下一位认领的 agent */
  const reopen = status === 'todo';
  /** 丢弃候选：进「已拒绝」，但它本来就不算未完成，文案不能沿用「拒绝后不再算未完成」 */
  const dropCandidate = requirement.status === 'candidate' && status === 'rejected';
  /**
   * 标题 / 副标题 / 确认按钮三段文案由「这次点的是哪个动作」唯一决定。
   * 顺序 if/else 读起来是从上往下取第一个命中，比在 JSX 里套多层三元好改也好核对。
   */
  let copy = { title: '拒绝需求', sub: '拒绝后不再算未完成', ok: '确认拒绝' };
  if (approve) copy = { title: '审核通过', sub: '通过后不再算未完成', ok: '确认通过' };
  else if (done) copy = { title: '标记已完成', sub: '完成后不再算未完成', ok: '标记已完成' };
  else if (reject) copy = { title: '打回需求', sub: '打回后回到进行中，原因随认领返回给 agent', ok: '确认打回' };
  else if (reopen) copy = { title: '撤销已完成需求', sub: '撤销后回到未开始，原因随认领返回给 agent', ok: '确认撤销' };
  else if (dropCandidate) copy = { title: '丢弃候选需求', sub: '丢弃后离开候选池，记录可在「已拒绝」里回看', ok: '确认丢弃' };
  const old = String(requirement.note || '').trim();
  const oldFeedback = String((requirement.feedback && requirement.feedback.note) || '').trim();
  /** 验收时工作区还有未提交改动：大概率就是这次交付的代码，给一个顺手提交推送的选项 */
  const pending = usePendingChanges(requirement.projectId, approve);
  const [commitPush, setCommitPush] = useState(true);
  const autoCommitPush = approve && pending > 0 && commitPush;

  /** 查看改动：关掉弹窗后切到该项目的修改记录页，并默认选中第一个未提交改动 */
  function viewChanges() {
    if (busy) return;
    onClose();
    if (onNavigate) onNavigate({ page: 'changes', projectId: requirement.projectId, openWorking: true });
  }

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    const text = note.trim();
    if ((reject || reopen) && !text) {
      setErr(reopen ? '请填写撤销原因，agent 重新认领时会读取它' : '请填写打回原因，agent 认领时会读取它');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      await onConfirm(text, { autoCommitPush });
    } catch (e2) {
      setErr(e2.message);
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose}>
      <form onSubmit={submit}>
        <h2>{copy.title}</h2>
        <p className="sub">
          #{requirement.seq}「{requirement.title}」· {copy.sub}
        </p>

        <ErrorLine msg={err} />

        {reject || reopen ? (
          oldFeedback ? (
            <div className="oldnote">
              <span>{reject ? '上次打回原因' : '上次反馈'}（提交后会被覆盖）</span>
              <p>{oldFeedback}</p>
            </div>
          ) : null
        ) : (
          <div className="oldnote">
            <span>当前备注（提交后整条替换）</span>
            <p>{old || '（无）'}</p>
          </div>
        )}

        <div className="field">
          <label>{reject ? '打回原因' : reopen ? '撤销原因' : '新备注（选填）'}</label>
          <input
            autoFocus
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={
              reject
                ? '例如：导出按钮缺少 loading 态；错误提示文案与设计稿不符'
                : reopen
                  ? '例如：验收结论有误，导出功能的边界情况需要补做'
                  : approve
                    ? '例如：改动已核对，合并到 main（abc1234），构建通过'
                    : done
                      ? '例如：已合并到 main（abc1234），构建通过'
                      : '例如：与下个版本规划冲突，暂时不做'
            }
          />
          <div className="hintline">
            {reject || reopen
              ? '原因会随 /claim 返回给 agent，并写进往返记录；留空无法提交'
              : '留空提交会清空原备注'}
          </div>
        </div>

        {approve && pending > 0 ? (
          <div className="field">
            <div className="checkrow">
              <label className="checkline">
                <input
                  type="checkbox"
                  checked={commitPush}
                  disabled={busy}
                  onChange={(e) => setCommitPush(e.target.checked)}
                />
                <span>提交并推送当前 {pending} 个文件的改动</span>
              </label>
              <button type="button" className="linklike" onClick={viewChanges} disabled={busy}>
                查看改动
              </button>
            </div>
            <div className="hintline">
              提交信息用 agent 单独提供的文案，不含会话回复；推送失败不影响验收
            </div>
          </div>
        ) : null}

        <div className="mfoot">
          <button type="button" className="btn sm" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button
            type="submit"
            className={'btn sm ' + (done || reject ? 'primary' : 'danger-solid')}
            disabled={busy}
          >
            {busy ? '提交中…' : copy.ok}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ── 启动命令 ─────────────────────────────────── */

/** 选中的脚本转成命令：只留文件名（工作目录已指向脚本所在目录），含空格等字符时加引号 */
function scriptCommand(file) {
  const p = String(file || '');
  const base = p.split(/[\\/]/).pop() || p;
  const win = (window.pm && window.pm.platform) === 'win32';
  // POSIX 下当前目录不在 PATH 里，需要 ./ 前缀；Windows 的 cmd 会先搜当前目录
  const target = win ? base : './' + base;
  const quoted = /[\s"&|<>^()]/.test(target) ? '"' + target + '"' : target;
  const dot = base.lastIndexOf('.');
  const ext = dot >= 0 ? base.slice(dot).toLowerCase() : '';
  if (win && ext === '.ps1') return 'powershell -NoProfile -ExecutionPolicy Bypass -File ' + quoted;
  return quoted;
}

export function CommandForm({ mode, project, command, onClose, onSave, onDelete }) {
  const [text, setText] = useState(command ? command.text : '');
  const [cwd, setCwd] = useState(command ? command.cwd : project.path);
  const [name, setName] = useState(command ? command.name || '' : '');
  const [noProjectEnv, setNoProjectEnv] = useState(!!(command && command.noProjectEnv));
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [pickErr, setPickErr] = useState('');
  const [err, setErr] = useState('');
  /** 新增时识别到的项目类型与推荐命令；null = 还没拉到（编辑模式不拉） */
  const [sug, setSug] = useState(null);
  /** 上一次由推荐命令自动填入的备注名：用户改过就不再覆盖 */
  const [autoName, setAutoName] = useState('');

  const editing = mode === 'edit';
  const projectId = project ? project.id : null;

  useEffect(() => {
    if (editing || !projectId) return undefined;
    let alive = true;
    api
      .commandSuggestions(projectId)
      .then((res) => {
        if (alive) setSug(res || { types: [], suggestions: [] });
      })
      .catch(() => {
        // 识别失败不影响手填命令，静默回落成空推荐
        if (alive) setSug({ types: [], suggestions: [] });
      });
    return () => {
      alive = false;
    };
  }, [editing, projectId]);

  /** 点推荐命令：填入命令文本；备注名没被用户改过时跟着换 */
  function applySuggestion(s) {
    setText(s.text);
    const cur = name.trim();
    if (!cur || cur === autoName) {
      setName(s.name);
      setAutoName(s.name);
    }
  }

  async function pickScript() {
    if (picking) return;
    setPicking(true);
    setPickErr('');
    try {
      const res = await api.pickScript(cwd.trim() || project.path);
      if (res && res.path) {
        setText(scriptCommand(res.path));
        setCwd(res.dir || '');
      }
    } catch (e) {
      setPickErr((e.message || '无法打开脚本选择器') + '，可以直接手动输入命令');
    } finally {
      setPicking(false);
    }
  }

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErr('');
    try {
      await onSave({ text: text.trim(), cwd: cwd.trim(), name: name.trim(), noProjectEnv });
    } catch (e2) {
      setErr(e2.message);
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose}>
      <form onSubmit={submit}>
        <h2>{editing ? '命令设置' : '新增命令'}</h2>
        {editing ? <p className="sub">修改后从下一次启动生效 · 运行中不可编辑</p> : null}

        <ErrorLine msg={err} />

        <div className="field">
          <label>命令</label>
          <div className="inputrow">
            <input
              autoFocus
              className="mono"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="npm run dev"
              spellCheck={false}
            />
            <button type="button" className="btn" onClick={pickScript} title="选择脚本" disabled={picking || busy}>
              {picking ? '等待选择…' : <>{IC.script}</>}
            </button>
          </div>
          {pickErr ? (
            <div className="hintline" style={{ color: 'var(--red-text)' }}>
              {pickErr}
            </div>
          ) : null}
          <div className="hintline">按 shell 语法解析，支持 && 串联；选择脚本会自动填入脚本名与工作目录</div>
        </div>

        {!editing && sug ? (
          <div className="field cmdsug">
            <label>推荐命令</label>
            {sug.types && sug.types.length ? (
              <>
                <div className="cmdsug-types">
                  <span className="cmdsug-lead">识别到</span>
                  {sug.types.map((t) => (
                    <span className="cmdsug-type" key={t.id} title={'依据：' + (t.evidence || []).join('、')}>
                      {t.label}
                      <i>{(t.evidence || []).join(' · ')}</i>
                    </span>
                  ))}
                </div>
                {sug.suggestions && sug.suggestions.length ? (
                  <div className="cmdsug-list">
                    {sug.suggestions.map((s) => (
                      <button
                        type="button"
                        key={s.text}
                        className={'cmdsug-row' + (text.trim() === s.text ? ' on' : '')}
                        title={s.reason}
                        onClick={() => applySuggestion(s)}
                      >
                        <span className="cmdsug-code">{s.text}</span>
                        <span className="cmdsug-name">{s.name}</span>
                        <span className="cmdsug-reason">{s.reason}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="hintline">这个项目的常用命令都已添加过了</div>
                )}
              </>
            ) : (
              <div className="hintline">
                没识别到常见项目类型（package.json / pom.xml / build.gradle…），可直接手填命令
              </div>
            )}
          </div>
        ) : null}

        <div className="field">
          <label>工作目录</label>
          <FolderField value={cwd} onChange={setCwd} placeholder={project.path} />
          <div className="hintline">不填就用项目路径 · 命令在这个目录下执行</div>
        </div>

        <div className="field">
          <label>备注名（可选）</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如 开发服务器" />
        </div>

        <div className="field">
          <label>项目环境变量</label>
          <label className="checkline">
            <input
              type="checkbox"
              checked={noProjectEnv}
              disabled={busy}
              onChange={(e) => setNoProjectEnv(e.target.checked)}
            />
            <span>不注入项目扩展信息里配置的环境变量</span>
          </label>
          <div className="hintline">默认注入；个别命令需要干净环境时再勾选</div>
        </div>

        <div className={'mfoot' + (editing ? ' split' : '')}>
          {editing ? (
            <div className="left">
              <DangerButton
                label="删除命令"
                confirmLabel="确认删除"
                disabled={busy}
                onConfirm={async () => {
                  setBusy(true);
                  try {
                    await onDelete();
                  } catch (e2) {
                    setErr(e2.message);
                    setBusy(false);
                  }
                }}
              />
            </div>
          ) : null}
          <button type="button" className="btn sm" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button type="submit" className="btn sm primary" disabled={busy}>
            {busy ? '保存中…' : editing ? '保存' : '添加命令'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

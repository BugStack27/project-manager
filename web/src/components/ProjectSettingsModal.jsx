import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { avatarColor } from '../format.js';
import { IC } from '../icons.jsx';
import { matchProjects } from '../lib/project-palette.js';
import { Avatar, DangerButton, Modal, ProjectIcon, ProjectStackList } from '../ui.jsx';
import MarkdownText from './MarkdownText.jsx';
import ProjectRefInput from './ProjectRefInput.jsx';

const EMPTY_EXTRAS = { links: [], env: [], rules: [] };
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

const SECTIONS = [
  { id: 'basic', label: '基础', icon: IC.gear },
  { id: 'links', label: '关联项目', icon: IC.link },
  { id: 'env', label: '环境', icon: IC.term },
  { id: 'rules', label: '规则', icon: IC.auto }
];

function clockNow() {
  const d = new Date();
  return [d.getHours(), d.getMinutes()].map((n) => String(n).padStart(2, '0')).join(':');
}

function ErrorLine({ msg }) {
  if (!msg) return null;
  return <p className="pset-err">{msg}</p>;
}

/**
 * 项目设置：左侧分区锚点 + 右侧连续滚动。
 * 基础区显式保存；关联 / 环境 / 规则改一条存一条，底部持续显示保存状态。
 * 规则正文按 Markdown 渲染，`{UseSkill:id}` 由服务端解析成技能 chip，随任务下发给 Agent。
 */
export default function ProjectSettingsModal({
  project,
  projects,
  onClose,
  onSave,
  onArchive,
  onReveal,
  notify
}) {
  const [extras, setExtras] = useState(null);
  const [loadErr, setLoadErr] = useState('');
  const [saveState, setSaveState] = useState('saved');
  const [savedAt, setSavedAt] = useState(clockNow());
  const [active, setActive] = useState('basic');
  const contentRef = useRef(null);
  const saveSeq = useRef(0);

  const [name, setName] = useState(project.name);
  const [path, setPath] = useState(project.path);
  const [aiScout, setAiScout] = useState(project.aiScout !== false);
  const [autoPull, setAutoPull] = useState(
    typeof project.autoPull === 'boolean' ? String(project.autoPull) : 'inherit'
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [pathErr, setPathErr] = useState('');

  useEffect(() => {
    let alive = true;
    api
      .project(project.id)
      .then((res) => {
        if (alive) setExtras((res && res.extras) || EMPTY_EXTRAS);
      })
      .catch((e) => {
        if (!alive) return;
        setExtras(EMPTY_EXTRAS);
        setLoadErr(e.message || '扩展信息加载失败');
      });
    return () => {
      alive = false;
    };
  }, [project.id]);

  // 连续滚动：哪一段进入视口上半区，左栏就高亮哪一项
  useEffect(() => {
    const root = contentRef.current;
    if (!root || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (hit) setActive(hit.target.id.replace('pset-sec-', ''));
      },
      { root, rootMargin: '0px 0px -62% 0px', threshold: 0 }
    );
    SECTIONS.forEach((s) => {
      const el = root.querySelector('#pset-sec-' + s.id);
      if (el) io.observe(el);
    });
    return () => io.disconnect();
  }, []);

  const initAutoPull = typeof project.autoPull === 'boolean' ? String(project.autoPull) : 'inherit';
  const dirty =
    name.trim() !== project.name ||
    path.trim() !== project.path ||
    aiScout !== (project.aiScout !== false) ||
    autoPull !== initAutoPull;

  const links = extras ? extras.links : [];
  const env = extras ? extras.env : [];
  const rules = extras ? extras.rules : [];
  const enabledRules = rules.filter((r) => r.enabled).length;

  function goto(id) {
    setActive(id);
    const el = contentRef.current && contentRef.current.querySelector('#pset-sec-' + id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function saveExtras(patch) {
    const seq = ++saveSeq.current;
    setSaveState('saving');
    try {
      const res = await api.updateProject(project.id, { extras: patch });
      if (seq === saveSeq.current) {
        setExtras(res.extras || EMPTY_EXTRAS);
        setSaveState('saved');
        setSavedAt(clockNow());
      }
    } catch (e) {
      if (seq === saveSeq.current) {
        setSaveState('error');
        notify(e.message || '保存失败', 'warn');
      }
      try {
        const res = await api.project(project.id);
        if (seq === saveSeq.current && res.extras) setExtras(res.extras);
      } catch (_) {}
      throw e;
    }
  }

  async function submitBasic() {
    if (busy || !dirty) return;
    setBusy(true);
    setErr('');
    try {
      await onSave({
        name: name.trim(),
        path: path.trim(),
        aiScout,
        autoPull: autoPull === 'inherit' ? null : autoPull === 'true'
      });
    } catch (e) {
      setErr(e.message);
      notify(e.message || '保存失败', 'warn');
      setBusy(false);
    }
  }

  async function choosePath() {
    setPathErr('');
    try {
      const res = await api.pickFolder(path.trim());
      if (res && res.path) setPath(res.path);
    } catch (e) {
      setPathErr(e.message || '无法打开文件夹选择器');
    }
  }

  function copyPath() {
    const text = path.trim() || project.path;
    if (!navigator.clipboard || !navigator.clipboard.writeText) {
      notify('复制失败，请手动选择文本复制', 'warn');
      return;
    }
    navigator.clipboard.writeText(text).then(
      () => notify('已复制项目路径'),
      () => notify('复制失败，请手动选择文本复制', 'warn')
    );
  }

  return (
    <Modal onClose={onClose} className="pset">
      <header className="pset-head">
        <ProjectIcon project={project} color={avatarColor(projects || [], project.id)} size={42} />
        <div className="pset-id">
          <div className="pset-id-name">
            {project.name}
            {project.pendingCount > 0 ? <span className="pset-badge">未完成 {project.pendingCount}</span> : null}
          </div>
          <div className="pset-id-meta">
            <code title={project.path}>{project.path}</code>
            <ProjectStackList project={project} size={11} />
          </div>
        </div>
        <div className="pset-head-actions">
          {onReveal ? (
            <button type="button" className="btn sm ghost" onClick={() => onReveal(project)}>
              {IC.folder}打开位置
            </button>
          ) : null}
          <button type="button" className="pset-x" onClick={onClose} title="关闭" aria-label="关闭">
            {IC.x}
          </button>
        </div>
      </header>

      <div className="pset-body">
        <nav className="pset-nav" aria-label="设置分区">
          {SECTIONS.map((s) => {
            const count = s.id === 'links' ? links.length : s.id === 'env' ? env.length : s.id === 'rules' ? rules.length : null;
            return (
              <button
                key={s.id}
                type="button"
                className={'pset-nav-item' + (active === s.id ? ' on' : '')}
                onClick={() => goto(s.id)}
              >
                <span className="pset-nav-ico">{s.icon}</span>
                {s.label}
                {s.id === 'basic' && dirty ? <i className="pset-dirty" title="有未保存的改动" /> : null}
                {count !== null ? <span className="pset-count">{count}</span> : null}
              </button>
            );
          })}

          <div className="pset-impact">
            <span className="pset-impact-title">生效范围</span>
            <div className="pset-impact-row">
              <span>启动命令</span>
              <b>{project.commandCount || 0}</b>
            </div>
            <div className="pset-impact-row">
              <span>Agent 规则</span>
              <b>{enabledRules}</b>
            </div>
          </div>

          <div className="pset-nav-foot">
            <DangerButton
              label="归档项目"
              confirmLabel="确认归档"
              disabled={busy}
              onConfirm={async () => {
                setBusy(true);
                setErr('');
                try {
                  await onArchive(project);
                  onClose();
                } catch (e) {
                  notify(e.message || '归档失败', 'warn');
                  setErr(e.message);
                  setBusy(false);
                }
              }}
            />
          </div>
        </nav>

        <div className="pset-content" ref={contentRef}>
          {loadErr ? <ErrorLine msg={loadErr} /> : null}

          <section className="pset-sec" id="pset-sec-basic">
            <div className="pset-sec-head">
              <h2>基础</h2>
              {err ? <span className="pset-sec-err">{err}</span> : null}
            </div>

            <div className="pset-group">
              <div className="pset-row">
                <span className="pset-label">项目名</span>
                <input
                  className="pset-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  spellCheck={false}
                  aria-label="项目名"
                />
              </div>
              <div className="pset-row">
                <span className="pset-label">本地路径</span>
                <div className="pset-path">
                  <input
                    value={path}
                    onChange={(e) => setPath(e.target.value)}
                    spellCheck={false}
                    aria-label="本地路径"
                    placeholder={project.path}
                  />
                  <button type="button" className="pset-iconbtn" title="复制路径" onClick={copyPath}>
                    {IC.copy}
                  </button>
                  <button type="button" className="btn sm" onClick={choosePath}>
                    选择…
                  </button>
                </div>
              </div>
              {pathErr ? <p className="pset-row-err">{pathErr}</p> : null}
            </div>

            <div className="pset-group">
              <div className="pset-row">
                <span className="pset-label">AI 巡检</span>
                <label className="pset-switch">
                  <input
                    type="checkbox"
                    checked={aiScout}
                    disabled={busy}
                    onChange={(e) => setAiScout(e.target.checked)}
                    aria-label="AI 巡检"
                  />
                  <i />
                </label>
              </div>
              <div className="pset-row">
                <span className="pset-label">启动自动拉取</span>
                <select
                  className="pset-select"
                  value={autoPull}
                  disabled={busy}
                  onChange={(e) => setAutoPull(e.target.value)}
                  aria-label="启动自动拉取"
                >
                  <option value="inherit">跟随全局</option>
                  <option value="true">开启</option>
                  <option value="false">关闭</option>
                </select>
              </div>
            </div>
          </section>

          <section className="pset-sec" id="pset-sec-links">
            <div className="pset-sec-head">
              <h2>关联项目</h2>
              <span className="pset-tag">单向</span>
              <span className="pset-tag">Agent 可读</span>
            </div>
            <LinksSection
              extras={extras}
              projects={projects}
              projectId={project.id}
              saveExtras={saveExtras}
            />
          </section>

          <section className="pset-sec" id="pset-sec-env">
            <div className="pset-sec-head">
              <h2>环境变量</h2>
              <span className="pset-tag">启动台默认注入</span>
              <span className="pset-tag">Agent 可读</span>
            </div>
            <EnvSection
              extras={extras}
              saveExtras={saveExtras}
              commandCount={project.commandCount || 0}
            />
          </section>

          <section className="pset-sec" id="pset-sec-rules">
            <div className="pset-sec-head">
              <h2>规则</h2>
              <span className="pset-tag">Markdown</span>
              <span className="pset-tag">Agent 可读</span>
            </div>
            <RulesSection
              extras={extras}
              projects={projects}
              projectId={project.id}
              saveExtras={saveExtras}
              notify={notify}
            />
          </section>
        </div>
      </div>

      <footer className="pset-foot">
        <span className={'pset-saved' + (saveState === 'error' ? ' err' : '')}>
          <i />
          {saveState === 'saving' ? '保存中…' : saveState === 'error' ? '保存失败' : '所有更改已保存'}
          {savedAt && saveState === 'saved' ? <span className="time">{savedAt}</span> : null}
        </span>
        <div className="pset-foot-actions">
          <button type="button" className="btn sm" onClick={onClose}>
            关闭
          </button>
          <button type="button" className="btn sm primary" onClick={submitBasic} disabled={busy || !dirty}>
            {busy ? '保存中…' : '保存'}
          </button>
        </div>
      </footer>
    </Modal>
  );
}

/* ── 关联项目 ─────────────────────────────── */

function LinkRow({ link, project, projects, onNote, onRemove }) {
  const [note, setNote] = useState(link.note || '');
  useEffect(() => setNote(link.note || ''), [link.note]);

  return (
    <article className="pset-link">
      {project ? (
        <ProjectIcon project={project} color={avatarColor(projects || [project], project.id)} size={30} />
      ) : (
        <Avatar name={link.name || '?'} color={link.exists ? 'var(--label-4)' : 'var(--red)'} size={30} />
      )}
      <div className="pset-link-main">
        <div className="pset-link-top">
          <span className="pset-link-name">{link.name || '项目已删除'}</span>
          {link.archived ? <span className="pset-tag">已归档</span> : null}
          {!link.exists ? <span className="pset-tag bad">已失效</span> : null}
        </div>
        <div className="pset-link-path" title={link.path}>{link.path}</div>
        <input
          className="pset-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => {
            const next = note.trim();
            if (next === (link.note || '')) return;
            Promise.resolve(onNote(next)).catch(() => setNote(link.note || ''));
          }}
          placeholder="写一条备注"
          spellCheck={false}
          aria-label={link.name + ' 的备注'}
        />
      </div>
      <button type="button" className="pset-iconbtn" title="移除关联" aria-label="移除关联" onClick={onRemove}>
        {IC.x}
      </button>
    </article>
  );
}

function LinksSection({ extras, projects, projectId, saveExtras }) {
  const [q, setQ] = useState('');
  const [picking, setPicking] = useState(false);
  const draft = useRef([]);

  const links = extras ? extras.links : [];
  useEffect(() => {
    draft.current = links;
  }, [links]);

  const linkedIds = useMemo(() => new Set(links.map((l) => l.projectId)), [links]);
  const hits = useMemo(() => {
    const all = Array.isArray(projects) ? projects : [];
    return matchProjects(
      all.filter((p) => p.id !== projectId && !linkedIds.has(p.id)),
      q
    ).slice(0, 8);
  }, [projects, projectId, linkedIds, q]);

  if (!extras) return <p className="pset-loading">加载中…</p>;

  const payload = (list) => list.map((l) => ({ id: l.id, projectId: l.projectId, note: l.note }));

  function add(target) {
    setQ('');
    setPicking(false);
    const cur = draft.current;
    if (cur.some((l) => l.projectId === target.id)) return;
    const next = [...payload(cur), { projectId: target.id, note: '' }];
    draft.current = next;
    saveExtras({ links: next }).catch(() => {});
  }

  function setNote(link, note) {
    const next = payload(draft.current.map((l) => (l.id === link.id ? { ...l, note } : l)));
    draft.current = next;
    return saveExtras({ links: next });
  }

  function remove(link) {
    const next = payload(draft.current.filter((l) => l.id !== link.id));
    draft.current = next;
    saveExtras({ links: next }).catch(() => {});
  }

  return (
    <>
      {links.length ? (
        <div className="pset-links">
          {links.map((l) => (
            <LinkRow
              key={l.id}
              link={l}
              project={projects.find((p) => p.id === l.projectId)}
              projects={projects}
              onNote={(note) => setNote(l, note)}
              onRemove={() => remove(l)}
            />
          ))}
        </div>
      ) : null}

      {picking ? (
        <div
          className="pset-picker"
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget)) setPicking(false);
          }}
        >
          <div className="pset-picker-search">
            {IC.search}
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜索项目"
              spellCheck={false}
            />
          </div>
          {hits.map((row) => (
            <button
              type="button"
              key={row.p.id}
              className="pset-pick"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => add(row.p)}
            >
              <ProjectIcon project={row.p} color={avatarColor(projects, row.p.id)} size={24} />
              <span className="pset-pick-main">
                <span className="pset-pick-name">{row.p.name}</span>
                <span className="pset-pick-path">{row.p.path}</span>
              </span>
            </button>
          ))}
          {!hits.length ? <p className="pset-pick-empty">没有匹配的项目</p> : null}
        </div>
      ) : (
        <button type="button" className="pset-add" onClick={() => setPicking(true)}>
          <span className="pset-add-plus">{IC.plusSmall || IC.plus}</span>
          关联项目
        </button>
      )}
    </>
  );
}

/* ── 环境变量 ─────────────────────────────── */

function EnvRow({ item, onSave, onRemove }) {
  const [key, setKey] = useState(item.key);
  const [value, setValue] = useState(item.value);
  const [err, setErr] = useState('');
  useEffect(() => {
    setKey(item.key);
    setValue(item.value);
    setErr('');
  }, [item.key, item.value]);

  function commit() {
    const k = key.trim();
    if (!k) return setErr('变量名不能为空');
    if (!ENV_KEY_RE.test(k)) return setErr('只能用字母、数字、下划线，且不能以数字开头');
    if (k === item.key && value === item.value) return setErr('');
    setErr('');
    Promise.resolve(onSave(k, value)).catch((e) => setErr(e.message || '保存失败'));
  }

  return (
    <div className="pset-env-row">
      <input
        className="pset-env-k"
        value={key}
        onChange={(e) => setKey(e.target.value)}
        onBlur={commit}
        spellCheck={false}
        aria-label="变量名"
      />
      <span className="pset-env-eq">=</span>
      <input
        className="pset-env-v"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        spellCheck={false}
        aria-label="变量值"
      />
      <button type="button" className="pset-iconbtn" title="删除变量" aria-label="删除变量" onClick={onRemove}>
        {IC.x}
      </button>
      {err ? <p className="pset-env-err">{err}</p> : null}
    </div>
  );
}

function EnvSection({ extras, saveExtras, commandCount }) {
  const draft = useRef([]);
  const [nk, setNk] = useState('');
  const [nv, setNv] = useState('');
  const [nerr, setNerr] = useState('');
  const [pasting, setPasting] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteErr, setPasteErr] = useState('');

  const rows = extras ? extras.env : [];
  useEffect(() => {
    draft.current = rows;
  }, [rows]);

  if (!extras) return <p className="pset-loading">加载中…</p>;

  const payload = (list) => list.map((e) => ({ id: e.id, key: e.key, value: e.value }));
  function commit(next) {
    draft.current = next;
    return saveExtras({ env: next });
  }

  function setRow(item, key, value) {
    const low = key.toLowerCase();
    if (draft.current.some((x) => x.id !== item.id && x.key.toLowerCase() === low)) {
      return Promise.reject(new Error('环境变量名重复：' + key));
    }
    return commit(payload(draft.current.map((x) => (x.id === item.id ? { ...x, key, value } : x))));
  }

  function add() {
    const k = nk.trim();
    if (!k) return setNerr('变量名不能为空');
    if (!ENV_KEY_RE.test(k)) return setNerr('只能用字母、数字、下划线，且不能以数字开头');
    if (draft.current.some((x) => x.key.toLowerCase() === k.toLowerCase())) {
      return setNerr('环境变量名重复：' + k);
    }
    setNerr('');
    commit([...payload(draft.current), { key: k, value: nv }])
      .then(() => {
        setNk('');
        setNv('');
      })
      .catch((e) => setNerr(e.message || '保存失败'));
  }

  function applyPaste() {
    const lines = pasteText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const seen = new Set(draft.current.map((e) => e.key.toLowerCase()));
    const next = [...payload(draft.current)];
    for (const line of lines) {
      const i = line.indexOf('=');
      if (i < 0) return setPasteErr('有一行不是 KEY=VALUE：' + line);
      const key = line.slice(0, i).trim();
      const value = line.slice(i + 1).trim();
      if (!key || !ENV_KEY_RE.test(key)) return setPasteErr('变量名不合法：' + key);
      const low = key.toLowerCase();
      if (seen.has(low)) return setPasteErr('变量名重复：' + key);
      seen.add(low);
      next.push({ key, value });
    }
    setPasteErr('');
    commit(next)
      .then(() => {
        setPasting(false);
        setPasteText('');
      })
      .catch((e) => setPasteErr(e.message || '保存失败'));
  }

  return (
    <>
      <div className="pset-info">
        <span><b>{rows.length}</b> 条变量</span>
        <span className="pset-info-sep" />
        <span>影响 <b>{commandCount}</b> 条启动命令</span>
        <button type="button" className="pset-linklike" onClick={() => setPasting((v) => !v)}>
          批量粘贴
        </button>
      </div>

      {pasting ? (
        <div className="pset-paste">
          <textarea
            rows={4}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder={'JAVA_HOME=D:\\software\\jdk-21\nMAVEN_HOME=D:\\software\\maven-3.9'}
            spellCheck={false}
            autoFocus
          />
          {pasteErr ? <p className="pset-env-err">{pasteErr}</p> : null}
          <div className="pset-paste-foot">
            <button type="button" className="btn sm" onClick={() => { setPasting(false); setPasteErr(''); }}>
              取消
            </button>
            <button type="button" className="btn sm primary" onClick={applyPaste}>
              添加
            </button>
          </div>
        </div>
      ) : null}

      <div className="pset-env-card">
        {rows.map((item) => (
          <EnvRow
            key={item.id}
            item={item}
            onSave={(key, value) => setRow(item, key, value)}
            onRemove={() => commit(payload(draft.current.filter((x) => x.id !== item.id))).catch(() => {})}
          />
        ))}
        <div className="pset-env-add">
          <input
            className="pset-env-k"
            value={nk}
            onChange={(e) => setNk(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
            placeholder="KEY"
            spellCheck={false}
            aria-label="新变量名"
          />
          <span className="pset-env-eq">=</span>
          <input
            className="pset-env-v"
            value={nv}
            onChange={(e) => setNv(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
            placeholder="值 / 路径"
            spellCheck={false}
            aria-label="新变量值"
          />
          <button type="button" className="btn sm" onClick={add}>
            添加
          </button>
        </div>
      </div>
      {nerr ? <p className="pset-env-err">{nerr}</p> : null}
    </>
  );
}

/* ── 规则 ─────────────────────────────────── */

function RuleRow({ item, no, onSave, onToggle, onRemove, projects, projectId }) {
  const [title, setTitle] = useState(item.title);
  const [body, setBody] = useState(item.body);
  const [editing, setEditing] = useState(false);
  const [err, setErr] = useState('');
  const editRef = useRef(null);

  useEffect(() => {
    setTitle(item.title);
    setBody(item.body);
    setErr('');
  }, [item.title, item.body]);

  // 编辑时把卡片滚到内容区顶部，给技能候选面板留出空间，避免被滚动容器裁掉
  useEffect(() => {
    if (editing && editRef.current) editRef.current.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [editing]);

  function validate(t, b) {
    if (!t && !b) return '标题和内容至少填一项';
    if (t.length > 80) return '标题最多 80 字';
    if (b.length > 4000) return '内容最多 4000 字';
    return '';
  }

  function saveTitle() {
    const t = title.trim();
    if (t === item.title) return;
    const msg = validate(t, item.body);
    if (msg) return setErr(msg);
    setErr('');
    Promise.resolve(onSave(t, item.body)).catch(() => setTitle(item.title));
  }

  function commitEdit() {
    const t = title.trim();
    const b = body.trim();
    const msg = validate(t, b);
    if (msg) return setErr(msg);
    setErr('');
    Promise.resolve(onSave(t, b))
      .then(() => setEditing(false))
      .catch((e) => setErr(e.message || '保存失败'));
  }

  function cancelEdit() {
    setTitle(item.title);
    setBody(item.body);
    setErr('');
    setEditing(false);
  }

  return (
    <article className={'pset-rule' + (item.enabled ? '' : ' off')} ref={editRef}>
      <div className="pset-rule-head">
        <span className="pset-rule-no">{String(no).padStart(2, '0')}</span>
        <input
          className="pset-rule-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={editing ? undefined : saveTitle}
          placeholder="规则标题"
          spellCheck={false}
          aria-label="规则标题"
        />
        <label className="pset-switch">
          <input
            type="checkbox"
            checked={item.enabled}
            onChange={(e) => onToggle(e.target.checked)}
            aria-label="启用规则"
          />
          <i />
        </label>
        {editing ? null : (
          <button type="button" className="pset-iconbtn" title="编辑内容" aria-label="编辑内容" onClick={() => setEditing(true)}>
            {IC.pencil}
          </button>
        )}
        <button type="button" className="pset-iconbtn" title="删除规则" aria-label="删除规则" onClick={onRemove}>
          {IC.x}
        </button>
      </div>

      {editing ? (
        <div className="pset-rule-edit">
          <ProjectRefInput
            value={body}
            onChange={setBody}
            projects={projects}
            currentProjectId={projectId}
            rows={4}
            className="pset-md-input"
            placeholder="支持 Markdown；输入 / 插入技能"
            autoFocus
            skillsOnly
          />
          {err ? <p className="pset-env-err">{err}</p> : null}
          <div className="pset-rule-actions">
            <button type="button" className="btn sm" onClick={cancelEdit}>
              取消
            </button>
            <button type="button" className="btn sm primary" onClick={commitEdit}>
              完成
            </button>
          </div>
        </div>
      ) : (
        <>
          {item.body ? (
            <MarkdownText className="pset-rule-body" skills={Array.isArray(item.skills) ? item.skills : []}>
              {item.body}
            </MarkdownText>
          ) : null}
          {err ? <p className="pset-env-err">{err}</p> : null}
          <div className="pset-rule-meta">
            <span className={'pset-tag' + (item.enabled ? ' green' : '')}>
              {item.enabled ? '随 /next 下发' : '已停用'}
            </span>
          </div>
        </>
      )}
    </article>
  );
}

function RulesApplyPanel({ rules, projects, projectId, notify, onClose }) {
  const [q, setQ] = useState('');
  const [ruleIds, setRuleIds] = useState(() => new Set(rules.filter((r) => r.enabled).map((r) => r.id)));
  const [targetIds, setTargetIds] = useState(() => new Set());
  const [busy, setBusy] = useState(false);

  const others = useMemo(
    () => (Array.isArray(projects) ? projects : []).filter((p) => p.id !== projectId && !p.archived),
    [projects, projectId]
  );
  const hits = useMemo(() => matchProjects(others, q), [others, q]);
  const visibleIds = hits.map((row) => row.p.id);
  const allVisiblePicked = visibleIds.length > 0 && visibleIds.every((id) => targetIds.has(id));
  // 面板打开期间可能在下方删掉规则：提交与计数都按「当前仍存在的规则」求交集
  const pickedRules = rules.filter((r) => ruleIds.has(r.id));
  const allRulesPicked = pickedRules.length === rules.length;

  function toggleRule(id) {
    setRuleIds((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleTarget(id) {
    setTargetIds((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function submit() {
    if (busy || !pickedRules.length || !targetIds.size) return;
    setBusy(true);
    api
      .applyRules(projectId, pickedRules.map((r) => r.id), [...targetIds])
      .then((res) => {
        const count = (res.results || []).length;
        const tail = res.skipped ? '，跳过 ' + res.skipped + ' 条（已存在或超出上限）' : '';
        if (res.added) {
          notify('已应用到 ' + count + ' 个项目：共新增 ' + res.added + ' 条规则' + tail);
        } else {
          notify(count + ' 个项目没有新增' + tail);
        }
        onClose();
      })
      .catch((e) => {
        notify(e.message || '应用失败', 'warn');
        setBusy(false);
      });
  }

  return (
    <div className="pset-apply">
      <div className="pset-apply-head">
        <h3>应用到其他项目</h3>
        <button type="button" className="pset-linklike" onClick={onClose} disabled={busy}>
          收起
        </button>
      </div>
      <p className="pset-apply-hint">
        规则会追加到目标项目；标题与正文都相同的规则自动跳过，每个项目最多 30 条。
      </p>

      <div className="pset-apply-label">
        <span>规则</span>
        <span className="pset-apply-sub">
          {pickedRules.length}/{rules.length} 条已选
        </span>
        <button
          type="button"
          className="pset-linklike"
          disabled={busy}
          onClick={() => setRuleIds(allRulesPicked ? new Set() : new Set(rules.map((r) => r.id)))}
        >
          {allRulesPicked ? '清空' : '全选'}
        </button>
      </div>
      <div className="pset-apply-list">
        {rules.map((r) => (
          <label key={r.id} className={'pset-apply-item' + (r.enabled ? '' : ' off')}>
            <input
              type="checkbox"
              checked={ruleIds.has(r.id)}
              disabled={busy}
              onChange={() => toggleRule(r.id)}
            />
            <span className="pset-apply-name">{r.title || '无标题'}</span>
            {r.enabled ? null : <span className="pset-tag">已停用</span>}
          </label>
        ))}
      </div>

      <div className="pset-apply-label">
        <span>目标项目</span>
        <span className="pset-apply-sub">{targetIds.size} 个已选</span>
        {targetIds.size ? (
          <button type="button" className="pset-linklike" disabled={busy} onClick={() => setTargetIds(new Set())}>
            清空
          </button>
        ) : null}
        <button
          type="button"
          className="pset-linklike"
          disabled={busy || !visibleIds.length}
          onClick={() =>
            setTargetIds((cur) => {
              const next = new Set(cur);
              visibleIds.forEach((id) => (allVisiblePicked ? next.delete(id) : next.add(id)));
              return next;
            })
          }
        >
          {allVisiblePicked ? '取消全选' : '全选'}
        </button>
      </div>
      <div className="pset-picker">
        <div className="pset-picker-search">
          {IC.search}
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索项目"
            spellCheck={false}
            disabled={busy}
          />
        </div>
        <div className="pset-apply-list flat">
          {hits.map(({ p }) => (
            <label key={p.id} className="pset-apply-item">
              <input
                type="checkbox"
                checked={targetIds.has(p.id)}
                disabled={busy}
                onChange={() => toggleTarget(p.id)}
              />
              <ProjectIcon project={p} color={avatarColor(projects, p.id)} size={22} />
              <span className="pset-apply-main">
                <span className="pset-apply-name">{p.name}</span>
                <span className="pset-apply-path">{p.path}</span>
              </span>
            </label>
          ))}
          {!hits.length ? <p className="pset-pick-empty">没有匹配的项目</p> : null}
        </div>
      </div>

      <div className="pset-apply-foot">
        <span className="pset-apply-sum">
          {pickedRules.length} 条规则 → {targetIds.size} 个项目
        </span>
        <button type="button" className="btn sm" onClick={onClose} disabled={busy}>
          取消
        </button>
        <button
          type="button"
          className="btn sm primary"
          onClick={submit}
          disabled={busy || !pickedRules.length || !targetIds.size}
        >
          {busy ? '应用中…' : '应用'}
        </button>
      </div>
    </div>
  );
}

function RulesSection({ extras, projects, projectId, saveExtras, notify }) {
  const draft = useRef([]);
  const newRef = useRef(null);
  const [adding, setAdding] = useState(false);
  const [applying, setApplying] = useState(false);
  const [nt, setNt] = useState('');
  const [nb, setNb] = useState('');
  const [nerr, setNerr] = useState('');

  const rows = extras ? extras.rules : [];
  useEffect(() => {
    draft.current = rows;
  }, [rows]);

  useEffect(() => {
    if (adding && newRef.current) newRef.current.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [adding]);

  if (!extras) return <p className="pset-loading">加载中…</p>;

  const payload = (list) =>
    list.map((r) => ({ id: r.id, title: r.title, body: r.body, enabled: r.enabled }));
  function commit(next) {
    draft.current = next;
    return saveExtras({ rules: next });
  }

  function setRow(item, title, body) {
    return commit(payload(draft.current.map((x) => (x.id === item.id ? { ...x, title, body } : x))));
  }

  function toggle(item, enabled) {
    commit(payload(draft.current.map((x) => (x.id === item.id ? { ...x, enabled } : x)))).catch(() => {});
  }

  function add() {
    const t = nt.trim();
    const b = nb.trim();
    if (!t && !b) return setNerr('标题和内容至少填一项');
    if (t.length > 80) return setNerr('标题最多 80 字');
    if (b.length > 4000) return setNerr('内容最多 4000 字');
    setNerr('');
    commit([...payload(draft.current), { title: t, body: b, enabled: true }])
      .then(() => {
        setAdding(false);
        setNt('');
        setNb('');
      })
      .catch((e) => setNerr(e.message || '保存失败'));
  }

  return (
    <>
      <div className="pset-info">
        <span><b>{rows.length}</b> 条规则</span>
        <span className="pset-info-sep" />
        <span>启用 <b>{rows.filter((r) => r.enabled).length}</b> 条</span>
        {rows.length ? (
          <button type="button" className="pset-linklike" onClick={() => setApplying((v) => !v)}>
            {applying ? '收起应用面板' : '应用到其他项目'}
          </button>
        ) : null}
      </div>

      {applying ? (
        <RulesApplyPanel
          rules={rows}
          projects={projects}
          projectId={projectId}
          notify={notify}
          onClose={() => setApplying(false)}
        />
      ) : null}

      {rows.map((item, i) => (
        <RuleRow
          key={item.id}
          item={item}
          no={i + 1}
          projects={projects}
          projectId={projectId}
          onSave={(title, body) => setRow(item, title, body)}
          onToggle={(enabled) => toggle(item, enabled)}
          onRemove={() => commit(payload(draft.current.filter((x) => x.id !== item.id))).catch(() => {})}
        />
      ))}

      {adding ? (
        <div className="pset-rule pset-rule-new" ref={newRef}>
          <div className="pset-rule-head">
            <span className="pset-rule-no">{String(rows.length + 1).padStart(2, '0')}</span>
            <input
              className="pset-rule-title"
              value={nt}
              onChange={(e) => setNt(e.target.value)}
              placeholder="规则标题"
              spellCheck={false}
              autoFocus
              aria-label="新规则标题"
            />
          </div>
          <ProjectRefInput
            value={nb}
            onChange={setNb}
            projects={projects}
            currentProjectId={projectId}
            rows={3}
            className="pset-md-input"
            placeholder="支持 Markdown；输入 / 插入技能"
            skillsOnly
          />
          {nerr ? <p className="pset-env-err">{nerr}</p> : null}
          <div className="pset-rule-actions">
            <button type="button" className="btn sm" onClick={() => { setAdding(false); setNerr(''); }}>
              取消
            </button>
            <button type="button" className="btn sm primary" onClick={add}>
              添加
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="pset-add" onClick={() => setAdding(true)}>
          <span className="pset-add-plus">{IC.plusSmall || IC.plus}</span>
          新增规则
        </button>
      )}
    </>
  );
}

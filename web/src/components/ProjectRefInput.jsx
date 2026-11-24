import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import {
  activeRefQuery,
  applyRef,
  applyReqRef,
  applyFileRef,
  refCandidates,
  reqCandidates,
  fileCandidates,
  classifyRefQuery
} from '../lib/req-refs.js';
import { activeSkillQuery, applySkill, loadSkills, skillCandidates } from '../lib/skill-refs.js';

/**
 * 需求正文输入框：在 textarea 上叠一层候选面板，支持两种触发：
 * - `@` 选引用 → 项目写成 `@{项目名}`、本项目需求写成 `@{#序号}`、本项目文件或目录写成 `@{file:路径}`
 * - `/` 选技能 → 写成 `{UseSkill:source/名字}`
 *
 * `@` 弹层按「项目 / 需求 / 文件目录」分组：直接打字三组都筛，`#` 开头只列需求、`file:` 开头只列文件与目录。
 * 需求与文件清单按当前项目懒加载一次（进程内缓存），不随每次按键重取。
 *
 * 为什么不用 contenteditable：正文是 markdown，用户要的仍是能自由换行、粘贴、
 * 原生撤销的纯文本输入；候选只负责在光标处替换那一段输入，别的键一律透传。
 * Enter 只在候选打开时用于选中，其余时候仍是换行 —— 这是输入正文最常用的键，不能抢。
 */

/** 需求 / 文件清单按项目缓存：同一项目里多个输入框（新建 / 编辑 / 回复）共用一份，不重复打主进程 */
const dataCache = new Map();

function loadProjectData(projectId) {
  if (!projectId) return Promise.resolve({ reqs: [], files: [] });
  if (dataCache.has(projectId)) return dataCache.get(projectId);
  const p = Promise.all([
    api.requirements(projectId).then((d) => (d && Array.isArray(d.requirements) ? d.requirements : [])).catch(() => []),
    api.projectFiles(projectId).then((d) => (d && Array.isArray(d.files) ? d.files : [])).catch(() => [])
  ]).then(([reqs, files]) => ({ reqs, files }));
  dataCache.set(projectId, p);
  return p;
}

/** 统一候选项：{ type:'project'|'req'|'file'|'skill', key, data }，键盘导航在扁平列表上走 */
function wrap(type, data, key) {
  return { type, key, data };
}

export default function ProjectRefInput({
  value,
  onChange,
  projects,
  currentProjectId,
  currentSeq,
  rows = 4,
  placeholder,
  className,
  autoFocus,
  disabled,
  skillsOnly = false
}) {
  const areaRef = useRef(null);
  /** { kind:'ref'|'skill', start, caret, query, mode, items, index }；null = 不显示候选 */
  const [sug, setSug] = useState(null);
  /** 本机技能清单：进程内只取一次（两个弹窗共用同一份） */
  const [skills, setSkills] = useState([]);
  /** 当前项目的需求 / 文件清单：@ 候选用，按项目懒加载 */
  const [projData, setProjData] = useState({ reqs: [], files: [], ready: false });
  /** 插入引用后要把光标放到 `}` 后面：值更新完再设，只能在渲染后做 */
  const pendingCaret = useRef(null);

  useEffect(() => {
    let live = true;
    loadSkills().then((list) => {
      if (live) setSkills(list);
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (skillsOnly) return undefined;
    let live = true;
    setProjData({ reqs: [], files: [], ready: false });
    loadProjectData(currentProjectId).then((d) => {
      if (live) setProjData({ reqs: d.reqs, files: d.files, ready: true });
    });
    return () => {
      live = false;
    };
  }, [currentProjectId, skillsOnly]);

  useEffect(() => {
    const pos = pendingCaret.current;
    if (pos === null || !areaRef.current) return;
    pendingCaret.current = null;
    const el = areaRef.current;
    el.focus();
    el.setSelectionRange(pos, pos);
  });

  function refItems(query) {
    const { mode, q } = classifyRefQuery(query);
    const items = [];
    // 统一模式下每组少给几条，避免三组各 8 条把弹层撑得过长；打了类型前缀则只列那一组、给满 8 条
    const per = mode === 'all' ? 5 : 8;
    if (mode === 'all') {
      for (const p of refCandidates(projects, q, currentProjectId).slice(0, per)) items.push(wrap('project', p, 'p:' + p.id));
    }
    if (mode === 'all' || mode === 'req') {
      for (const r of reqCandidates(projData.reqs, q, currentSeq).slice(0, per)) items.push(wrap('req', r, 'r:' + r.seq));
    }
    if (mode === 'all' || mode === 'file') {
      for (const f of fileCandidates(projData.files, q).slice(0, per)) items.push(wrap('file', f, 'f:' + f.path));
    }
    return { mode, items };
  }

  function sync(text, caret) {
    // 规则正文只认技能：@ 项目 / 需求 / 文件引用在规则里没有服务端解析，插进去只会变成字面量
    if (!skillsOnly) {
      const ref = activeRefQuery(text, caret);
      if (ref) {
        const { mode, items } = refItems(ref.query);
        setSug({ kind: 'ref', start: ref.start, caret, query: ref.query, mode, items, index: 0 });
        return;
      }
    }

    const sk = activeSkillQuery(text, caret);
    if (sk) {
      const items = skillCandidates(skills, sk.query).map((s) => wrap('skill', s, 's:' + s.id));
      // 技能候选为空时不弹面板：路径输入、没有匹配技能都不该在正文上挂一个空框
      setSug(items.length ? { kind: 'skill', start: sk.start, caret, query: sk.query, mode: 'skill', items, index: 0 } : null);
      return;
    }

    setSug(null);
  }

  function handleChange(e) {
    const text = e.target.value;
    onChange(text);
    sync(text, e.target.selectionStart);
  }

  function pick(item) {
    if (!sug || !item) return;
    let res;
    if (item.type === 'skill') res = applySkill(value, sug.start, sug.caret, item.data.id);
    else if (item.type === 'project') res = applyRef(value, sug.start, sug.caret, item.data.name);
    else if (item.type === 'req') res = applyReqRef(value, sug.start, sug.caret, item.data.seq);
    else res = applyFileRef(value, sug.start, sug.caret, item.data.path);
    pendingCaret.current = res.caret;
    onChange(res.text);
    setSug(null);
  }

  function handleKeyDown(e) {
    if (!sug || !sug.items.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSug({ ...sug, index: (sug.index + 1) % sug.items.length });
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSug({ ...sug, index: (sug.index - 1 + sug.items.length) % sug.items.length });
      return;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      pick(sug.items[sug.index]);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setSug(null);
    }
  }

  const isSkill = !!sug && sug.kind === 'skill';
  const GROUP_LABEL = { project: '项目', req: '本项目需求', file: '本项目文件 / 目录', skill: '技能' };

  function renderRow(item, i) {
    const on = i === sug.index;
    const common = {
      type: 'button',
      role: 'option',
      ariaSelected: on,
      className: 'refsug-row' + (on ? ' on' : ''),
      // mousedown 抢在 blur 之前：否则点下去先失焦、面板消失，点了个空
      onMouseDown: (e) => {
        e.preventDefault();
        pick(item);
      },
      onMouseEnter: () => setSug({ ...sug, index: i })
    };
    if (item.type === 'skill') {
      const s = item.data;
      return (
        <button {...common} key={item.key} title={[s.dir, s.description].filter(Boolean).join('\n')}>
          <span className="refsug-name">{s.id}</span>
          {s.scope === 'project' ? <span className="refsug-tag">本项目</span> : null}
          {s.exists === false ? <span className="refsug-tag">目录已不在</span> : null}
          <span className="refsug-path">{s.description}</span>
        </button>
      );
    }
    if (item.type === 'project') {
      const p = item.data;
      return (
        <button {...common} key={item.key} title={p.path}>
          <span className="refsug-name">{p.name}</span>
          {p.archived ? <span className="refsug-tag">已归档</span> : null}
          <span className="refsug-path">{p.path}</span>
        </button>
      );
    }
    if (item.type === 'req') {
      const r = item.data;
      return (
        <button {...common} key={item.key} title={'#' + r.seq + ' ' + (r.title || '')}>
          <span className="refsug-name">#{r.seq} · {r.title}</span>
          <span className="refsug-path">{r.status}</span>
        </button>
      );
    }
    const f = item.data;
    const base = f.path.split('/').filter(Boolean).pop();
    return (
      <button {...common} key={item.key} title={f.path}>
        <span className="refsug-name">{base}</span>
        {f.directory ? <span className="refsug-tag">目录</span> : null}
        <span className="refsug-path">{f.path}</span>
      </button>
    );
  }

  return (
    <div className="refinput">
      <textarea
        ref={areaRef}
        className={className}
        rows={rows}
        value={value}
        autoFocus={autoFocus}
        disabled={disabled}
        spellCheck={false}
        placeholder={placeholder}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={() => setSug(null)}
      />
      {sug ? (
        <div className="refsug" role="listbox" aria-label={isSkill ? '技能候选' : '引用候选'}>
          <div className="refsug-hd">
            {isSkill ? '使用技能' : '引用'}
            <span className="refsug-q">
              {isSkill
                ? sug.query
                  ? '/' + sug.query
                  : '全部技能'
                : sug.query
                  ? '@' + sug.query
                  : '项目 / 需求 / 文件目录'}
            </span>
          </div>
          {sug.items.length ? (
            <>
              {sug.items.map((item, i) => {
                const prev = sug.items[i - 1];
                const header = !prev || prev.type !== item.type;
                return (
                  <div key={item.key}>
                    {header ? <div className="refsug-group">{GROUP_LABEL[item.type]}</div> : null}
                    {renderRow(item, i)}
                  </div>
                );
              })}
              <div className="refsug-hint">
                {isSkill ? '↑↓ 选择 · Enter 插入 · Esc 关闭' : '↑↓ 选择 · Enter 插入 · # 选需求 · file: 选文件 / 目录 · Esc 关闭'}
              </div>
            </>
          ) : isSkill ? null : (
            <div className="refsug-hint">
              {projData.ready ? '没有匹配的引用，换个名字 / 序号 / 路径，或先建项目' : '正在加载需求与文件候选…'}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

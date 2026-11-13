'use strict';

/**
 * 全局搜索：项目 / 需求 / 运行日志 / git 提交。
 * 面板一次请求四组结果，项目与需求走内存，提交与日志按项目/命令串行扫描。
 * 提交与日志成本高，各自带 60s 缓存与单轮 1500ms 预算，超时返回 partial 让界面如实提示。
 */

const store = require('../store');
const runner = require('../runner');
const git = require('../git');
const { stripAnsi } = require('../ansi');
const py = require('./pinyin');

const LIMIT_DEFAULT = 5;
const LIMIT_MAX = 10;
const COMMIT_WINDOW = 30;
const LOG_RUNS = 3;
const LOG_PER_COMMAND = 2;
const COMMIT_CACHE_MS = 60 * 1000;
const SCAN_BUDGET_MS = 1500;
const LOG_CACHE_MAX = 60;

/** projectId -> { at, commits }：连续输入时只付一次 git 查询成本 */
const commitCache = new Map();
/** runId -> 已剥离 ANSI 的行（只缓存已结束的运行，避免实时运行读到旧内容） */
const logCache = new Map();

function lower(v) {
  return String(v == null ? '' : v).toLowerCase();
}

/** 截取命中附近的片段：返回文本与命中偏移，前端据此高亮 */
function snippet(text, q, radius) {
  const r = radius || 44;
  const raw = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  if (!raw) return { text: '', at: -1 };
  const at = lower(raw).indexOf(q);
  if (at < 0) {
    return { text: raw.length > r * 2 ? raw.slice(0, r * 2) + '…' : raw, at: -1 };
  }
  const start = Math.max(0, at - r);
  const end = Math.min(raw.length, at + q.length + r);
  const prefix = start > 0 ? '…' : '';
  return {
    text: prefix + raw.slice(start, end) + (end < raw.length ? '…' : ''),
    at: at - start + prefix.length
  };
}

function activeProjects() {
  return store.get().projects.filter((p) => !p.archived);
}

function searchProjects(list, q, limit) {
  const items = [];
  for (const p of list) {
    const name = String(p.name || '');
    // 名称支持拼音（xiangmu / xmgl 都能找到「项目管理」）：名字类内容用户常常只记得读音
    if (py.matches(name, q)) {
      items.push({ projectId: p.id, name, path: p.path });
    }
  }
  // 名称从头命中排前面，其余按名称；数量不多，排序成本可忽略
  items.sort((a, b) => {
    const as = lower(a.name).startsWith(q) ? 0 : 1;
    const bs = lower(b.name).startsWith(q) ? 0 : 1;
    return as - bs || a.name.localeCompare(b.name, 'zh-CN');
  });
  return { items: items.slice(0, limit), more: items.length > limit };
}

function searchRequirements(activeIds, names, q, limit) {
  const items = [];
  for (const r of store.get().requirements) {
    if (!activeIds.has(r.projectId)) continue;
    const title = String(r.title || '');
    const body = String(r.body || '');
    const note = String(r.note || '');
    const seqHit = '#' + r.seq;
    let field = '';
    let source = '';
    // 标题与备注支持拼音；正文整篇转拼音的代价随字数线性增长（每条需求都要跑一遍），
    // 且长文里拼音散命中会把无关需求带进来，所以正文仍只做子串匹配。
    if (py.matches(title, q)) {
      field = 'title';
      source = title;
    } else if (lower(body).includes(q)) {
      field = 'body';
      source = body;
    } else if (py.matches(note, q)) {
      field = 'note';
      source = note;
    } else if (lower(seqHit).includes(q)) {
      field = 'seq';
      source = seqHit;
    }
    if (!field) continue;
    items.push({
      id: r.id,
      projectId: r.projectId,
      projectName: names.get(r.projectId) || '',
      seq: r.seq,
      title,
      status: r.status,
      updatedAt: r.updatedAt || r.createdAt || '',
      matchedField: field,
      snippet: snippet(source, q)
    });
  }
  items.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  return { items: items.slice(0, limit), more: items.length > limit };
}

/** 单项目提交：优先缓存；非仓库 / git 不可用都按空列表处理，不中断其它项目 */
async function commitsOf(p) {
  const hit = commitCache.get(p.id);
  if (hit && Date.now() - hit.at < COMMIT_CACHE_MS) return hit.commits;
  let commits = [];
  try {
    const res = await git.commits(p.path, { limit: COMMIT_WINDOW, numstat: false });
    commits = res.commits || [];
  } catch (_) {
    // 无 git / 非仓库 / 仓库损坏：该项目不贡献结果
    commits = [];
  }
  commitCache.set(p.id, { at: Date.now(), commits });
  return commits;
}

async function searchCommits(list, names, q, limit, deadline) {
  const items = [];
  let partial = false;
  for (const p of list) {
    if (Date.now() > deadline) {
      partial = true;
      break;
    }
    const commits = await commitsOf(p);
    for (const c of commits) {
      const subject = String(c.subject || '');
      const author = String(c.author || '');
      const shortSha = String(c.shortSha || '');
      const sha = String(c.sha || '');
      // 提交标题与作者支持拼音（「dengluye」找「登录页修复」）；sha 只按字面匹配，十六进制没有读音
      const byText = [subject, author].find((v) => py.matches(v, q));
      const matched = byText || [shortSha, sha].find((v) => lower(v).includes(q));
      if (!matched) continue;
      items.push({
        projectId: p.id,
        projectName: names.get(p.id) || '',
        sha,
        shortSha,
        subject,
        author,
        committedAt: c.committedAt || '',
        snippet: snippet(matched, q)
      });
    }
  }
  items.sort((a, b) => String(b.committedAt).localeCompare(String(a.committedAt)));
  return { items: items.slice(0, limit), more: items.length > limit, partial };
}

/** 读取一次运行的可见文本：已结束的运行缓存起来；实时运行每次都读，避免展示旧日志 */
function cleanLines(command, run) {
  const cached = logCache.get(run.id);
  if (cached) return cached;
  const data = runner.readLog(command, run.id);
  if (!data) return [];
  const lines = data.lines.map((l) => ({ text: stripAnsi(l.text), level: l.level }));
  const live = run.status === 'running' || (run.status === 'detached' && runner.isAlivePid(run.hostPid));
  if (!live) {
    if (logCache.size >= LOG_CACHE_MAX) logCache.delete(logCache.keys().next().value);
    logCache.set(run.id, lines);
  }
  return lines;
}

function searchLogs(activeIds, names, q, limit, deadline) {
  const items = [];
  let partial = false;
  const commands = store.get().commands.filter((c) => activeIds.has(c.projectId));
  for (const c of commands) {
    if (Date.now() > deadline) {
      partial = true;
      break;
    }
    const runs = (c.runs || []).slice(-LOG_RUNS).reverse();
    let picked = 0;
    for (const run of runs) {
      if (picked >= LOG_PER_COMMAND) break;
      if (Date.now() > deadline) {
        partial = true;
        break;
      }
      const lines = cleanLines(c, run);
      for (let i = 0; i < lines.length; i += 1) {
        if (!lower(lines[i].text).includes(q)) continue;
        items.push({
          projectId: c.projectId,
          projectName: names.get(c.projectId) || '',
          commandId: c.id,
          commandName: c.name || '',
          commandText: c.text,
          runId: run.id,
          runStartedAt: run.startedAt,
          level: lines[i].level || 'info',
          line: i,
          snippet: snippet(lines[i].text, q)
        });
        picked += 1;
        if (picked >= LOG_PER_COMMAND) break;
      }
    }
  }
  items.sort((a, b) => String(b.runStartedAt).localeCompare(String(a.runStartedAt)));
  return { items: items.slice(0, limit), more: items.length > limit, partial };
}

function clampLimit(v) {
  const n = parseInt(v, 10) || LIMIT_DEFAULT;
  return Math.min(Math.max(n, 1), LIMIT_MAX);
}

function empty(q) {
  return {
    q,
    projects: [],
    requirements: [],
    commits: [],
    logs: [],
    more: { projects: false, requirements: false, commits: false, logs: false },
    partial: { commits: false, logs: false }
  };
}

function createSearch() {
  return {
    /**
     * 统一搜索入口。
     * @param {{q?: string, limit?: number}} params  q 为空返回空组；limit 每组上限（默认 5，最大 10）
     */
    globalSearch: async ({ q, limit }) => {
      const raw = String(q == null ? '' : q).trim().slice(0, 100);
      if (!raw) return empty('');
      const query = lower(raw);
      const lim = clampLimit(limit);

      const projects = activeProjects();
      const activeIds = new Set(projects.map((p) => p.id));
      const names = new Map(projects.map((p) => [p.id, p.name]));

      const deadline = Date.now() + SCAN_BUDGET_MS;
      const projectHits = searchProjects(projects, query, lim);
      const [reqs, commits, logs] = await Promise.all([
        Promise.resolve(searchRequirements(activeIds, names, query, lim)),
        searchCommits(projects, names, query, lim, deadline),
        Promise.resolve(searchLogs(activeIds, names, query, lim, deadline))
      ]);

      return {
        q: raw,
        projects: projectHits.items,
        requirements: reqs.items,
        commits: commits.items,
        logs: logs.items,
        more: {
          projects: projectHits.more,
          requirements: reqs.more,
          commits: commits.more,
          logs: logs.more
        },
        partial: { commits: commits.partial, logs: logs.partial }
      };
    }
  };
}

module.exports = { createSearch };

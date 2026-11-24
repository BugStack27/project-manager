'use strict';

const fs = require('fs');
const path = require('path');
const store = require('../store');
const runner = require('../runner');
const projectIcons = require('../project-icon');
const eventLog = require('../event-log');
const { actor } = eventLog;
const { fail } = require('./errors');
const { nowIso } = require('./dates');
const { samePath, rebaseCwd } = require('./paths');
const { findProject } = require('./lookups');
const { projectView, projectExtras } = require('./views');
const { detectKind } = require('../project-detect');
const { bump: notifyTaskAvailable } = require('./next-waiter');

const EXTRA_CAPS = { links: 20, env: 50, rules: 30 };
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** 条目 id 沿用客户端已有的，新增条目由服务端分配；界面 key 不会因每次保存而重排 */
function keepExtraId(raw, prefix) {
  const id = String(raw || '').trim();
  return id || store.uid(prefix);
}

function normalizeLinks(raw, projectId) {
  const projects = store.get().projects;
  const out = [];
  const seen = new Set();
  (Array.isArray(raw) ? raw : []).forEach((item) => {
    const targetId = String((item && item.projectId) || '').trim();
    if (!targetId) return;
    if (targetId === projectId) fail('不能关联项目自身', 'bad_extras', 400);
    if (seen.has(targetId)) return;
    if (!projects.some((x) => x.id === targetId)) fail('关联的项目不存在', 'project_missing', 400);
    seen.add(targetId);
    out.push({
      id: keepExtraId(item.id, 'pl'),
      projectId: targetId,
      note: String((item && item.note) || '').trim().slice(0, 300)
    });
  });
  return out.slice(0, EXTRA_CAPS.links);
}

function normalizeEnv(raw) {
  const out = [];
  const seen = new Set();
  (Array.isArray(raw) ? raw : []).forEach((item) => {
    const key = String((item && item.key) || '').trim();
    if (!key) return;
    if (!ENV_KEY_RE.test(key)) fail('环境变量名不合法：' + key, 'bad_env', 400);
    // Windows 环境变量名不区分大小写，同名视为重复
    const low = key.toLowerCase();
    if (seen.has(low)) fail('环境变量名重复：' + key, 'duplicate_env', 409);
    seen.add(low);
    out.push({
      id: keepExtraId(item.id, 'pe'),
      key: key.slice(0, 64),
      value: String(item && item.value != null ? item.value : '').trim().slice(0, 1000)
    });
  });
  return out.slice(0, EXTRA_CAPS.env);
}

function normalizeRules(raw) {
  const out = [];
  (Array.isArray(raw) ? raw : []).forEach((item) => {
    const title = String((item && item.title) || '').trim().slice(0, 80);
    const text = String((item && item.body) || '').trim().slice(0, 4000);
    if (!title && !text) return;
    out.push({
      id: keepExtraId(item && item.id, 'pr'),
      title,
      body: text,
      enabled: !(item && item.enabled === false)
    });
  });
  return out.slice(0, EXTRA_CAPS.rules);
}

function createProjects() {
  return {
    projects: (params) => {
      const includeArchived = !!(params && params.includeArchived);
      const list = store
        .get()
        .projects.filter((p) => includeArchived || !p.archived)
        .map(projectView);
      return { projects: list };
    },

    project: ({ id }) => {
      const p = findProject(id);
      return { project: projectView(p), extras: projectExtras(p) };
    },

    /** 项目真实图标按需取：dataURL 体积远大于普通字段，不跟着项目列表轮询下发 */
    projectIcon: ({ id }) => {
      const p = findProject(id);
      const found = projectIcons.get(p.path, detectKind(p.path));
      return { icon: found ? found.icon : null, mono: found ? found.mono : null };
    },

    createProject: ({ name, path: projectPath, aiScout, autoPull }) => {
      const nm = String(name || '').trim();
      const pth = String(projectPath || '').trim();
      if (!nm) fail('项目名不能为空');
      if (!pth) fail('本地路径不能为空');

      const db = store.get();
      const dup = db.projects.find((p) => !p.archived && p.name.toLowerCase() === nm.toLowerCase());
      if (dup) fail('项目名「' + nm + '」已存在', 'duplicate_name', 409);

      const dupPath = db.projects.find((p) => !p.archived && samePath(p.path, pth));
      if (dupPath) fail('该文件夹已登记为项目「' + dupPath.name + '」', 'duplicate_path', 409);

      const project = {
        id: store.uid('p'),
        name: nm,
        path: pth,
        archived: false,
        aiScout: aiScout !== false,
        /** 启动时自动拉取：true / false 为项目自定义，null 表示跟随全局设置 */
        autoPull: typeof autoPull === 'boolean' ? autoPull : null,
        createdAt: nowIso(),
        updatedAt: nowIso()
      };
      db.projects.push(project);
      store.save();
      notifyTaskAvailable();
      eventLog.append({
        type: 'project.created',
        projectId: project.id,
        actor: actor.user(),
        data: { projectName: project.name, name: project.name, path: project.path }
      });
      return { project: projectView(project) };
    },

    updateProject: ({ id, patch }) => {
      const p = findProject(id);
      const body = patch || {};
      const before = {
        name: p.name,
        path: p.path,
        aiScout: p.aiScout !== false,
        autoPull: p.autoPull === undefined ? null : p.autoPull,
        archived: !!p.archived
      };
      /** 本次跟着改目录的命令条数，回给界面做提示 */
      let syncedCommands = 0;

      if (body.name !== undefined) {
        const nm = String(body.name).trim();
        if (!nm) fail('项目名不能为空');
        const dup = store
          .get()
          .projects.find((x) => x.id !== p.id && !x.archived && x.name.toLowerCase() === nm.toLowerCase());
        if (dup) fail('项目名「' + nm + '」已存在', 'duplicate_name', 409);
        p.name = nm;
      }
      if (body.path !== undefined) {
        const pth = String(body.path).trim();
        if (!pth) fail('本地路径不能为空');
        // 目录换了就把挂在上面的工作目录一起搬：命令的 cwd 是创建时固化的旧路径，
        // 不同步的话旧目录还在就静默跑旧代码，旧目录删了就启动失败。
        // 只动本项目的命令（两个项目共用同一个父目录是合法配置）；正在运行的也不拦，
        // 进程已经在旧目录里跑着了，改的只是登记值，下次启动才生效。
        if (!samePath(p.path, pth)) {
          const from = p.path;
          store.get().commands.forEach((c) => {
            if (c.projectId !== p.id) return;
            const next = rebaseCwd(c.cwd, from, pth);
            if (!next || next === c.cwd) return;
            c.cwd = next;
            c.updatedAt = nowIso();
            syncedCommands += 1;
          });
        }
        p.path = pth;
      }
      if (body.aiScout !== undefined) p.aiScout = !!body.aiScout;
      // null 是有效值（清除项目自定义、回到跟随全局），所以不能用 !!body.autoPull
      if (body.autoPull !== undefined) {
        p.autoPull = body.autoPull === null ? null : !!body.autoPull;
      }
      if (body.archived !== undefined) {
        p.archived = !!body.archived;
        if (p.archived) {
          const running = store.get().commands.filter((c) => c.projectId === p.id && runner.isActive(c));
          if (running.length) fail('该项目有 ' + running.length + ' 条命令正在运行，先停止再归档', 'project_running', 409);
        }
      }
      if (body.extras !== undefined) {
        // 先全部校验再落库：任何一条非法都不应留下半改的项目
        const ex = body.extras || {};
        const next = {};
        if (ex.links !== undefined) next.links = normalizeLinks(ex.links, p.id);
        if (ex.env !== undefined) next.env = normalizeEnv(ex.env);
        if (ex.rules !== undefined) next.rules = normalizeRules(ex.rules);
        if (!p.extras) p.extras = { links: [], env: [], rules: [] };
        Object.assign(p.extras, next);
      }
      p.updatedAt = nowIso();
      store.save();
      notifyTaskAvailable();
      const changes = [];
      if (before.name !== p.name) changes.push('name');
      if (before.path !== p.path) changes.push('path');
      if (before.aiScout !== (p.aiScout !== false)) changes.push('aiScout');
      if (before.autoPull !== (p.autoPull === undefined ? null : p.autoPull)) changes.push('autoPull');
      if (body.extras && body.extras.links !== undefined) changes.push('links');
      if (body.extras && body.extras.env !== undefined) changes.push('env');
      if (body.extras && body.extras.rules !== undefined) changes.push('rules');
      eventLog.append({
        type: 'project.updated',
        projectId: p.id,
        actor: actor.user(),
        data: { projectName: p.name, name: p.name, changes, syncedCommands }
      });
      if (before.archived !== !!p.archived) {
        eventLog.append({
          type: p.archived ? 'project.archived' : 'project.restored',
          projectId: p.id,
          actor: actor.user(),
          data: { projectName: p.name, name: p.name }
        });
      }
      return { project: projectView(p), syncedCommands, extras: projectExtras(p) };
    },

    /**
     * 侧栏拖拽排序：ids 是「未归档项目」的完整新顺序。
     * 排列本身不算项目内容变更——不动 updatedAt，也不写审计日志；
     * 归档项目保持它们在数组中的原位，已归档分组的顺序不受影响。
     */
    reorderProjects: ({ ids }) => {
      if (!Array.isArray(ids)) fail('排序参数不合法', 'bad_order', 400);
      const db = store.get();
      const active = db.projects.filter((p) => !p.archived);
      const byId = new Map(active.map((p) => [p.id, p]));
      const seen = new Set();
      const ordered = [];
      for (const id of ids) {
        const p = byId.get(id);
        if (!p || seen.has(id)) fail('项目列表已变化，请重试', 'order_conflict', 409);
        seen.add(id);
        ordered.push(p);
      }
      // 数量对不上说明期间有项目被新建 / 归档：拒绝这次排序，界面刷新后重试即可
      if (ordered.length !== active.length) fail('项目列表已变化，请重试', 'order_conflict', 409);

      let i = 0;
      db.projects = db.projects.map((p) => (p.archived ? p : ordered[i++]));
      store.save();
      return { projects: ordered.map(projectView) };
    },

    archiveProject: ({ id }) => {
      const p = findProject(id);
      const running = store.get().commands.filter((c) => c.projectId === p.id && runner.isActive(c));
      if (running.length) fail('该项目有 ' + running.length + ' 条命令正在运行，先停止再归档', 'project_running', 409);
      p.archived = true;
      p.updatedAt = nowIso();
      store.save();
      notifyTaskAvailable();
      eventLog.append({
        type: 'project.archived',
        projectId: p.id,
        actor: actor.user(),
        data: { projectName: p.name, name: p.name }
      });
      return { project: projectView(p) };
    },

    /**
     * 彻底移除项目登记：删掉 db.json 里该项目及其需求、命令，并清理 data/runs 下这些命令的运行日志。
     * 不动项目代码目录（p.path 指向的文件夹原样保留）。
     * 只允许删已归档的项目：未归档的先归档，留一道缓冲，避免列表里误点就没了。
     */
    deleteProject: ({ id }) => {
      const p = findProject(id);
      if (!p.archived) fail('未归档的项目不能删除，请先归档', 'project_not_archived', 409);

      const db = store.get();
      const cmds = db.commands.filter((c) => c.projectId === p.id);
      const running = cmds.filter((c) => runner.isActive(c));
      if (running.length) fail('该项目有 ' + running.length + ' 条命令正在运行，先停止再删除', 'project_running', 409);

      const reqs = db.requirements.filter((r) => r.projectId === p.id);
      const logFiles = [];
      cmds.forEach((c) => {
        (c.runs || []).forEach((r) => {
          if (r.logFile) logFiles.push(String(r.logFile));
        });
      });

      db.projects = db.projects.filter((x) => x.id !== p.id);
      db.requirements = db.requirements.filter((r) => r.projectId !== p.id);
      db.commands = db.commands.filter((c) => c.projectId !== p.id);
      store.save();
      notifyTaskAvailable();

      // 日志文件在 data/runs 下，是应用自己的数据而非项目代码：顺手清掉，免得留一堆孤儿文件。
      // 只取 basename，避免 db 里的相对路径被拼出目录外；删不掉（已被手动清理）时忽略，不影响删除结果。
      let removedRuns = 0;
      logFiles.forEach((rel) => {
        const name = path.basename(rel);
        if (!name || name === '.' || name === '..') return;
        try {
          fs.unlinkSync(path.join(store.RUNS_DIR, name));
          removedRuns += 1;
        } catch (e) {
          /* 文件不存在或占用：忽略 */
        }
        // 宿主进程留下的运行状态文件（<logId>.state.json）一并清掉
        try {
          fs.unlinkSync(path.join(store.RUNS_DIR, name.replace(/\.log$/, '.state.json')));
        } catch (e) {
          /* 文件不存在：忽略 */
        }
      });

      eventLog.append({
        type: 'project.deleted',
        projectId: p.id,
        actor: actor.user(),
        data: {
          projectName: p.name,
          name: p.name,
          path: p.path,
          removed: { requirements: reqs.length, commands: cmds.length, runs: removedRuns }
        }
      });

      return {
        ok: true,
        id: p.id,
        name: p.name,
        removed: { requirements: reqs.length, commands: cmds.length, runs: removedRuns }
      };
    }
  };
}

module.exports = { createProjects };

'use strict';

const store = require('../store');
const runner = require('../runner');
const eventLog = require('../event-log');
const projectDetect = require('../project-detect');
const { actor } = eventLog;
const { fail } = require('./errors');
const { nowIso } = require('./dates');
const { findProject, findCommand } = require('./lookups');
const { cmdView, runView } = require('./views');

function snapshot(c) {
  const p = findProject(c.projectId);
  return { projectName: p.name, name: c.name || '', text: c.text };
}

function createCommands() {
  return {
    commands: ({ id }) => {
      const p = findProject(id);
      const list = store
        .get()
        .commands.filter((c) => c.projectId === p.id)
        .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
        .map(cmdView);
      return { commands: list };
    },

    /**
     * 新增命令时的推荐：按项目根目录的特征文件识别项目类型，并给出该类型下常见命令。
     * 已添加过的同名命令不再推荐，避免表单里出现一堆点不动的重复项。
     */
    commandSuggestions: ({ id }) => {
      const p = findProject(id);
      const existing = new Set(
        store
          .get()
          .commands.filter((c) => c.projectId === p.id)
          .map((c) => c.text)
      );
      const { types, suggestions } = projectDetect.detect(p.path);
      return {
        projectPath: p.path,
        types,
        suggestions: suggestions.filter((s) => !existing.has(s.text))
      };
    },

    createCommand: ({ id, data }) => {
      const p = findProject(id);
      const body = data || {};
      const text = String(body.text || '').trim();
      if (!text) fail('命令不能为空');
      const cwd = String(body.cwd || '').trim() || p.path;

      const command = {
        id: store.uid('c'),
        projectId: p.id,
        name: String(body.name || '').trim(),
        text,
        cwd,
        noProjectEnv: body.noProjectEnv === true,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        runs: []
      };
      store.get().commands.push(command);
      store.save();
      eventLog.append({
        type: 'command.created',
        projectId: p.id,
        commandId: command.id,
        actor: actor.user(),
        data: { ...snapshot(command), cwd: command.cwd }
      });
      return { command: cmdView(command) };
    },

    updateCommand: ({ cid, patch }) => {
      const c = findCommand(cid);
      if (runner.isActive(c)) fail('命令正在运行，先停止再编辑', 'command_running', 409);
      const body = patch || {};
      const before = { text: c.text, cwd: c.cwd, name: c.name || '', noProjectEnv: !!c.noProjectEnv };

      if (body.text !== undefined) {
        const text = String(body.text).trim();
        if (!text) fail('命令不能为空');
        c.text = text;
      }
      if (body.cwd !== undefined) {
        const cwd = String(body.cwd).trim();
        const proj = store.get().projects.find((p) => p.id === c.projectId);
        c.cwd = cwd || (proj ? proj.path : c.cwd);
      }
      if (body.name !== undefined) c.name = String(body.name).trim();
      if (body.noProjectEnv !== undefined) c.noProjectEnv = !!body.noProjectEnv;
      c.updatedAt = nowIso();
      store.save();
      const fields = [];
      if (before.text !== c.text) fields.push('text');
      if (before.cwd !== c.cwd) fields.push('cwd');
      if (before.name !== (c.name || '')) fields.push('name');
      if (before.noProjectEnv !== !!c.noProjectEnv) fields.push('noProjectEnv');
      eventLog.append({
        type: 'command.updated',
        projectId: c.projectId,
        commandId: c.id,
        actor: actor.user(),
        data: { ...snapshot(c), fields }
      });
      return { command: cmdView(c) };
    },

    deleteCommand: ({ cid }) => {
      const c = findCommand(cid);
      if (runner.isActive(c)) fail('命令正在运行，先停止再删除', 'command_running', 409);
      const db = store.get();
      db.commands = db.commands.filter((x) => x.id !== c.id);
      store.save();
      eventLog.append({
        type: 'command.deleted',
        projectId: c.projectId,
        commandId: c.id,
        actor: actor.user(),
        data: snapshot(c)
      });
      return { ok: true, id: c.id };
    },

    startCommand: ({ cid }) => {
      const c = findCommand(cid);
      const run = runner.start(c);
      store.save();
      return { command: cmdView(c), run: runView(run) };
    },

    stopCommand: ({ cid }) => {
      const c = findCommand(cid);
      const run = runner.stop(c);
      store.save();
      return { command: cmdView(c), run: runView(run) };
    },

    /**
     * 一次停掉所有仍在运行的命令（跨项目，含已分离但宿主仍存活的）。
     * 恢复备份被 commands_running 拦住时，弹窗据此提供「全部停止并重试」，
     * 不必逐个项目去启动台手动停。remaining > 0 说明还有进程没退出，不要继续恢复。
     */
    stopAllCommands: async () => {
      const active = () => store.get().commands.filter((c) => runner.isActive(c));
      const total = active().length;
      const { failed, survivors } = await runner.stopAll(3000);
      // 托管进程的 close 回调落库后 isActive 才归零，恢复守卫用的是同一口径
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline && active().length) {
        await new Promise((r) => setTimeout(r, 100));
      }
      // 分离宿主可能仍活着但状态已先落成 stopped，单独并进来才算真实残留
      const remainingIds = new Set(active().map((c) => c.id));
      survivors.forEach((h) => remainingIds.add(h.id));
      const remaining = remainingIds.size;
      return { total, stopped: Math.max(0, total - remaining), remaining, failed };
    },

    commandStatus: ({ cid }) => {
      const c = findCommand(cid);
      return { id: c.id, status: runner.isRunning(c.id) ? 'running' : 'stopped', pid: runner.runningPid(c.id) };
    },

    commandRuns: ({ cid }) => {
      const c = findCommand(cid);
      return { runs: (c.runs || []).slice(-runner.MAX_RUNS).map(runView).reverse() };
    },

    logs: ({ cid, runId }) => {
      const c = findCommand(cid);
      const data = runner.readLog(c, runId ? String(runId) : null);
      if (!data) return { run: null, lines: [], truncated: false };
      return { run: runView(data.run), lines: data.lines, truncated: !!data.truncated, running: runner.isRunning(c.id) };
    }
  };
}

module.exports = { createCommands };

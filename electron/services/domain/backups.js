'use strict';

const store = require('../store');
const runner = require('../runner');
const eventLog = require('../event-log');
const { actor } = eventLog;
const { fail } = require('./errors');

function createBackups(native) {
  return {
    /* ── 备份与恢复（IPC 专用；恢复会重启应用，不开放给 MCP） ── */

    backups: () => ({ dir: store.DATA_DIR, backups: store.listBackups() }),

    /** 启动自检：数据文件损坏时会保留原文件并进入只读空库模式，前端顶部提示条据此显示 */
    dataStatus: () => store.dataStatus(),

    /** 在系统文件管理器中打开数据目录（db.json / backups / runs 所在处） */
    revealDataDir: async () => {
      if (!native.reveal) fail('当前环境不支持打开文件管理器', 'not_supported', 501);
      const dir = store.DATA_DIR;
      if (!dir) fail('数据目录尚未初始化', 'not_ready', 500);
      store.ensureDirs();
      const err = await native.reveal(dir);
      if (err) fail('无法打开系统文件管理器：' + err, 'reveal_failed', 500);
      return { ok: true, path: dir };
    },

    /**
     * 用备份快照覆盖 db.json 并自动重启。
     * 有命令在运行时必须拒绝：进程退出会把内存旧库写回，静默覆盖恢复结果。
     */
    restoreBackup: ({ name }) => {
      const runningCount = store.get().commands.filter((c) => runner.isActive(c)).length;
      if (runningCount) {
        fail('有 ' + runningCount + ' 条命令正在运行，先全部停止再恢复', 'commands_running', 409);
      }
      if (!native.relaunch) fail('当前环境不支持自动重启，不能安全恢复', 'not_supported', 501);

      const res = store.restoreBackup(name);
      eventLog.append({
        type: 'data.restored',
        projectId: null,
        actor: actor.system('store'),
        data: { backupName: res.restored, safety: res.safety }
      });
      // 延迟重启让 IPC 响应先回到渲染端，界面能看到提示
      native.relaunch(400);
      return { ok: true, restored: res.restored, safety: res.safety, restarting: true };
    }
  };
}

module.exports = { createBackups };

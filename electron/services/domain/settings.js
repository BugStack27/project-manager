'use strict';

const store = require('../store');
const eventLog = require('../event-log');
const { actor } = eventLog;

const DEFAULTS = {
  enabled: true,
  reviewReady: true,
  commandFailed: true,
  aiRequirement: true
};

/** 代码同步类设置：与通知设置平级，各占 db.settings 下的一个键 */
const GIT_DEFAULTS = {
  /** 启动时自动拉取：会改动工作区，默认关闭，必须显式开启 */
  autoPullOnLaunch: false,
  /**
   * 后台定期检查远程更新：只 fetch、只读，不动工作区，所以默认开启。
   * 关掉后侧栏不会「发现」远程新提交（推进到修改记录页仍能看到，那是一次性 fetch）。
   */
  remoteCheck: true
};

/** db.settings 下的键 → 该块的默认值：读写逻辑两块完全一致，只有键名不同 */
const BLOCKS = {
  notifications: DEFAULTS,
  git: GIT_DEFAULTS
};

/** 老库缺字段、或存了非布尔值时按默认值兜底 */
function readBlock(db, key) {
  const defaults = BLOCKS[key];
  const raw = (db && db.settings && db.settings[key]) || {};
  const out = { ...defaults };
  for (const k of Object.keys(defaults)) {
    if (typeof raw[k] === 'boolean') out[k] = raw[k];
  }
  return out;
}

/** 只接受布尔值：界面上多传的字段不会写进库；值没变则不写盘、不记审计 */
function saveBlock(db, key, patch) {
  const before = readBlock(db, key);
  const next = { ...before };
  for (const k of Object.keys(BLOCKS[key])) {
    if (patch && typeof patch[k] === 'boolean') next[k] = patch[k];
  }
  if (JSON.stringify(before) === JSON.stringify(next)) return before;

  db.settings[key] = next;
  store.save();
  eventLog.append({
    type: 'settings.changed',
    projectId: null,
    actor: actor.user(),
    data: { [key]: { before, after: next } }
  });
  return next;
}

/** 通知设置 */
const readSettings = (db) => readBlock(db, 'notifications');
/** 代码同步设置：项目未单独设置 autoPull 时以此为准 */
const readGitSettings = (db) => readBlock(db, 'git');

function createSettings() {
  return {
    notificationSettings: () => ({ notifications: readSettings(store.get()) }),
    saveNotificationSettings: ({ patch }) => ({ notifications: saveBlock(store.get(), 'notifications', patch) }),

    gitSettings: () => ({ git: readGitSettings(store.get()) }),
    saveGitSettings: ({ patch }) => ({ git: saveBlock(store.get(), 'git', patch) })
  };
}

module.exports = { createSettings, DEFAULTS, GIT_DEFAULTS, readSettings, readGitSettings };

'use strict';

/**
 * 领域层：IPC、MCP、控制管道共用的唯一业务入口。
 * 这里不依赖 electron（只依赖 node + 本地服务），便于脱离界面单测。
 * 每个方法返回与旧 HTTP 接口完全一致的响应体，错误用 { status, code, message } 抛出。
 */

const { STATUSES, UNFINISHED } = require('./constants');
const { createProjects } = require('./projects');
const { createRequirements } = require('./requirements');
const { createAgents } = require('./agents');
const { createSkills } = require('./skills');
const { createAutoClaim } = require('./auto-claim');
const { createCommands } = require('./commands');
const { createBackups } = require('./backups');
const { createChanges } = require('./changes');
const { createStats } = require('./stats');
const { createSystem } = require('./system');
const { createEvents } = require('./events');
const { createSettings } = require('./settings');
const { createAutoPull } = require('./autopull');
const { createRemoteCheck } = require('./remote-check');
const { createSearch } = require('./search');

/**
 * @param {{ pickFolder: (initial?: string) => Promise<{path: string|null, canceled: boolean}>,
 *           pickScript: (initial?: string) => Promise<{path: string|null, dir: string|null, canceled: boolean}>,
 *           reveal: (dir: string) => Promise<string> }} deps  原生能力（由 Electron 注入）
 */
function createDomain(deps) {
  const native = deps || {};
  const methods = {};
  const parts = [
    createProjects(),
    createRequirements(),
    createAgents(),
    createSkills(),
    createAutoClaim(),
    createCommands(),
    createBackups(native),
    createChanges(),
    createStats(),
    createSystem(native),
    createEvents(),
    createSettings(),
    createAutoPull(),
    createRemoteCheck(),
    createSearch()
  ];

  parts.forEach((part) => {
    Object.keys(part).forEach((name) => {
      if (Object.hasOwn(methods, name)) throw new Error('domain 方法重复：' + name);
      methods[name] = part[name];
    });
  });

  return methods;
}

module.exports = { createDomain, STATUSES, UNFINISHED };

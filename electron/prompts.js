'use strict';

/**
 * 提示词注册表与存贮：让提示词可以独立于软件升级热更新。
 *
 * 设计要点：
 * - REGISTRY 声明 id → 文件 + 元信息。新增提示词只需在这里加一项、把 .md 放进 prompts/ 目录；
 *   id 是对外契约（工具的 id 参数、资源 URI、版本校验都按它引用），发布后不要改名。
 * - 单一真源是仓库内 prompts/*.md（随安装包分发）。
 * - 每次启动都用内置版本覆盖 userData/prompts/ 里的运行时副本：始终使用安装包里的最新版，
 *   不做「是否被改过」的判断——那套基线与备份逻辑只会让版本状态变得难以预测。
 *   运行时副本存在只是为了「打包后可读 + 进程内可临时修改」。
 * - 每次读取都走 fs（不缓存），文件被改后下一个请求立即拿到新内容。
 */

const fs = require('fs');
const path = require('path');

/** 主场景提示词 id：握手引导与工具描述里按它举例 */
const PRIMARY_ID = 'scout';

/** 早期版本留下的基线文件，启动时清掉，避免误导 */
const LEGACY_MANIFEST = '.baseline.json';

/**
 * 提示词注册表。加一项即可被 resources / GET /prompt/<id>.txt 同时暴露。
 * @type {{id: string, file: string, name: string, description: string}[]}
 */
const REGISTRY = [
  {
    id: 'scout',
    file: 'scout.md',
    name: '项目巡检手册',
    description: '执行手册：巡检所有项目并提交需求'
  },
  {
    id: 'scout-stub',
    file: 'scout-stub.md',
    name: '项目巡检接入说明',
    description: '取手册并执行的接入说明'
  },
  {
    id: 'worker',
    file: 'worker.md',
    name: '需求执行手册',
    description: '执行手册：取一条可认领的需求，开发并交付'
  },
  {
    id: 'worker-stub',
    file: 'worker-stub.md',
    name: '需求执行接入说明',
    description: '取执行手册并执行的接入说明'
  }
];

const BY_ID = new Map(REGISTRY.map((p) => [p.id, p]));

function readIn(dir, file) {
  try {
    return fs.readFileSync(path.join(dir, file), 'utf8');
  } catch (_) {
    return null;
  }
}

/**
 * @param {{builtinDir: string, userDir: string, log?: (msg: string) => void}} opts
 */
function createPromptStore(opts) {
  const builtinDir = opts.builtinDir;
  const userDir = opts.userDir;
  const log = opts.log || (() => {});

  /** 清掉早期版本的 .bak 备份，避免目录里堆着与当前版本无关的旧文本 */
  function dropLegacy(target) {
    try {
      fs.rmSync(target + '.bak', { force: true });
    } catch (_) {}
  }

  /**
   * 用内置版本覆盖运行时副本。内容相同则跳过写，避免每次启动都触发磁盘写入。
   * 不判断「用户是否改过」：提示词不对外开放编辑，永远以安装包里的版本为准。
   */
  function seed() {
    try {
      fs.mkdirSync(userDir, { recursive: true });
    } catch (e) {
      log('[prompts] 创建目录失败：' + e.message);
      return;
    }

    for (const def of REGISTRY) {
      const builtinText = readIn(builtinDir, def.file);
      if (builtinText == null) {
        log('[prompts] 内置文件缺失：' + def.file);
        continue;
      }
      const target = path.join(userDir, def.file);
      if (readIn(userDir, def.file) !== builtinText) {
        try {
          fs.writeFileSync(target, builtinText, 'utf8');
          log('[prompts] 已同步：' + def.file);
        } catch (e) {
          log('[prompts] 写入失败：' + def.file + ' — ' + e.message);
        }
      }
      dropLegacy(target);
    }

    try {
      fs.rmSync(path.join(userDir, LEGACY_MANIFEST), { force: true });
    } catch (_) {}
  }

  /** 按 id 读：运行时副本优先、缺失回退内置；未知 id 返回 null */
  function read(id) {
    const def = BY_ID.get(String(id || '').trim());
    if (!def) return null;
    let text = readIn(userDir, def.file);
    if (text == null) text = readIn(builtinDir, def.file);
    if (text == null) text = '';
    return { id: def.id, name: def.name, text };
  }

  return {
    seed,
    dir: () => userDir,
    ids: () => REGISTRY.map((p) => p.id),
    has: (id) => BY_ID.has(String(id || '').trim()),
    read,
    /** 供工具「不传 id 时列出可用项」与 resources / prompts 列表使用 */
    list: () => REGISTRY.map((p) => ({ id: p.id, name: p.name, description: p.description }))
  };
}

module.exports = { createPromptStore, REGISTRY, PRIMARY_ID };

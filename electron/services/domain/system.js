'use strict';

const store = require('../store');
const ide = require('../ide');
const terminal = require('../terminal');
const snippet = require('../snippet');
const files = require('../files');
const { fail } = require('./errors');
const { assertProjectDir } = require('./validators');
const { findProject } = require('./lookups');

function createSystem(native) {
  return {
    revealProject: async ({ id }) => {
      const p = findProject(id);
      const target = assertProjectDir(p);
      if (!native.reveal) fail('当前环境不支持打开文件管理器', 'not_supported', 501);

      const err = await native.reveal(target);
      if (err) fail('无法打开系统文件管理器：' + err, 'reveal_failed', 500);
      return { ok: true, path: target };
    },

    /**
     * 版本与平台：界面底部显示版本号用。
     * domain 层不 require electron，所以这些值由 main 的 native 桥注入。
     */
    appInfo: () => {
      const info = (typeof native.appInfo === 'function' ? native.appInfo() : null) || {};
      return {
        version: info.version || null,
        packaged: !!info.packaged,
        platform: info.platform || process.platform
      };
    },

    /**
     * 本机已安装的 IDE 列表。
     * 结果在服务层缓存，只有 refresh:true 才重新扫盘；lastIdeId 供界面默认选中上次用的那个。
     */
    ides: ({ refresh }) => {
      const data = ide.scan({ refresh: !!refresh, native: { readShortcut: native.readShortcut } });
      return {
        ides: data.ides.map((i) => ({ id: i.id, name: i.name, icon: i.icon || null })),
        lastIdeId: store.get().settings.lastIdeId || null,
        diagnostics: data.diagnostics
      };
    },

    /** 在指定 IDE 中打开项目目录。ideId 必须是 ides() 返回的 id，不接受任意可执行文件路径 */
    openInIde: ({ id, ideId }) => {
      const p = findProject(id);
      const target = assertProjectDir(p);
      const res = ide.open(target, ideId, { native: { readShortcut: native.readShortcut } });
      store.get().settings.lastIdeId = res.id;
      store.save();
      return { ok: true, path: target, ide: res };
    },

    /**
     * 需求备注里证据坐标（`路径:行号`）的悬停预览：只读、只认项目根内的文件。
     * 走 assertProjectDir 而不是相信调用方传来的路径，与 openInIde / openInTerminal 同口径。
     */
    fileSnippet: ({ id, path: relPath, line, end, full }) => {
      const p = findProject(id);
      const root = assertProjectDir(p);
      return snippet.read(root, relPath, { line, end, full: !!full });
    },

    /**
     * 项目文件清单：需求正文「@ 引用文件」的候选补全用。只读、只在项目根内，
     * 优先 git ls-files（尊重 .gitignore），非仓库回退到目录遍历；密钥 / 依赖目录不列。
     */
    projectFiles: async ({ id }) => {
      const p = findProject(id);
      const root = assertProjectDir(p);
      return files.list(root);
    },

    /**
     * 用系统默认程序打开项目内的一个文件（文件引用 chip 点击）：走与 revealProject 同一个 native.reveal
     * （shell.openPath，传文件路径即按默认应用打开）。路径校验与密钥拦截与 fileSnippet 同口径。
     */
    revealFile: async ({ id, path: relPath }) => {
      const p = findProject(id);
      const root = assertProjectDir(p);
      const rel = snippet.assertRelPath(relPath);
      if (snippet.DENY_RE.test(rel)) fail('该文件不允许打开（密钥/凭据/依赖目录）', 'restricted', 403);
      const abs = snippet.resolveInside(root, rel);
      if (!native.reveal) fail('当前环境不支持打开文件', 'not_supported', 501);
      const err = await native.reveal(abs);
      if (err) fail('无法打开该文件：' + err, 'reveal_failed', 500);
      return { ok: true, path: abs };
    },

    /** 用系统默认终端打开项目目录。只接受项目 id，路径来自库内登记，渲染层无法传入任意路径 */
    openInTerminal: async ({ id }) => {
      const p = findProject(id);
      const target = assertProjectDir(p);
      const used = await terminal.open(target);
      return { ok: true, path: target, terminal: used };
    },

    pickFolder: async ({ initial }) => {
      if (!native.pickFolder) fail('当前环境不支持文件夹选择器', 'not_supported', 501);
      return native.pickFolder(initial ? String(initial) : '');
    },

    pickScript: async ({ initial }) => {
      if (!native.pickScript) fail('当前环境不支持脚本选择器', 'not_supported', 501);
      return native.pickScript(initial ? String(initial) : '');
    },

    /** 用系统浏览器打开远程仓库地址：只放行 http/https */
    openUrl: async ({ url }) => {
      const u = String(url || '').trim();
      if (!/^https?:\/\//i.test(u)) fail('只支持打开 http/https 地址', 'bad_url', 400);
      if (!native.openUrl) fail('当前环境不支持打开浏览器', 'not_supported', 501);
      const ok = await native.openUrl(u);
      if (!ok) fail('无法用系统浏览器打开该地址', 'open_failed', 502);
      return { ok: true, url: u };
    }
  };
}

module.exports = { createSystem };

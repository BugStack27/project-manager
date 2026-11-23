'use strict';

const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');

const MAX_OUT = 512 * 1024; // 单次 diff / 正文返回上限
const MAX_BUFFER = 8 * 1024 * 1024; // 交给 execFile 的 stdout 缓冲上限
const COMMIT_LIMIT_MAX = 200;
const REMOTE_COMMIT_LIMIT = 50; // 远程独有提交的展示上限
const FETCH_TIMEOUT = 15000; // 静默抓取：超过就放弃，不阻塞界面
const NET_TIMEOUT = 60000; // 用户主动的拉取 / 推送：允许网络慢
const COMMIT_TIMEOUT = 60000; // 提交可能跑 pre-commit / commit-msg 钩子，给得比一般命令宽

/** 带 code / status 的异常，供 api 层映射 HTTP 响应 */
function fail(message, code, status) {
  const e = new Error(message);
  e.code = code;
  e.status = status || 400;
  throw e;
}

function trim(text) {
  const s = String(text || '');
  if (s.length <= MAX_OUT) return { text: s, truncated: false };
  return { text: s.slice(0, MAX_OUT), truncated: true };
}

/** 超时后杀整棵进程树：git pull 会派生 git-remote-https / ssh，只杀父进程会留下孤儿 */
function killTree(child) {
  if (!child || child.exitCode !== null) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    } else {
      child.kill('SIGKILL');
    }
  } catch (_) {
    /* 已经退出就算了 */
  }
}

/**
 * 不带 shell 执行 git（参数数组 + cwd），返回 { code, stdout, stderr }。
 * 找不到 git 可执行程序时返回 { unavailable: true }；opts.timeout 到期返回 { timedOut: true }。
 * opts: { timeout?: ms, env?: object }；env 合并到默认环境之上（默认已关掉凭据提示）
 */
function runGit(cwd, args, opts) {
  const o = opts || {};
  // 兜底关掉所有交互式凭据提示：GUI 里没有 tty，交互式提示会把子进程挂死。
  // GIT_TERMINAL_PROMPT 只管 git 内建的账号密码提示；Windows 上真正会弹窗的是
  // Git Credential Manager（它不看这个变量，只认 GCM_INTERACTIVE），
  // 不关掉的话后台每轮 fetch 都会弹出一个登录框。
  const env = {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GCM_INTERACTIVE: 'never',
    ...(o.env || {})
  };
  return new Promise((resolve) => {
    let done = false;
    let timer = null;
    const finish = (val) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      resolve(val);
    };

    const child = execFile(
      'git',
      // -c credential.interactive=false 是 GCM 2.x 的等价开关：只允许用已存好的凭据，
      // 拿不到就直接失败，别弹窗。两类开关都带上，换一台机器也不会漏。
      ['-c', 'credential.interactive=false', ...args],
      { cwd, windowsHide: true, maxBuffer: MAX_BUFFER, encoding: 'utf8', env },
      (err, stdout, stderr) => {
        if (err && (err.code === 'ENOENT' || err.errno === -4058)) {
          return finish({ unavailable: true, code: null, stdout: '', stderr: '' });
        }
        if (err && err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
          return finish({ unavailable: false, code: 0, stdout: String(stdout || ''), stderr: '', overflow: true });
        }
        const code = err ? (typeof err.code === 'number' ? err.code : 1) : 0;
        finish({ unavailable: false, code, stdout: String(stdout || ''), stderr: String(stderr || '') });
      }
    );

    if (o.timeout > 0) {
      timer = setTimeout(() => {
        killTree(child);
        finish({ unavailable: false, code: null, timedOut: true, stdout: '', stderr: '' });
      }, o.timeout);
    }
  });
}

/** git 报错取一行人话：优先 fatal/error 那行，去掉前缀，截断到 300 字 */
function briefError(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const pick = lines.find((l) => /^(fatal|error):/i.test(l)) || lines[0] || '';
  const s = pick.replace(/^(fatal|error):\s*/i, '');
  return s.length > 300 ? s.slice(0, 300) + '…' : s;
}

/** 从 git 输出里取出第一条命中 re 的行（去掉 fatal/error/hint 前缀）；用于判定错误类型并展示关键那一行 */
function gitLine(text, re) {
  const line = String(text || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .find((s) => re.test(s));
  return line ? line.replace(/^(fatal|error|hint):\s*/i, '').replace(/\s+/g, ' ') : '';
}

/**
 * 凭据失效的报错特征。本应用不弹交互式登录（见 runGit 的 env），
 * 所以「需要登录」会以这些文案失败；识别出来是为了给界面一个专门的提示，
 * 而不是让用户以为仓库坏了 / 网络断了。
 */
const AUTH_RE =
  /authentication failed|could not read username|could not read password|invalid username or password|invalid credentials|terminal prompts disabled|permission denied|support for password authentication was removed|host key verification failed|returned error: 40[13]/i;

function authError(text) {
  return AUTH_RE.test(String(text || ''));
}

/**
 * 项目目录是否可用：目录被移动 / 删除后 spawn 会报 ENOENT，会被 runGit 当成「没装 git」。
 * 所以探测仓库之前必须先单独判一次目录，否则「路径失效」会伪装成「git 不可用」。
 */
function dirUsable(cwd) {
  try {
    return fs.statSync(cwd).isDirectory();
  } catch (_) {
    return false;
  }
}

/**
 * 仓库探测 + 路径前缀，一次 spawn 拿两个值。
 *
 * `rev-parse` 支持一次带多个 query，输出顺序与参数顺序一致：
 *   仓库根 → `true\n\n`；子目录 → `true\nweb/\n`；非仓库 → 非 0 退出。
 *
 * 为什么合并：这两个值都是「项目级常量」，但进一次修改记录页原本要各跑三次
 * （提交 / 改动 / 远程三个接口各来一遍探测，提交和改动再各来一遍前缀）。
 * 而本机起一个 git 进程就要 ~180ms —— 合并后每个接口少一次进程，
 * 三个接口就是半秒级，且完全没有正确性代价（同一份输出、同一个退出码语义）。
 */
async function probe(cwd, opts) {
  if (!dirUsable(cwd)) return { repo: false, missing: true, unavailable: false, prefix: '' };
  const r = await runGit(cwd, ['rev-parse', '--is-inside-work-tree', '--show-prefix'], opts);
  if (r.unavailable) return { repo: false, unavailable: true, prefix: '' };
  if (r.timedOut) return { repo: false, unavailable: false, timedOut: true, prefix: '' };
  if (r.code !== 0) return { repo: false, unavailable: false, prefix: '' };
  const [inside, prefix] = r.stdout.split('\n');
  return {
    repo: String(inside || '').trim() === 'true',
    unavailable: false,
    prefix: String(prefix || '').trim()
  };
}

/** 仓库探测：{ repo, unavailable, timedOut }；只要布尔值的调用方用这个 */
async function isRepo(cwd, opts) {
  const p = await probe(cwd, opts);
  return { repo: p.repo, unavailable: p.unavailable, timedOut: p.timedOut };
}

async function branch(cwd, opts) {
  const r = await runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'], opts);
  if (r.code !== 0) return null; // 空仓库没有 HEAD
  const name = r.stdout.trim();
  return name === 'HEAD' ? null : name; // 游离 HEAD
}

/** 当前目录相对仓库根的路径前缀；项目本身是仓库根时返回空串 */
async function repoPrefix(cwd) {
  const r = await runGit(cwd, ['rev-parse', '--show-prefix']);
  return r.code === 0 ? r.stdout.trim() : '';
}

/** 仓库根相对路径 → 项目相对路径；不在项目内返回 null */
function stripPrefix(prefix, p) {
  if (!prefix) return p;
  const head = p.slice(0, prefix.length);
  // Windows 文件系统大小写不敏感，git 前缀与 status 路径的大小写可能不一致
  const inside = process.platform === 'win32' ? head.toLowerCase() === prefix.toLowerCase() : head === prefix;
  return inside ? p.slice(prefix.length) : null;
}

const COMMIT_FMT = '%H%x1f%h%x1f%s%x1f%an%x1f%ae%x1f%aI%x1f%D%x1e';
/** 提交列表共用的输出格式参数（本地历史与远程独有提交必须同一口径） */
const LOG_FMT_ARGS = ['--date=iso-strict', '--pretty=format:' + COMMIT_FMT];
/**
 * 带增删行数的提交格式：记录仍以 \x1e 开头，末尾多一个 \x1f —— 增删行数落在第 8 段，
 * parseCommit 只读前 7 段，两个格式可以共用同一份解析。
 */
const COMMIT_STAT_FMT = '%x1e' + COMMIT_FMT.replace(/%x1e$/, '') + '%x1f';
/** 列表 + 每条提交的增删行数（与 LOG_FMT_ARGS 同一口径，只多 --numstat） */
const LOG_STAT_ARGS = ['--date=iso-strict', '--pretty=format:' + COMMIT_STAT_FMT, '--numstat'];

function parseCommit(raw) {
  const p = raw.split('\x1f');
  return {
    sha: p[0] || '',
    shortSha: p[1] || '',
    subject: p[2] || '',
    author: p[3] || '',
    authorEmail: p[4] || '',
    committedAt: p[5] || '',
    refs: p[6] ? p[6].split(', ').map((s) => s.trim()).filter(Boolean) : []
  };
}

/** 按记录分隔符 \x1e 切出每条提交的原始文本（去掉记录前的换行与空段） */
function splitRecords(stdout) {
  return String(stdout || '')
    .split('\x1e')
    .map((s) => s.replace(/^\r?\n/, ''))
    .filter(Boolean);
}

/** 解析 `--pretty=format:COMMIT_FMT` 的输出（记录以 \x1e 分隔） */
function parseLog(stdout) {
  return splitRecords(stdout).map(parseCommit);
}

/** numstat 文本 → 增删行数合计；二进制文件为 `-\t-`，不计行数 */
function sumNumstat(text) {
  let added = 0;
  let removed = 0;
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = /^(\d+|-)\t(\d+|-)\t/.exec(line);
    if (!m) continue;
    if (m[1] !== '-') added += Number(m[1]);
    if (m[2] !== '-') removed += Number(m[2]);
  }
  return { added, removed };
}

/** 解析 `--pretty=format:COMMIT_STAT_FMT --numstat`：每条提交再带上 added / removed */
function parseLogStats(stdout) {
  return splitRecords(stdout).map((body) => {
    const s = sumNumstat(body.split('\x1f')[7]);
    return { ...parseCommit(body), added: s.added, removed: s.removed };
  });
}

/**
 * 解析 `--pretty=format:%x1e%cI --numstat`：按提交日期（本地自然日）汇总提交数与增删行数。
 * 二进制文件 numstat 为 `-\t-`，不计行数；`{a => b}` 的重命名路径不影响前缀解析。
 */
function parseActivity(stdout) {
  const byDate = new Map();
  for (const record of String(stdout || '').split('\x1e')) {
    const lines = record.split('\n');
    const iso = (lines.shift() || '').trim();
    if (!iso) continue;
    const at = new Date(iso);
    if (Number.isNaN(at.getTime())) continue;
    const date =
      at.getFullYear() + '-' + String(at.getMonth() + 1).padStart(2, '0') + '-' + String(at.getDate()).padStart(2, '0');
    let day = byDate.get(date);
    if (!day) {
      day = { date, commits: 0, added: 0, removed: 0 };
      byDate.set(date, day);
    }
    day.commits += 1;
    const s = sumNumstat(lines.join('\n'));
    day.added += s.added;
    day.removed += s.removed;
  }
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

const STATS_TIMEOUT = 30 * 1000;

/**
 * 区间内的提交活动：提交数 + 新增/删除行数，按本地自然日返回稀疏数组。
 * 合并提交与二进制文件不计入；项目在仓库子目录时只统计目录内文件。
 * stdout 超出缓冲时仍解析已有部分，并标记 truncated。
 */
async function activity(cwd, range) {
  const args = [
    'log',
    '--no-merges',
    '--since=' + range.since + ' 00:00:00',
    '--until=' + range.until + ' 23:59:59',
    '--date=iso-strict',
    '--pretty=format:%x1e%cI',
    '--numstat'
  ];
  // 只在子目录项目加路径过滤；仓库根不加，避免 -- . 触发历史简化。
  // range.prefix 由调用方从 probe() 带进来（统计页逐项目跑，省一个进程更划算）
  const prefix = range.prefix !== undefined ? range.prefix : await repoPrefix(cwd);
  if (prefix) args.push('--', '.');
  const r = await runGit(cwd, args, { timeout: STATS_TIMEOUT });
  if (r.unavailable) fail('未检测到 git 可执行程序', 'git_unavailable', 501);
  if (r.timedOut) fail('统计提交活动超时（' + STATS_TIMEOUT / 1000 + ' 秒）', 'stats_timeout', 504);
  // 空仓库 / 无提交：git log 退出码非 0，按空活动处理
  if (r.code !== 0) return { days: [], truncated: false };
  return { days: parseActivity(r.stdout), truncated: !!r.overflow };
}

/**
 * 提交增删行数的进程内缓存：key = prefix | sha。
 *
 * 只缓存「不可变的事实」：一条提交的增删行数在它创建之后就固定了（改写历史会生成新 sha）。
 * 所以这份缓存永远不需要失效判据，也不存在过期 —— 这是它比「缓存整个列表」安全的地方。
 *
 * 为什么不连列表一起缓存：列表里还有 `%D` 的 refs 装饰（分支 / 标签）。那些是会变的
 * （在同一个提交上打 tag，HEAD 并不动），缓存住就会让新标签在列表里迟迟不出现。
 * 标题、作者、refs 这类便宜又易变的东西每次从 plain log 现取（71ms），
 * 贵的只有 -numstat 那 350ms 的 diff 计算。
 */
const STAT_CACHE_MAX = 3000;
const statCache = new Map();

function statKey(prefix, sha) {
  return prefix + '\u0000' + sha;
}

/**
 * 提交历史；limit 封顶 200，多取一条用于判断 hasMore。
 * 默认带 --numstat，每条提交附上自己的增删行数（提交行要显示）；
 * 搜索只看标题，传 numstat: false 省掉逐提交 diff 的开销。
 * 合并提交与二进制文件不计行数。
 *
 * 两步走：先 plain log 拿列表（71ms），再按 sha 查缓存决定要不要跑 numstat（414ms）。
 * 全部命中时整页 71ms，冷路径也只多一次 71ms 的 plain log —— 换来 refs 永远新鲜。
 */
async function commits(cwd, opts) {
  const o = opts || {};
  const limit = Math.min(Math.max(parseInt(o.limit, 10) || 30, 1), COMMIT_LIMIT_MAX);
  const skip = Math.max(parseInt(o.skip, 10) || 0, 0);
  const withStats = o.numstat !== false;

  // 只在子目录项目加路径过滤；仓库根不加，避免 -- . 触发历史简化。
  // opts.prefix 由调用方从 probe() 带进来，带进来了就不再单独跑一次 rev-parse。
  const prefix = o.prefix !== undefined ? o.prefix : await repoPrefix(cwd);
  const pathArgs = prefix ? ['--', '.'] : [];
  const window = ['-n', String(limit + 1), '--skip=' + skip];

  const r = await runGit(cwd, ['log', ...window, ...LOG_FMT_ARGS, ...pathArgs]);
  if (r.unavailable) fail('未检测到 git 可执行程序', 'git_unavailable', 501);
  // 空仓库 / 无提交：git log 退出码非 0，按空列表处理
  if (r.code !== 0) return { commits: [], hasMore: false };

  const records = parseLog(r.stdout);
  const hasMore = records.length > limit;
  const list = records.slice(0, limit);
  if (!withStats) return { commits: list, hasMore };

  // 有一条没缓存过就整批重算：git 没有「只对指定提交算 numstat」的批处理形式，
  // 逐条 git show 会是 N 个进程，比整批还慢。
  if (list.some((c) => !statCache.has(statKey(prefix, c.sha)))) {
    const rs = await runGit(cwd, ['log', ...window, ...LOG_STAT_ARGS, ...pathArgs]);
    if (rs.code === 0) {
      for (const c of parseLogStats(rs.stdout)) {
        statCache.set(statKey(prefix, c.sha), { added: c.added, removed: c.removed });
        if (statCache.size > STAT_CACHE_MAX) statCache.delete(statCache.keys().next().value);
      }
    }
  }

  const commits = list.map((c) => {
    const s = statCache.get(statKey(prefix, c.sha));
    // 拿不到行数就给 null 而不是 0：与 changes() 里「别让 +0 骗人」同一口径
    return s ? { ...c, added: s.added, removed: s.removed } : { ...c, added: null, removed: null };
  });
  return { commits, hasMore };
}

/** 上游分支全名（如 `origin/main`）；没有上游 / 游离 HEAD 返回 null */
async function upstreamRef(cwd) {
  const r = await runGit(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
  if (r.code !== 0) return null;
  const name = r.stdout.trim();
  return name || null;
}

/**
 * 远程追踪位置：上游分支名、ahead/behind、上游 sha，以及「远程有、本地没有」的提交。
 * 只读本地已知的跟踪引用，不联网；要拿最新位置得先 fetchRemote()。
 * opts.prefix 由调用方从 probe() 带进来，带进来了就不再多跑一次 rev-parse。
 */
async function remoteStatus(cwd, opts) {
  const o = opts || {};
  const limit = Math.min(Math.max(parseInt(o.limit, 10) || REMOTE_COMMIT_LIMIT, 1), COMMIT_LIMIT_MAX);

  // 上游名、位置计数、上游 sha、路径前缀四件事互不依赖，一起起进程。
  // 没有上游时 rev-list / rev-parse 会自己失败，正好拿它们的退出码当判据 ——
  // 不必先串行问一次 @{u} 再决定要不要继续（那一次就白等 180ms）。
  const [upstream, cnt, sha, prefix] = await Promise.all([
    upstreamRef(cwd),
    runGit(cwd, ['rev-list', '--left-right', '--count', 'HEAD...@{u}']),
    runGit(cwd, ['rev-parse', '@{u}']),
    o.prefix !== undefined ? Promise.resolve(o.prefix) : repoPrefix(cwd)
  ]);
  if (!upstream) {
    return { hasUpstream: false, upstream: null, remoteName: null, ahead: 0, behind: 0, sha: null, commits: [], truncated: false };
  }

  const remoteName = upstream.split('/')[0];
  // 空仓库（没有 HEAD）或上游引用损坏：位置未知，按 0/0 处理
  if (cnt.code !== 0) {
    return { hasUpstream: true, upstream, remoteName, ahead: 0, behind: 0, sha: null, commits: [], truncated: false };
  }

  const nums = cnt.stdout.trim().split(/\s+/);
  const ahead = parseInt(nums[0], 10) || 0;
  const behind = parseInt(nums[1], 10) || 0;

  let list = [];
  if (behind > 0) {
    // 与本地历史同一口径：远程独有的提交也要在树上显示自己的改动量
    const args = ['log', '-n', String(Math.min(behind, limit)), ...LOG_STAT_ARGS, '@{u}', '--not', 'HEAD'];
    if (prefix) args.push('--', '.');
    const lg = await runGit(cwd, args);
    if (lg.code === 0) list = parseLogStats(lg.stdout);
  }

  return {
    hasUpstream: true,
    upstream,
    remoteName,
    ahead,
    behind,
    sha: sha.code === 0 ? sha.stdout.trim() : null,
    commits: list,
    truncated: behind > limit
  };
}

/** 仓库路径去掉首尾斜杠与 .git 后缀，用于拼网页地址 */
function cleanRepoPath(p) {
  return String(p || '')
    .replace(/^\/+/, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '');
}

/**
 * 远程地址 → 能在浏览器里打开的网页地址；本地路径 / file:// 等无法浏览时返回 null。
 * 覆盖：https/http、ssh://、git://、以及 scp 简写 git@host:path。
 */
function remoteWebUrl(raw) {
  const url = String(raw || '').trim();
  if (!url) return null;
  // 本地路径没有网页可开：Windows 盘符、相对路径、UNC 共享
  if (/^[a-zA-Z]:[\\/]/.test(url) || /^[.~\\/]/.test(url)) return null;

  // scp 简写没有 scheme，单独处理（本地路径不含冒号，不会误判）
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
    const m = /^(?:[^@/\s]+@)?([^:/\s]+):(.+)$/.exec(url);
    return m ? 'https://' + m[1] + '/' + cleanRepoPath(m[2]) : null;
  }

  let u;
  try {
    u = new URL(url);
  } catch (_) {
    return null;
  }
  if (u.protocol === 'http:' || u.protocol === 'https:') {
    // 去掉 user:token@，凭据不该出现在浏览器地址栏与历史里
    return u.protocol + '//' + u.host + '/' + cleanRepoPath(u.pathname);
  }
  if (u.protocol === 'ssh:' || u.protocol === 'git:') {
    return 'https://' + u.hostname + '/' + cleanRepoPath(u.pathname);
  }
  return null;
}

/** 所有远程仓库：名称 + 地址 + 可浏览的网页地址（无法浏览为 null） */
async function remotes(cwd) {
  const r = await runGit(cwd, ['remote', '-v']);
  if (r.unavailable) fail('未检测到 git 可执行程序', 'git_unavailable', 501);
  if (r.code !== 0) return { remotes: [] };

  const map = new Map();
  for (const line of r.stdout.split('\n')) {
    const m = /^(\S+)\s+(\S*)\s+\((fetch|push)\)\s*$/.exec(line.trim());
    if (!m) continue;
    const cur = map.get(m[1]) || { name: m[1], fetchUrl: null, pushUrl: null };
    if (m[3] === 'fetch') cur.fetchUrl = m[2];
    else cur.pushUrl = m[2];
    map.set(m[1], cur);
  }

  return {
    remotes: [...map.values()].map((x) => {
      const url = x.fetchUrl || x.pushUrl || '';
      return { name: x.name, url, web: remoteWebUrl(url) };
    })
  };
}

/** 静默抓取远程：失败不抛错，调用方降级用本地已知的跟踪引用 */
async function fetchRemote(cwd) {
  const r = await runGit(cwd, ['fetch', '--prune', '--no-tags', '--quiet'], { timeout: FETCH_TIMEOUT });
  if (r.unavailable) return { ok: false, timedOut: false, auth: false, error: '未检测到 git 可执行程序' };
  if (r.timedOut) return { ok: false, timedOut: true, auth: false, error: '抓取远程超时（' + FETCH_TIMEOUT / 1000 + ' 秒）' };
  if (r.code !== 0) {
    const raw = r.stderr || r.stdout;
    return {
      ok: false,
      timedOut: false,
      // 凭据失效单独标出来：界面据此提示「需要登录」，后台也不再把它当成网络抖动
      auth: authError(raw),
      error: briefError(raw) || '抓取远程失败'
    };
  }
  return { ok: true, timedOut: false, auth: false, error: null };
}

/** 拉取 / 推送共用的收尾：重算位置，按同一形状返回（前端据此算「拉/推了几个提交」） */
async function syncResult(cwd, before, r) {
  const after = await remoteStatus(cwd, { limit: 1 });
  return {
    ok: true,
    upstream: before.upstream,
    before: { ahead: before.ahead, behind: before.behind },
    after: { ahead: after.ahead, behind: after.behind },
    summary: briefError(r.stdout) || briefError(r.stderr) || ''
  };
}

/**
 * 快进拉取：工作区有未提交改动、无上游、分叉都直接失败，不做任何兜底操作。
 */
async function pullFastForward(cwd) {
  const st = await runGit(cwd, ['status', '--porcelain=v1', '-z', '--', '.']);
  if (st.unavailable) fail('未检测到 git 可执行程序', 'git_unavailable', 501);
  if (st.code !== 0) fail('读取工作区状态失败', 'status_failed', 400);
  const dirty = parseStatusZ(st.stdout).length;
  if (dirty > 0) fail('工作区有 ' + dirty + ' 个未提交改动，先提交或暂存再拉取', 'dirty_worktree', 409);

  const before = await remoteStatus(cwd, { limit: 1 });
  if (!before.hasUpstream) fail('当前分支没有上游分支，无法拉取', 'no_upstream', 409);

  const r = await runGit(cwd, ['pull', '--ff-only', '--no-rebase', '--no-tags'], { timeout: NET_TIMEOUT });
  if (r.unavailable) fail('未检测到 git 可执行程序', 'git_unavailable', 501);
  if (r.timedOut) fail('拉取超时（' + NET_TIMEOUT / 1000 + ' 秒），请检查网络或手动执行 git pull', 'pull_timeout', 504);
  if (r.code !== 0) {
    const raw = r.stderr || r.stdout;
    const msg = briefError(raw) || '未知错误';
    // 凭据失效先判：这种情况下任何「分叉 / 无上游」的文案都不成立，用户该做的是去登录
    if (authError(raw)) fail('拉取需要登录远程仓库：' + msg, 'auth_failed', 409);
    if (/fast-forward|divergent|non-fast-forward/i.test(msg)) {
      fail('本地与远程已分叉，无法快进：' + msg, 'not_fast_forward', 409);
    }
    if (/couldn't find remote ref|no such ref|no tracking information|no upstream/i.test(msg)) {
      fail('远程分支不存在或上游已失效：' + msg, 'no_upstream', 409);
    }
    fail('拉取失败：' + msg, 'pull_failed', 409);
  }

  return syncResult(cwd, before, r);
}

/**
 * 推送当前分支到已配置的上游：只跑无参数 `git push`，不改配置、不推其它分支。
 * 远程有本地没有的提交会被 ref 拒绝，按「先拉取」给提示，不做 force。
 */
async function pushCurrent(cwd) {
  const before = await remoteStatus(cwd, { limit: 1 });
  if (!before.hasUpstream) fail('当前分支没有上游分支，无法推送', 'no_upstream', 409);

  const r = await runGit(cwd, ['push'], { timeout: NET_TIMEOUT });
  if (r.unavailable) fail('未检测到 git 可执行程序', 'git_unavailable', 501);
  if (r.timedOut) fail('推送超时（' + NET_TIMEOUT / 1000 + ' 秒），请检查网络或手动执行 git push', 'push_timeout', 504);
  if (r.code !== 0) {
    // 拒绝/鉴权的关键信息在 `! [rejected] ... (fetch first)` 这类行上，不在 fatal/error 行
    const raw = r.stderr || r.stdout;
    const rejected = gitLine(raw, /non-fast-forward|fetch first|\[rejected\]/i);
    if (rejected) fail('远程有本地没有的提交，先拉取再推送：' + rejected, 'push_rejected', 409);
    const auth = gitLine(raw, AUTH_RE);
    if (auth) fail('推送需要登录远程仓库：' + auth, 'push_auth', 409);
    fail('推送失败：' + (briefError(raw) || '未知错误'), 'push_failed', 409);
  }

  return syncResult(cwd, before, r);
}

/**
 * 提交项目目录内的全部改动：先 `git add -A`（项目范围），再以同样的 pathspec 提交，
 * 让父仓库里项目目录之外的改动不被带进来。提交信息作为单个参数直传，多行不会被拆。
 * 只写本地仓库，不推送。
 */
async function commitAll(cwd, message) {
  const msg = String(message || '').trim();
  if (!msg) fail('提交信息不能为空', 'bad_message', 400);

  const add = await runGit(cwd, ['add', '-A', '--', '.']);
  if (add.unavailable) fail('未检测到 git 可执行程序', 'git_unavailable', 501);
  if (add.code !== 0) {
    fail('暂存改动失败：' + (briefError(add.stderr) || briefError(add.stdout) || '未知错误'), 'add_failed', 409);
  }

  const r = await runGit(cwd, ['commit', '-m', msg, '--', '.'], { timeout: COMMIT_TIMEOUT });
  if (r.unavailable) fail('未检测到 git 可执行程序', 'git_unavailable', 501);
  if (r.timedOut) {
    fail('提交超时（' + COMMIT_TIMEOUT / 1000 + ' 秒），可能有钩子阻塞，请手动检查', 'commit_timeout', 504);
  }

  const raw = (r.stderr || '') + '\n' + (r.stdout || '');
  if (r.code !== 0) {
    if (/nothing to commit|no changes added to commit|nothing added to commit/i.test(raw)) {
      fail('没有可提交的改动', 'nothing_to_commit', 409);
    }
    if (/Author identity unknown|Please tell me who you are|unable to auto-detect email address|empty ident name/i.test(raw)) {
      fail('尚未配置 git 用户名或邮箱，请先执行 git config user.name / user.email', 'no_identity', 409);
    }
    fail('提交失败：' + (briefError(raw) || '未知错误'), 'commit_failed', 409);
  }

  const sha = await runGit(cwd, ['rev-parse', 'HEAD']);
  const full = sha.code === 0 ? sha.stdout.trim() : '';
  return { ok: true, sha: full, shortSha: full.slice(0, 7), subject: msg.split(/\r?\n/)[0] };
}

/** 解析 `git status --porcelain=v1 -z`：rename/copy 会追加一个 NUL 分隔的原路径 */
function parseStatusZ(stdout) {
  const parts = String(stdout || '').split('\0');
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (!entry) continue;
    const x = entry[0];
    const y = entry[1];
    const p = entry.slice(3); // 跳过 "XY "
    let origPath = null;
    if (x === 'R' || x === 'C') origPath = parts[++i] || null;
    out.push({ x, y, path: p, origPath });
  }
  return out;
}

/** 项目目录整体未被跟踪时 status 只返回 `prefix/` 一个条目，改用 -uall 展开到文件 */
async function expandUntracked(cwd, prefix, entries) {
  if (!prefix || !entries.some((f) => f.path === prefix)) return entries;
  const r = await runGit(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.']);
  return r.code === 0 ? parseStatusZ(r.stdout) : entries;
}

/** rename 的 numstat 路径（`a/{b => c}/d` 或 `a/b => c/d`）还原为新路径 */
function resolveRenamePath(raw) {
  if (!raw.includes('=>')) return raw;
  const brace = raw.match(/\{(.*?)\s*=>\s*(.*?)\}/);
  if (brace) return raw.replace(/\{.*?\}/, brace[2].trim());
  const idx = raw.lastIndexOf('=>');
  return raw.slice(idx + 2).trim();
}

/** 解析 `git diff --numstat HEAD`，返回 path -> { added, removed, binary } */
function parseNumstat(stdout) {
  const map = new Map();
  for (const line of String(stdout || '').split('\n')) {
    if (!line) continue;
    const m = line.match(/^(\d+|-)\t(\d+|-)\t(.*)$/);
    if (!m) continue;
    const binary = m[1] === '-' || m[2] === '-';
    const stat = {
      added: binary ? null : Number(m[1]),
      removed: binary ? null : Number(m[2]),
      binary
    };
    map.set(resolveRenamePath(m[3]), stat);
    map.set(m[3], stat); // 同时按原始键兜底
  }
  return map;
}

/** 未跟踪文件按行数折算成「新增」时的上限：文件数或单个体积超限就不数，宁可少显示也不拖慢列表 */
const UNTRACKED_STAT_FILES = 20;
const UNTRACKED_STAT_BYTES = 1024 * 1024;

/** 文本文件行数（末行无换行也算一行）；二进制 / 目录 / 超限 / 读不到返回 null */
async function countFileLines(abs) {
  try {
    const stat = await fs.promises.stat(abs);
    if (!stat.isFile() || stat.size > UNTRACKED_STAT_BYTES) return null;
    const buf = await fs.promises.readFile(abs);
    if (buf.subarray(0, 8000).includes(0)) return null; // 二进制
    if (!buf.length) return 0;
    let lines = 0;
    for (let i = 0; i < buf.length; i++) if (buf[i] === 10) lines += 1;
    return buf[buf.length - 1] === 10 ? lines : lines + 1;
  } catch (_) {
    return null;
  }
}

/** 给没有 numstat 的未跟踪文件补行数：git diff 看不见未跟踪文件，只能自己数 */
async function fillUntrackedStats(cwd, files) {
  if (!files.length || files.length > UNTRACKED_STAT_FILES) return;
  await Promise.all(
    files.map(async (f) => {
      const abs = resolveInside(cwd, f.path);
      const n = abs ? await countFileLines(abs) : null;
      if (n == null) return;
      f.added = n;
      f.removed = 0;
    })
  );
}

/** 当前工作区改动清单 + 汇总（仅项目目录范围，路径相对项目目录） */
async function changes(cwd, opts) {
  const o = opts || {};
  const [st, ns, prefix] = await Promise.all([
    runGit(cwd, ['status', '--porcelain=v1', '-z', '--', '.']),
    runGit(cwd, ['diff', '--numstat', '--relative', 'HEAD', '--', '.']),
    // opts.prefix 由调用方从 probe() 带进来：prefix 只决定「路径怎么截」，与 status 无关，
    // 让它在并发组里等着一个已知值，比再起一个 rev-parse 便宜 180ms
    o.prefix !== undefined ? Promise.resolve(o.prefix) : repoPrefix(cwd)
  ]);
  if (st.unavailable) fail('未检测到 git 可执行程序', 'git_unavailable', 501);

  const stats = ns.code === 0 ? parseNumstat(ns.stdout) : new Map();

  const files = [];
  /** 未跟踪文件没有 numstat：留着等下面数行，别让「+0」骗人 */
  const unstatted = [];
  for (const f of await expandUntracked(cwd, prefix, parseStatusZ(st.stdout))) {
    const p = stripPrefix(prefix, f.path);
    if (!p) continue; // 防御：pathspec 外的条目
    const origPath = f.origPath ? stripPrefix(prefix, f.origPath) : null;
    const s = stats.get(p) || (origPath ? stats.get(origPath) : null) || null;
    const untracked = f.x === '?' && f.y === '?';
    const staged = f.x !== ' ' && f.x !== '?';
    const unstaged = f.y !== ' ' && f.y !== '?';
    const status = untracked ? '??' : f.x !== ' ' ? f.x : f.y;
    const entry = {
      path: p,
      origPath,
      status,
      xy: f.x + f.y,
      staged,
      unstaged,
      untracked,
      added: s ? s.added : null,
      removed: s ? s.removed : null,
      binary: s ? s.binary : false
    };
    files.push(entry);
    if (untracked && !s) unstatted.push(entry);
  }
  await fillUntrackedStats(cwd, unstatted);

  const sum = (key) => files.reduce((n, f) => n + (f[key] || 0), 0);
  const counts = {
    total: files.length,
    staged: files.filter((f) => f.staged).length,
    unstaged: files.filter((f) => f.unstaged).length,
    untracked: files.filter((f) => f.untracked).length,
    added: sum('added'),
    removed: sum('removed')
  };

  return { branch: await branch(cwd), clean: files.length === 0, counts, files };
}

/**
 * 轻量工作区状态：只统计「是否脏 + 条目数」，不取增删行数（比 changes() 少一次子进程）。
 * 供跨项目汇总使用；目录不存在 / 不是目录时按路径失效标记返回，不抛错。
 */
async function statusCount(cwd) {
  if (!dirUsable(cwd)) return { pathMissing: true, isRepo: false, dirty: false, files: 0, sample: [] };

  const [st, prefix] = await Promise.all([
    runGit(cwd, ['status', '--porcelain=v1', '-z', '--', '.']),
    repoPrefix(cwd)
  ]);
  if (st.unavailable) return { unavailable: true };
  if (st.code !== 0) return { isRepo: false, dirty: false, files: 0, sample: [] };

  const entries = (await expandUntracked(cwd, prefix, parseStatusZ(st.stdout)))
    .map((f) => ({ ...f, path: stripPrefix(prefix, f.path) }))
    .filter((f) => f.path);
  // 前两条文件名供总览页直接展示：同一份 porcelain 输出里取，不额外起子进程
  const sample = entries.slice(0, 2).map((f) => ({
    path: f.path,
    code: f.x === '?' && f.y === '?' ? '??' : f.x !== ' ' ? f.x : f.y
  }));
  return { isRepo: true, dirty: entries.length > 0, files: entries.length, sample };
}

/**
 * 项目文件清单（已跟踪 + 未被忽略的未跟踪文件）：给「@ 引用文件」的候选用。
 * 走 ls-files 而不是遍历目录，天然尊重 .gitignore（node_modules / 产物不会冒出来）。
 * 非仓库 / git 不可用 / 超时返回 null，调用方据此回退到目录遍历。
 */
async function lsFiles(cwd, opts) {
  if (!dirUsable(cwd)) return null;
  const r = await runGit(cwd, ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], opts);
  if (r.unavailable || r.timedOut || r.code !== 0) return null;
  const out = [];
  for (const p of String(r.stdout || '').split('\0')) {
    if (p) out.push(p);
  }
  return out;
}

/** 相对路径校验：非空、非绝对、不含 `..` */
function assertRelPath(relPath) {
  const p = String(relPath || '').trim();
  if (!p || path.isAbsolute(p) || p.split(/[\\/]/).includes('..')) {
    fail('非法的文件路径', 'bad_path', 400);
  }
  return p;
}

/** 项目相对路径 → 绝对路径；越出项目目录时返回 null（项目根自身也算在内） */
function resolveInside(cwd, relPath) {
  const root = path.resolve(cwd);
  const abs = path.resolve(root, relPath);
  return abs === root || abs.startsWith(root + path.sep) ? abs : null;
}

/** 能按图片预览的扩展名 → MIME；svg 是文本格式，额外保留源码 diff（见 fileDiff / commitFileDiff） */
const IMAGE_MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml'
};

/** 单张图片上限：再大就别把 base64 塞进 IPC，界面按「图片过大」提示 */
const IMAGE_MAX_BYTES = 8 * 1024 * 1024;

function imageMime(relPath) {
  return IMAGE_MIME[path.extname(String(relPath || '')).toLowerCase()] || null;
}

/** 文本型图片（目前只有 svg）：既给预览图，也给源码 diff —— 藏掉 diff 等于丢功能 */
function isTextImage(relPath) {
  return path.extname(String(relPath || '')).toLowerCase() === '.svg';
}

/** 图片字节 → data URL；空 / 取不到 / 超限返回 null */
function imageDataUrl(buf, mime) {
  if (!Buffer.isBuffer(buf) || !buf.length || buf.length > IMAGE_MAX_BYTES) return null;
  return 'data:' + mime + ';base64,' + buf.toString('base64');
}

/**
 * 读取某个 git 版本的文件原始字节（`HEAD:./x`、`<sha>:./x`）。
 * 不能用 runGit：它按 utf8 解码，图片会被转坏；这里用 buffer 收原始字节。
 */
function readGitBlob(cwd, spec) {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' };
  return new Promise((resolve) => {
    execFile(
      'git',
      ['-c', 'credential.interactive=false', 'show', spec],
      { cwd, windowsHide: true, maxBuffer: IMAGE_MAX_BYTES * 2, encoding: 'buffer', env },
      (err, stdout) => resolve(err ? null : Buffer.isBuffer(stdout) ? stdout : null)
    );
  });
}

/** 工作区里的图片字节；文件不存在 / 超限 / 越界返回 null */
function readLocalImage(cwd, relPath) {
  const abs = resolveInside(cwd, relPath);
  if (!abs) return null;
  try {
    const stat = fs.statSync(abs);
    if (!stat.isFile() || stat.size > IMAGE_MAX_BYTES) return null;
    return fs.readFileSync(abs);
  } catch (_) {
    return null;
  }
}

/** 图片 diff 的统一载荷：old / new 为 data URL，取不到的一侧为 null */
function imagePayload(mime, oldBuf, newBuf) {
  return {
    mime,
    old: imageDataUrl(oldBuf, mime),
    new: imageDataUrl(newBuf, mime),
    maxBytes: IMAGE_MAX_BYTES
  };
}

/** 未跟踪文件：没有 diff，直接回文件正文 */
function readUntracked(cwd, relPath) {
  const abs = resolveInside(cwd, relPath);
  if (!abs) fail('非法的文件路径', 'bad_path', 400);

  let stat;
  try {
    stat = fs.statSync(abs);
  } catch (_) {
    fail('文件不存在', 'not_found', 404);
  }
  if (stat.isDirectory()) {
    return { path: relPath, untracked: true, directory: true, binary: false, content: '', truncated: false };
  }

  const buf = fs.readFileSync(abs);
  if (buf.subarray(0, 8000).includes(0)) {
    return { path: relPath, untracked: true, directory: false, binary: true, content: '', truncated: false };
  }
  const t = trim(buf.toString('utf8'));
  return { path: relPath, untracked: true, directory: false, binary: false, content: t.text, truncated: t.truncated };
}

/**
 * 单个文件的改动内容：已跟踪 -> 统一 diff；未跟踪 -> 文件正文。
 * 图片按扩展名单独处理：不给文本 diff，改给 old / new 两份 data URL 供界面直接画图。
 */
async function fileDiff(cwd, relPath, untracked) {
  const p = assertRelPath(relPath);
  const mime = imageMime(p);
  if (untracked) {
    const res = readUntracked(cwd, p);
    if (mime && !res.directory) res.image = imagePayload(mime, null, readLocalImage(cwd, p));
    return res;
  }

  if (mime) {
    const oldBuf = await readGitBlob(cwd, 'HEAD:./' + p);
    const newBuf = readLocalImage(cwd, p);
    const out = {
      path: p,
      untracked: false,
      binary: !isTextImage(p),
      image: imagePayload(mime, oldBuf, newBuf),
      diff: '',
      truncated: false
    };
    if (!out.binary) {
      const r = await runGit(cwd, ['diff', '--no-color', '--relative', 'HEAD', '--', p]);
      if (r.unavailable) fail('未检测到 git 可执行程序', 'git_unavailable', 501);
      const t = trim(r.stdout);
      out.diff = t.text;
      out.truncated = t.truncated || !!r.overflow;
    }
    return out;
  }

  const r = await runGit(cwd, ['diff', '--no-color', '--relative', 'HEAD', '--', p]);
  if (r.unavailable) fail('未检测到 git 可执行程序', 'git_unavailable', 501);
  const t = trim(r.stdout);
  return { path: p, untracked: false, binary: false, diff: t.text, truncated: t.truncated || !!r.overflow };
}

const SHA_RE = /^[0-9a-f]{4,40}$/i;

/** 提交哈希校验 */
function assertSha(sha) {
  const s = String(sha || '').trim();
  if (!SHA_RE.test(s)) fail('非法的提交哈希', 'bad_sha', 400);
  return s;
}

/** 解析 `git diff-tree --name-status` 的行；rename/copy 为 `R100\t旧\t新` */
function parseNameStatus(stdout) {
  const list = [];
  for (const line of String(stdout || '').split('\n')) {
    if (!line) continue;
    const parts = line.split('\t');
    if (parts.length < 2) continue;
    const kind = (parts[0] || '').trim()[0];
    if (!kind) continue;
    if (kind === 'R' || kind === 'C') {
      list.push({ path: parts[2] || parts[1], origPath: parts[1] || null, status: kind });
    } else {
      list.push({ path: parts[1], origPath: null, status: kind });
    }
  }
  return list;
}

/**
 * 单个提交的文件清单（状态 + 增删行数）与提交正文。
 * `-M` 开启重命名检测；`--first-parent` 让合并提交与第一父提交比较；根提交按全量新增。
 * 正文用 `%b`（不含标题行，标题已在列表里）：标题之外的多行说明只有展开时才看得到，与文件清单一并返回。
 */
async function commitFiles(cwd, sha) {
  const s = assertSha(sha);
  const base = ['show', '--no-color', '--format=', '-M', '--first-parent', '--relative'];

  const [ns, nm, bd] = await Promise.all([
    runGit(cwd, [...base, '--numstat', s, '--', '.']),
    runGit(cwd, [...base, '--name-status', s, '--', '.']),
    runGit(cwd, ['show', '-s', '--no-color', '--format=%b', s])
  ]);
  if (ns.unavailable) fail('未检测到 git 可执行程序', 'git_unavailable', 501);
  if (ns.code !== 0) fail('提交不存在', 'commit_not_found', 404);

  const stats = parseNumstat(ns.stdout);

  const files = parseNameStatus(nm.stdout).map((e) => {
    const st = stats.get(e.path) || (e.origPath ? stats.get(e.origPath) : null) || null;
    return {
      path: e.path,
      origPath: e.origPath,
      status: e.status,
      added: st ? st.added : null,
      removed: st ? st.removed : null,
      binary: st ? st.binary : false
    };
  });

  // 正文读取失败不影响文件清单：缺正文时前端只是不渲染那块说明
  const body = bd.code === 0 ? String(bd.stdout || '').replace(/\s+$/, '') : '';
  return { sha: s, files, body };
}

/** 单个文件在某次提交里的差异内容；图片同样改给 data URL，两侧分别取自父提交与本次提交 */
async function commitFileDiff(cwd, sha, relPath) {
  const s = assertSha(sha);
  const p = assertRelPath(relPath);

  const mime = imageMime(p);
  if (mime) {
    // 根提交没有父提交、新增 / 删除的文件也只有一侧：取不到的那侧留 null，交给界面画单图
    const [oldBuf, newBuf] = await Promise.all([
      readGitBlob(cwd, s + '^:./' + p),
      readGitBlob(cwd, s + ':./' + p)
    ]);
    const out = {
      sha: s,
      path: p,
      binary: !isTextImage(p),
      image: imagePayload(mime, oldBuf, newBuf),
      diff: '',
      truncated: false
    };
    if (!out.binary) {
      const r = await runGit(cwd, ['show', '--no-color', '--format=', '-M', '--first-parent', '--relative', s, '--', p]);
      if (r.unavailable) fail('未检测到 git 可执行程序', 'git_unavailable', 501);
      if (r.code !== 0) fail('提交不存在', 'commit_not_found', 404);
      const t = trim(r.stdout);
      out.diff = t.text;
      out.truncated = t.truncated || !!r.overflow;
    }
    return out;
  }

  const r = await runGit(cwd, ['show', '--no-color', '--format=', '-M', '--first-parent', '--relative', s, '--', p]);
  if (r.unavailable) fail('未检测到 git 可执行程序', 'git_unavailable', 501);
  if (r.code !== 0) fail('提交不存在', 'commit_not_found', 404);
  const t = trim(r.stdout);
  return { sha: s, path: p, binary: false, diff: t.text, truncated: t.truncated || !!r.overflow };
}

/** 当前 HEAD 的 sha；空仓库 / 游离状态取不到时返回 null */
async function headSha(cwd) {
  const r = await runGit(cwd, ['rev-parse', 'HEAD']);
  return r.code === 0 ? r.stdout.trim() || null : null;
}

/**
 * 落后上游多少个提交：只读本地跟踪引用，不联网（要新鲜数字必须先 fetchRemote）。
 * 一条 rev-list 就能同时判定「有没有上游」：没有 @{u} 时它会直接失败，
 * 省掉一次 rev-parse —— 这个函数每轮检查要对每个项目跑一次，越轻越好。
 * 空仓库（还没有 HEAD）同样按「没有上游」处理，不让它变成一次错误。
 */
async function behindCount(cwd, opts) {
  const r = await runGit(cwd, ['rev-list', '--count', 'HEAD..@{u}'], opts);
  if (r.unavailable) return { unavailable: true, hasUpstream: false, upstream: null, behind: 0 };
  if (r.timedOut) return { hasUpstream: false, upstream: null, behind: 0, timedOut: true };
  if (r.code !== 0) return { hasUpstream: false, upstream: null, behind: 0 };
  const upstream = await upstreamRef(cwd);
  return { hasUpstream: true, upstream, behind: parseInt(r.stdout.trim(), 10) || 0 };
}

/**
 * from..to 之间的提交数。
 * remoteStatus 的 behind 只反映「本地已知的跟踪引用」，拉取前可能已经过期，
 * 所以「这次到底拉下来几个提交」只能拉完用 sha 区间算。
 */
async function countCommits(cwd, from, to) {
  if (!from || !to || from === to) return 0;
  const r = await runGit(cwd, ['rev-list', '--count', from + '..' + to]);
  return r.code === 0 ? parseInt(r.stdout.trim(), 10) || 0 : 0;
}

module.exports = {
  probe,
  isRepo,
  branch,
  headSha,
  countCommits,
  activity,
  commits,
  changes,
  statusCount,
  lsFiles,
  fileDiff,
  commitFiles,
  commitFileDiff,
  remoteStatus,
  behindCount,
  remotes,
  fetchRemote,
  pullFastForward,
  pushCurrent,
  commitAll,
  runGit
};

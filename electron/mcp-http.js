'use strict';

/**
 * MCP 服务（本地 HTTP）：给 AI agent 用的工具通道。
 *
 * 设计要点：
 * - 跑在 GUI 主进程内，请求直接走 dispatch()，与渲染端同一入口——单一写入者天然成立。
 * - 工具面只留巡检真正需要的 4 个：列项目、看单个项目、看需求、提需求。
 *   2026-11-06 收窄：删除 pm_set_requirement_status（绕过认领的第二条写路径）、
 *   pm_list_commands / pm_start_command / pm_stop_command / pm_read_logs（两份手册都禁止
 *   agent 碰命令，代码里也没有调用方；启停与日志仍在启动台里做）。
 * - 绑 0.0.0.0、端口固定 7318。不做顺延：agent 客户端配置里写死了这个 URL，
 *   顺延只会让已注册的配置静默失联，比直接报错更糟。
 *   绑定全接口是为了让手机在同一局域网能直连；非回环来源只能走远程面（见 isLoopback）。
 * - 无状态 Streamable HTTP：POST 收 JSON-RPC 直接回 JSON（无服务端推送，不需要 SSE）；
 *   通知（无 id）回 202；GET/DELETE 回 405（/prompt/* 与下面几个动作端点除外）。
 * - 提示词统一按 id 寻址：resources/read 与 GET /prompt/<id>.txt 指向同一份注册表
 *   （electron/prompts.js），热更新后 agent 端无需任何改动。加新提示词只需在注册表里加一项，
 *   这里不用改。
 * - 动作端点分两种方法（2026-11-06 起）：只带 id 与名字的用 GET（/claim、/next），
 *   带正文的用 POST + JSON（/complete、/ask、/release）—— 正文不再经过 percent-encode，
 *   中文只按 UTF-8 写进 body，少一道 GBK 手拼 URL 的坑。
 *   /next 取即认领，没有活时在服务端长等（默认 5 分钟，`wait=秒` 可调），有变更立即返回；
 *   /release 把做不下去的任务放回未开始；/ask 把「要人拍板的问题」
 *   （可带候选与超时默认，也可同时挂多条）写进往返记录，并在服务端等最多 1 小时；/complete 交付后
 *   同样挂起，最多等 2 小时验收——用户通过就结束，继续回复就带回意见让 agent 接着改并再次交付。
 * - URI 统一加 project-manager 命名空间：pm:// 是最常见的缩写之一，裸 pm://prompt/scout 容易撞名。
 *
 * 远程面（/remote/*，2026-11-16 加）：
 * - 只有经隧道进来的请求（带 CF-Connecting-IP / X-Forwarded-For / CF-Ray 之一）走这一套；
 *   本机请求完全不受影响，仍按上面的老路径走。
 * - 隧道进来的请求只放行 /remote/*，其余一律 403 —— /claim、/next、/ask、/complete 是给本机
 *   agent 用的长轮询与写路径，公网边缘 100 秒就断，放出去只会留下挂死的等待器；/complete
 *   还会触发 git commit + push。
 * - 除 /remote/hello 外都要 X-PM-Token 头（或 ?token=），令牌由 domain/remote.js 管理；
 *   关闭远程访问时连令牌都不认。
 * - 远程动作只到「采纳 / 拒绝」：验收走 answerRemote，它先提交并推送工作区改动再落库，
 *   绕过它直接改 done 会让改动停在未提交状态。
 */

const http = require('http');
const crypto = require('crypto');
const { PRIMARY_ID } = require('./prompts');
const { ASK_TIMEOUT } = require('./services/domain/ask-waiter');
const { REVIEW_TIMEOUT } = require('./services/domain/review-waiter');

/** MCP 握手对外报的应用版本：跟 package.json 同源，避免再出现一处硬编码版本漂移 */
const VERSION = require('../package.json').version;
const PORT = 7318;
const BODY_LIMIT = 1024 * 1024;

/** 资源 URI 前缀：resources/list 按注册表动态生成 */
const RESOURCE_PREFIX = 'pm://project-manager/prompt/';
const RESOURCE_RE = /^pm:\/\/project-manager\/prompt\/([A-Za-z0-9._-]+)$/;

/** 给 agent 的握手引导：部分客户端会把它注入系统提示，属于免费增强，不作为唯一通道 */
const INSTRUCTIONS =
  '项目管理台（project-manager）。执行项目巡检前，先 GET http://127.0.0.1:7318/prompt/' +
  PRIMARY_ID +
  '.txt 获取当前的执行手册并严格按它执行。';

const TOOLS = [
  {
    name: 'pm_list_projects',
    description:
      '列出项目管理台里的项目（默认不含已归档），包含需求与命令的计数、AI 巡检开关（aiScout=false 表示该项目已停用 AI 提需求）。',
    inputSchema: {
      type: 'object',
      properties: { includeArchived: { type: 'boolean', description: '是否包含已归档项目' } },
      additionalProperties: false
    },
    method: 'projects',
    params: (a) => ({ includeArchived: !!a.includeArchived })
  },
  {
    name: 'pm_get_project',
    description: '按项目 id 取单个项目的详情（含 AI 巡检开关 aiScout、各项需求计数，以及关联项目 / 环境变量 / 规则等扩展信息；规则正文为 Markdown，含 {UseSkill:x} 的会附 skills 解析）。',
    inputSchema: {
      type: 'object',
      properties: { projectId: { type: 'string' } },
      required: ['projectId'],
      additionalProperties: false
    },
    method: 'project',
    params: (a) => ({ id: a.projectId })
  },
  {
    name: 'pm_list_requirements',
    description:
      '列出某个项目的需求，可按状态过滤（candidate/todo/doing/review/done/rejected；review 为 agent 交付待用户审核；candidate 为候选池，只有显式传 candidate 才返回）或只看未完成的。不传状态时不含候选池。',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        status: { type: 'string', description: '逗号分隔的状态，如 "todo,doing,review"' },
        pending: { type: 'boolean', description: '只看未完成（未开始 / 进行中 / 待审核）的需求' }
      },
      required: ['projectId'],
      additionalProperties: false
    },
    method: 'allRequirements',
    params: (a) => ({ projectId: a.projectId, status: a.status, pending: !!a.pending })
  },
  {
    name: 'pm_create_requirement',
    description:
      '给项目提一条新需求。AI 提交的需求（source=ai）会进「候选池」，不直接开工，等用户在需求中心采纳后才进入未开始、才会被 agent 认领。一个项目可以同时有多条未完成需求，不限制条数。若项目 aiScout=false（已停用 AI 提需求），巡检应跳过，不要提交。',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        title: { type: 'string' },
        body: { type: 'string', description: '需求正文（可选）' },
        note: { type: 'string', description: '备注（可选）' },
        source: { type: 'string', enum: ['manual', 'ai'], description: '来源，AI 巡检建议填 ai' }
      },
      required: ['projectId', 'title'],
      additionalProperties: false
    },
    method: 'createRequirement',
    params: (a) => ({
      id: a.projectId,
      data: { title: a.title, body: a.body, note: a.note, source: a.source || 'ai' }
    })
  }
];

const TOOL_MAP = new Map(TOOLS.map((t) => [t.name, t]));

function rpcError(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

async function toolCall(dispatch, params) {
  const name = params && params.name;
  const args = (params && params.arguments) || {};
  const def = TOOL_MAP.get(name);
  if (!def) {
    return { content: [{ type: 'text', text: '未知工具：' + name }], isError: true };
  }

  const res = await dispatch(def.method, def.params(args));
  if (!res || !res.ok) {
    const text = (res && res.message) || '调用失败';
    const code = res && res.code ? ' [' + res.code + ']' : '';
    return { content: [{ type: 'text', text: text + code }], isError: true };
  }
  const data = def.mapResult ? def.mapResult(res.data) : res.data;
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], isError: false };
}

async function handle(dispatch, msg, prompts) {
  switch (msg.method) {
    case 'initialize':
      return {
        protocolVersion: (msg.params && msg.params.protocolVersion) || '2025-06-18',
        capabilities: { tools: {}, resources: {}, prompts: {} },
        serverInfo: { name: 'project-manager', version: VERSION },
        instructions: INSTRUCTIONS
      };
    case 'ping':
      return {};
    case 'tools/list':
      return {
        tools: TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema
        }))
      };
    case 'tools/call':
      return toolCall(dispatch, msg.params);
    case 'resources/list':
      return {
        resources: (prompts ? prompts.list() : []).map((p) => ({
          uri: RESOURCE_PREFIX + p.id,
          name: p.name,
          description: p.description,
          mimeType: 'text/markdown'
        }))
      };
    case 'resources/read': {
      const uri = msg.params && msg.params.uri;
      const m = RESOURCE_RE.exec(String(uri || ''));
      const r = m && prompts ? prompts.read(m[1]) : null;
      if (!r) throw rpcError(-32002, '未知资源：' + uri);
      return { contents: [{ uri, mimeType: 'text/markdown', text: r.text }] };
    }
    case 'prompts/list':
      return {
        prompts: (prompts ? prompts.list() : []).map((p) => ({
          name: p.id,
          title: p.name,
          description: p.description,
          arguments: []
        }))
      };
    case 'prompts/get': {
      const name = msg.params && msg.params.name;
      const r = prompts ? prompts.read(name) : null;
      if (!r) throw rpcError(-32602, '未知提示词：' + name);
      return {
        description: r.name,
        messages: [{ role: 'user', content: { type: 'text', text: r.text } }]
      };
    }
    default:
      throw rpcError(-32601, '不支持的方法：' + msg.method);
  }
}

function json(res, status, obj) {
  const body = obj === undefined ? '' : JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > BODY_LIMIT) {
        reject(Object.assign(new Error('请求体过大'), { code: -32600 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** 浏览器跨站发起的请求会带 Origin；MCP 客户端一般不带。非本机来源一律拒绝。 */
function originAllowed(origin) {
  if (!origin) return true;
  try {
    const u = new URL(origin);
    return u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '[::1]';
  } catch (_) {
    return false;
  }
}

/**
 * 是否回环调用（本机 agent / curl）。
 *
 * 服务绑 0.0.0.0 之后，同局域网的手机也能连进来，但它们绝不该拿到本机 agent 那套能力：
 * 所以「本机」只认回环地址，其余一律按远程面处理。
 */
function isLoopback(req) {
  const addr = (req.socket && req.socket.remoteAddress) || '';
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

/**
 * 是否来自隧道（而不是本机直接调用）。
 *
 * 隧道在本机反代，`req.socket.remoteAddress` 永远是 127.0.0.1，判不出来；只能看代理注入的头。
 * cloudflared 会带 CF-Connecting-IP / CF-Ray / X-Forwarded-For，本机 agent 与 curl 都不带。
 * 三个头认一个即可：自建反代（frp、nginx）常常只补 X-Forwarded-For。
 */
function forwarded(req) {
  const h = req.headers;
  return !!(h['cf-connecting-ip'] || h['cf-ray'] || h['x-forwarded-for'] || h['x-real-ip']);
}

/** 远程面允许写入的状态：采纳（候选 → 未开始）与拒绝。其余状态只在本机改 */
const REMOTE_STATUS_TARGETS = new Set(['todo', 'rejected']);

/** 手机端能做的四种答复，与 mobile-protocol 的 ANSWER 决策同一套词 */
const REMOTE_DECISIONS = new Set(['answer', 'approve', 'feedback', 'reject']);

/** 长轮询上限：必须明显小于公网边缘的 100 秒，留出网络与排队余量 */
const REMOTE_WAIT_MAX_MS = 30 * 1000;
const REMOTE_WAIT_DEFAULT_MS = 20 * 1000;
/** 轮询内部检查待办的间隔：够实时，又不至于把领域层搅成忙等 */
const REMOTE_WAIT_STEP_MS = 1200;

/** 远程面只读为主，写操作只有「改状态」与「答复」两类 */
const REMOTE_ROUTES = [
  { re: /^\/remote\/hello$/, action: 'hello' },
  { re: /^\/remote\/projects$/, action: 'projects' },
  { re: /^\/remote\/project\/([^/]+)\/requirements$/, action: 'requirements' },
  { re: /^\/remote\/project\/([^/]+)\/changes$/, action: 'changes' },
  { re: /^\/remote\/project\/([^/]+)\/diff$/, action: 'diff' },
  { re: /^\/remote\/project\/([^/]+)\/commits$/, action: 'commits' },
  { re: /^\/remote\/project\/([^/]+)\/commit-diff$/, action: 'commitDiff' },
  { re: /^\/remote\/project\/([^/]+)\/commands$/, action: 'commands' },
  { re: /^\/remote\/requirement\/([^/]+)\/status$/, action: 'requirementStatus' },
  { re: /^\/remote\/requirement\/([^/]+)\/answer$/, action: 'requirementAnswer' },
  { re: /^\/remote\/command\/([^/]+)\/runs$/, action: 'runs' },
  { re: /^\/remote\/command\/([^/]+)\/logs$/, action: 'logs' },
  { re: /^\/remote\/pending$/, action: 'pending' },
  { re: /^\/remote\/wait$/, action: 'wait' }
];

function decodeParam(value) {
  try {
    return decodeURIComponent(value);
  } catch (_) {
    return value;
  }
}

function flag(value) {
  return value === '1' || value === 'true';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 待办指纹：只给客户端一个「变没变」的判据，所以取 id 集合的短哈希即可。
 * 内容变化必然换 id（review 带交付时间、question 带提问 id），指纹也就跟着变。
 */
function pendingKey(messages) {
  const ids = messages.map((m) => String(m.id || '')).sort().join('|');
  return crypto.createHash('sha1').update(ids).digest('hex').slice(0, 12);
}

/** 读 JSON 请求体；任何一步不合法都已经写好响应并返回 null */
async function readJsonObject(req, res) {
  const ctype = String(req.headers['content-type'] || '');
  if (!ctype.includes('application/json')) {
    json(res, 415, { ok: false, code: 'unsupported_media_type', message: '请求体必须是 application/json' });
    return null;
  }
  let body;
  try {
    body = JSON.parse((await readBody(req)) || '{}');
  } catch (_) {
    json(res, 400, { ok: false, code: 'bad_json', message: '请求体不是合法 JSON' });
    return null;
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    json(res, 400, { ok: false, code: 'bad_json', message: '请求体必须是 JSON 对象' });
    return null;
  }
  return body;
}

/**
 * 远程面入口。返回 true 表示这条请求已经处理完（调用方不必再往下走）。
 *
 * 顺序刻意是「先认证、再解析参数」：没令牌的扫描流量拿不到任何关于数据形状的反馈，
 * 连「这个项目 id 存不存在」都问不出来。
 */
async function serveRemote(dispatch, req, res, url, search) {
  const hit = REMOTE_ROUTES.map((r) => ({ r, m: r.re.exec(url) })).find((x) => x.m);
  if (!hit) {
    json(res, 404, { ok: false, code: 'remote_not_found', message: '远程面没有这个接口：' + url });
    return true;
  }
  const action = hit.r.action;
  const param = hit.m[1] ? decodeParam(hit.m[1]) : '';

  // 健康检查：给隧道自检与客户端连通性探测用，不含任何业务数据，所以不要求令牌
  if (action === 'hello') {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      json(res, 405, { ok: false, code: 'method_not_allowed', message: '这个端点只支持 GET' });
      return true;
    }
    json(res, 200, { ok: true, name: 'project-manager', version: VERSION, remote: true });
    return true;
  }

  const token = String(req.headers['x-pm-token'] || search.get('token') || '');
  const auth = await dispatch('remoteAuth', { token });
  if (!auth || !auth.ok) {
    json(res, (auth && auth.status) || 401, {
      ok: false,
      code: (auth && auth.code) || 'remote_unauthorized',
      message: (auth && auth.message) || '未授权'
    });
    return true;
  }

  switch (action) {
    case 'projects':
      if (req.method !== 'GET') return methodNotAllowed(res, 'GET');
      await respond(dispatch, res, {
        method: 'projects',
        params: { includeArchived: flag(search.get('includeArchived')) },
        failMsg: '读取项目列表失败'
      });
      return true;

    case 'requirements': {
      if (req.method !== 'GET') return methodNotAllowed(res, 'GET');
      const status = search.get('status') || undefined;
      await respond(dispatch, res, {
        method: 'allRequirements',
        params: {
          projectId: param,
          status,
          pending: flag(search.get('pending'))
        },
        failMsg: '读取需求列表失败'
      });
      return true;
    }

    case 'changes':
      if (req.method !== 'GET') return methodNotAllowed(res, 'GET');
      await respond(dispatch, res, { method: 'gitChanges', params: { id: param }, failMsg: '读取改动失败' });
      return true;

    case 'diff':
      if (req.method !== 'GET') return methodNotAllowed(res, 'GET');
      await respond(dispatch, res, {
        method: 'gitDiff',
        params: { id: param, path: search.get('path'), untracked: flag(search.get('untracked')) },
        failMsg: '读取 diff 失败'
      });
      return true;

    case 'commits':
      if (req.method !== 'GET') return methodNotAllowed(res, 'GET');
      await respond(dispatch, res, {
        method: 'gitCommits',
        params: { id: param, limit: search.get('limit'), skip: search.get('skip') },
        failMsg: '读取提交记录失败'
      });
      return true;

    case 'commitDiff':
      if (req.method !== 'GET') return methodNotAllowed(res, 'GET');
      await respond(dispatch, res, {
        method: 'gitCommitDiff',
        params: { id: param, sha: search.get('sha'), path: search.get('path') },
        failMsg: '读取提交 diff 失败'
      });
      return true;

    case 'commands':
      if (req.method !== 'GET') return methodNotAllowed(res, 'GET');
      await respond(dispatch, res, { method: 'commands', params: { id: param }, failMsg: '读取命令列表失败' });
      return true;

    case 'runs':
      if (req.method !== 'GET') return methodNotAllowed(res, 'GET');
      await respond(dispatch, res, { method: 'commandRuns', params: { cid: param }, failMsg: '读取运行记录失败' });
      return true;

    case 'logs': {
      if (req.method !== 'GET') return methodNotAllowed(res, 'GET');
      const runId = search.get('runId') || undefined;
      await respond(dispatch, res, {
        method: 'logs',
        params: { cid: param, runId },
        failMsg: '读取命令输出失败'
      });
      return true;
    }

    case 'requirementStatus': {
      if (req.method !== 'POST') return methodNotAllowed(res, 'POST');
      const body = await readJsonObject(req, res);
      if (!body) return true;
      const status = String(body.status || '').trim();
      if (!REMOTE_STATUS_TARGETS.has(status)) {
        json(res, 400, {
          ok: false,
          code: 'bad_remote_status',
          message: '远程只能采纳（todo）或拒绝（rejected），收到：' + (status || '(空)')
        });
        return true;
      }
      await respond(dispatch, res, {
        method: 'setRequirementStatus',
        params: { rid: param, status, note: body.note },
        failMsg: '修改需求状态失败'
      });
      return true;
    }

    /**
     * 手机端答复：提问与审核共用一个入口，靠 decision 区分。
     *
     * 走 answerRemote 而不是自己拼消息：通过时「先提交并推送再落库」只有一份实现，
     * 换成 HTTP 传输也不该出现第二套口径。
     */
    case 'requirementAnswer': {
      if (req.method !== 'POST') return methodNotAllowed(res, 'POST');
      const body = await readJsonObject(req, res);
      if (!body) return true;
      const decision = String(body.decision || '').trim();
      if (!REMOTE_DECISIONS.has(decision)) {
        json(res, 400, {
          ok: false,
          code: 'bad_remote_decision',
          message: 'decision 只能是 answer / approve / feedback / reject，收到：' + (decision || '(空)')
        });
        return true;
      }
      await respond(dispatch, res, {
        method: 'answerRemote',
        params: { rid: param, decision, text: body.text, questionId: body.questionId },
        failMsg: '提交答复失败'
      });
      return true;
    }

    /** 待办快照：手机首次进页面、或长轮询超时后重新对齐用 */
    case 'pending': {
      if (req.method !== 'GET') return methodNotAllowed(res, 'GET');
      const out = await dispatch('remotePendingTickets', {});
      if (!out || !out.ok) {
        json(res, (out && out.status) || 500, {
          ok: false,
          code: (out && out.code) || 'internal_error',
          message: (out && out.message) || '读取待办失败'
        });
        return true;
      }
      // 领域层叫 tickets，对手机仍然叫 messages：一条待办就是一条待处理消息，沿用旧字段省一次客户端改造
      const messages = (out.data && (out.data.tickets || out.data.messages)) || [];
      json(res, 200, { ok: true, key: pendingKey(messages), messages, count: messages.length });
      return true;
    }

    /**
     * 长轮询：有变化立即返回，没变化最多挂 wait 秒（默认 20、上限 30）。
     *
     * 用长轮询而不是 SSE/WebSocket：公网边缘对单条 HTTP 请求限 100 秒，长连接会被周期性掐断，
     * 断线窗口里丢的通知要另外补一套补偿；长轮询每轮都是一条普通请求，穿任何代理都安全，
     * 客户端拿到响应立刻发下一轮，体感与推送一致。
     * key 是待办指纹：客户端回传上一轮的 key，相同就继续等，不同就说明有新东西。
     */
    case 'wait': {
      if (req.method !== 'GET') return methodNotAllowed(res, 'GET');
      const sec = Number(search.get('wait'));
      const budget = Math.min(
        Math.max(Number.isFinite(sec) && sec > 0 ? sec * 1000 : REMOTE_WAIT_DEFAULT_MS, 1000),
        REMOTE_WAIT_MAX_MS
      );
      const since = String(search.get('key') || '');
      const deadline = Date.now() + budget;
      let closed = false;
      req.on('close', () => {
        closed = true;
      });

      for (;;) {
        const out = await dispatch('remotePendingTickets', {});
        if (closed) return true;
        if (!out || !out.ok) {
          json(res, (out && out.status) || 500, {
            ok: false,
            code: (out && out.code) || 'internal_error',
            message: (out && out.message) || '读取待办失败'
          });
          return true;
        }
        const messages = (out.data && out.data.tickets) || [];
        const key = pendingKey(messages);
        const expired = Date.now() >= deadline;
        if (key !== since || expired) {
          json(res, 200, { ok: true, key, messages, count: messages.length, timedOut: expired && key === since });
          return true;
        }
        await sleep(REMOTE_WAIT_STEP_MS);
      }
    }

    default:
      json(res, 404, { ok: false, code: 'remote_not_found', message: '远程面没有这个接口' });
      return true;
  }
}

function methodNotAllowed(res, allowed) {
  json(res, 405, { ok: false, code: 'method_not_allowed', message: '这个端点只支持 ' + allowed });
  return true;
}

/** 不支持 MCP 工具/resources 的 agent 的兜底通道：GET /prompt/<id>.txt 直接拿纯文本 */
const PROMPT_ROUTE_RE = /^\/prompt\/([A-Za-z0-9._-]+)\.txt$/;

/**
 * 单条技能查询：`GET /skill/<source>/<name>`（也接受裸名）。
 * AGENT_ROUTES 是精确路径表，表达不了带参路径，所以单独一条正则兜住。
 * 与 `/skills`、`/skills/rescan` 不冲突：那条表在前，且都带不上的才落到这里。
 */
const SKILL_ROUTE_RE = /^\/skill\/([^/?#]+(?:\/[^/?#]+)?)$/;

function servePrompt(res, prompts, id) {
  const r = prompts ? prompts.read(id) : null;
  if (!r) return json(res, 404, { error: 'unknown prompt: ' + id });
  res.writeHead(200, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Prompt-Id': r.id
  });
  res.end(r.text);
}

/**
 * 给执行 agent 的动作端点：失败透出 status/code/message（冲突时附带当前认领者），
 * 成功回 { ok, ...data }。两种方法分开读参数：
 * - GET + query：只传 id 与名字的动作（/claim、/next），一条 URL 就能调；
 * - POST + JSON body：带正文的动作（/complete、/ask、/release），正文不必再 percent-encode。
 * 两者都先校验方法，再交给 dispatch。
 */
async function respond(dispatch, res, { method, params, failMsg }) {
  const out = await dispatch(method, params);
  if (!out || !out.ok) {
    return json(res, (out && out.status) || 500, {
      ok: false,
      code: (out && out.code) || 'internal_error',
      message: (out && out.message) || failMsg,
      ...(out && out.claim ? { claim: out.claim } : {})
    });
  }
  return json(res, 200, { ok: true, ...out.data });
}

async function agentGet(dispatch, req, res, route) {
  if (req.method !== 'GET') {
    return json(res, 405, { ok: false, code: 'method_not_allowed', message: '这个端点只支持 GET' });
  }
  const q = new URL(req.url, 'http://127.0.0.1').searchParams;
  return respond(dispatch, res, { method: route.method, params: route.params(q), failMsg: route.failMsg });
}

async function agentPost(dispatch, req, res, route) {
  if (req.method !== 'POST') {
    return json(res, 405, { ok: false, code: 'method_not_allowed', message: '这个端点只支持 POST' });
  }
  const ctype = String(req.headers['content-type'] || '');
  if (!ctype.includes('application/json')) {
    return json(res, 415, { ok: false, code: 'unsupported_media_type', message: '请求体必须是 application/json' });
  }
  let body;
  try {
    body = JSON.parse((await readBody(req)) || '{}');
  } catch (_) {
    return json(res, 400, { ok: false, code: 'bad_json', message: '请求体不是合法 JSON' });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json(res, 400, { ok: false, code: 'bad_json', message: '请求体必须是 JSON 对象' });
  }
  return respond(dispatch, res, { method: route.method, params: route.params(body), failMsg: route.failMsg });
}

/**
 * 给执行 agent 的动作端点：路径 → 领域方法、入参与方法。
 * mode=query 走 GET（只有 id 与名字），mode=json 走 POST + JSON body（带正文）。
 */
const AGENT_ROUTES = {
  '/claim': {
    mode: 'query',
    method: 'claimRequirement',
    params: (q) => ({ rid: q.get('taskId'), agent: q.get('agent') }),
    failMsg: '认领失败'
  },
  '/complete': {
    mode: 'json',
    method: 'completeRequirement',
    // note 是给用户的会话回复，commitMessage 是独立的 git 提交信息：两者不共用一条通道
    params: (b) => ({
      rid: b.taskId,
      agent: b.agent,
      note: b.note,
      commitMessage: b.commitMessage
    }),
    failMsg: '提交完成失败'
  },
  '/next': {
    mode: 'query',
    method: 'nextRequirement',
    params: (q) => ({ agent: q.get('agent'), wait: q.get('wait') }),
    failMsg: '取任务失败'
  },
  '/ask': {
    mode: 'json',
    method: 'askRequirement',
    // default 是超时兜底（与手册同名，也接受 fallback）；wait 是秒，可缩短单次等待
    params: (b) => ({
      rid: b.taskId,
      agent: b.agent,
      text: b.text,
      options: b.options,
      fallback: b.default !== undefined ? b.default : b.fallback,
      waitMs:
        b.wait === undefined || b.wait === null || b.wait === '' ? undefined : Number(b.wait) * 1000
    }),
    failMsg: '提问失败'
  },
  '/release': {
    mode: 'json',
    method: 'releaseRequirement',
    params: (b) => ({ rid: b.taskId, agent: b.agent, note: b.note }),
    failMsg: '释放任务失败'
  },
  /**
   * 技能清单：需求正文里的 `{UseSkill:x}` 由服务端解析，正常情况下 agent 从 `/next`
   * 返回的 `requirement.skills` 就能拿到目录，这两个端点是对账与重扫用的。
   */
  '/skills': {
    mode: 'query',
    method: 'skills',
    params: () => ({}),
    failMsg: '读取技能清单失败'
  },
  '/skills/rescan': {
    mode: 'query',
    method: 'rescanSkills',
    params: () => ({}),
    failMsg: '重新扫描技能失败'
  },
  /** 本机装了哪些客户端（候选列表，不建 Agent、不扫技能） */
  '/clients': {
    mode: 'query',
    method: 'clients',
    params: () => ({}),
    failMsg: '读取本机客户端失败'
  }
};

/**
 * @param {(method: string, params: object) => Promise<any>} dispatch
 * @param {(msg: string) => void} log
 * @param {{read: Function, list: Function, ids: Function, seed: Function, dir: Function}} prompts 提示词存贮
 */
function startMcpHttp(dispatch, log, prompts) {
  const server = http.createServer(async (req, res) => {
    const url = (req.url || '').split('?')[0];
    if (!originAllowed(req.headers.origin)) return json(res, 403, { error: 'forbidden origin' });

    // 远程面收口：非回环来源（局域网手机、隧道）只放行 /remote/，本机调用照旧走老路由
    const search = new URL(req.url, 'http://127.0.0.1').searchParams;
    if (!isLoopback(req) || forwarded(req)) {
      if (!url.startsWith('/remote/')) {
        return json(res, 403, {
          ok: false,
          code: 'remote_forbidden',
          message: '公网入口只开放 /remote/ 下的接口；认领、交付、提问请在本机调用'
        });
      }
      return serveRemote(dispatch, req, res, url, search);
    }
    if (url.startsWith('/remote/')) return serveRemote(dispatch, req, res, url, search);

    const promptMatch = PROMPT_ROUTE_RE.exec(url);
    if (promptMatch) {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return json(res, 405, { error: 'method not allowed, use GET' });
      }
      return servePrompt(res, prompts, promptMatch[1]);
    }

    // 执行 agent 的动作端点：认领 / 交付 / 自动派发 / 提问 / 释放
    const route = AGENT_ROUTES[url];
    if (route) return (route.mode === 'json' ? agentPost : agentGet)(dispatch, req, res, route);

    // 单条技能查询：带上目录与 entry，缺技能时 agent 靠它去读 SKILL.md
    const skillMatch = SKILL_ROUTE_RE.exec(url);
    if (skillMatch) {
      if (req.method !== 'GET') {
        return json(res, 405, { ok: false, code: 'method_not_allowed', message: '这个端点只支持 GET' });
      }
      let id = skillMatch[1];
      try {
        id = decodeURIComponent(id);
      } catch (_) {
        /* 编码坏了就按原文查，查不到自然会回 found:false */
      }
      return respond(dispatch, res, { method: 'skill', params: { id }, failMsg: '查询技能失败' });
    }

    if (url !== '/mcp') return json(res, 404, { error: 'not found' });

    if (req.method !== 'POST') {
      // 无状态模式：不接受 SSE 流（GET）与 Session 结束（DELETE）
      return json(res, 405, { error: 'method not allowed, use POST /mcp' });
    }

    const ctype = String(req.headers['content-type'] || '');
    if (!ctype.includes('application/json')) {
      return json(res, 415, { error: 'unsupported media type, use application/json' });
    }

    let msg;
    try {
      msg = JSON.parse(await readBody(req));
    } catch (e) {
      return json(res, 400, { jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' } });
    }

    // 通知（无 id）：无需响应体，202 Accepted
    if (msg.id === undefined || msg.id === null) return json(res, 202, undefined);

    try {
      const result = await handle(dispatch, msg, prompts);
      json(res, 200, { jsonrpc: '2.0', id: msg.id, result });
    } catch (e) {
      json(res, 200, {
        jsonrpc: '2.0',
        id: msg.id,
        error: { code: e.code || -32603, message: e.message || 'internal error' }
      });
    }
  });

  // /ask 最多等 1 小时、/complete 最多等 2 小时：Node 默认 requestTimeout 只有 300s，
  // 必须按最长等待抬上去再留余量，否则一次正常等待会被请求级超时提前掐断。
  // 只影响「收请求」，不影响并发。
  server.requestTimeout = Math.max(ASK_TIMEOUT, REVIEW_TIMEOUT) + 10 * 60 * 1000;
  server.timeout = 0;

  return new Promise((resolve, reject) => {
    // 失败时把尝试的端口挂到 error 上：界面要原样显示「哪个端口」，不该从文案里抠数字
    const onError = (e) => {
      if (e.code === 'EADDRINUSE') {
        reject(Object.assign(new Error('端口已被其他程序占用'), { port: PORT }));
        return;
      }
      reject(Object.assign(e, { port: PORT }));
    };
    server.once('error', onError);
    // 绑 0.0.0.0 而不是回环：手机在同一局域网时要能直连 /remote。
    // 非回环来源一律按远程面处理（见 isLoopback），拿不到令牌就只能碰到 /remote/hello。
    server.listen(PORT, '0.0.0.0', () => {
      server.removeListener('error', onError);
      log('[main] MCP HTTP 服务：http://127.0.0.1:' + PORT + '/mcp');
      resolve({
        port: PORT,
        url: 'http://127.0.0.1:' + PORT + '/mcp',
        close: () => new Promise((settle) => {
          let settled = false;
          const done = () => {
            if (settled) return;
            settled = true;
            clearTimeout(force);
            settle();
          };
          /**
           * 不能只等 server.close 的完成回调：它要等所有连接自然结束，而 /next、/remote/wait
           * 的长轮询会挂住几分钟，/ask 挂 1 小时、/complete 挂 2 小时。应用退出（含自动更新
           * 的「重启并安装」）会被这些连接拖住，表现为点了没反应。这里给 500ms 让在途响应
           * 发完，然后强制断开剩余连接。
           */
          const force = setTimeout(() => {
            if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
            done();
          }, 500);
          if (force.unref) force.unref();
          server.close(done);
        })
      });
    });
  });
}

module.exports = { startMcpHttp, TOOLS, handle };

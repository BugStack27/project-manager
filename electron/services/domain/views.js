'use strict';

const store = require('../store');
const runner = require('../runner');
const { CANDIDATE, UNFINISHED } = require('./constants');
const { agentNameMap } = require('./lookups');
const { resolveRefs, resolveReqRefs, resolveFileRefs } = require('./refs');
const { resolveSkills } = require('./skill-refs');
const { REVIEW_TIMEOUT } = require('./review-waiter');
const { listQuestions } = require('./questions');
const { detectProfile } = require('../project-detect');

/**
 * 技能解析的文本源：正文 + 最近一次打回 / 继续回复意见。
 *
 * 打回时用户会用 `/` 在回复框里点名技能（「改用这个技能重做」），只在正文里解析的话，
 * 那个 token 就只是一句散文 —— agent 拿不到 entry，只能反过来提问。
 * 只并「当前这条」意见而不是整条 thread：feedback 每次打回都会被替换，
 * 并入历史消息会让早已作废的技能一直挂在「使用技能」里。
 */
function skillText(r) {
  const body = String(r.body || '');
  const feedback = r.feedback && r.feedback.note ? String(r.feedback.note) : '';
  return feedback ? body + '\n' + feedback : body;
}

function reqView(r) {
  const db = store.get();
  // agentName 只给界面展示：接口仍以 agent（AgentID）为身份，注册表里没有该 ID 时留空由前端回落
  const names = agentNameMap();
  const nameOf = (id) => (id && names.get(id)) || '';
  /** 待回答的提问可以有多条：每条独立 id、独立超时，回答时按 id 指定 */
  const questions = listQuestions(r).map((q) => ({
    id: q.id,
    agent: q.agent,
    agentName: nameOf(q.agent),
    at: q.at,
    text: q.text || '',
    options: q.options || [],
    default: q.default || '',
    /** 提问正文里的 `{UseSkill:x}`：回答框上方按 markdown 渲染，需要解析结果 */
    skills: resolveSkills(q.text || ''),
    /** 到点还没人回答，就按 default 收尾（没有 default 则作废） */
    expiresAt: q.expiresAt || null
  }));
  return {
    id: r.id,
    projectId: r.projectId,
    seq: r.seq,
    title: r.title,
    body: r.body || '',
    /**
     * 正文里 `@{项目名}` 的解析结果：不只给 `path`，还带该项目当前未完成的需求，
     * agent 一眼能判断「它是做什么的、还在忙什么」，再决定读哪里；界面据此渲染可点的 chip。
     * 解析失败的条目 projectId / path 为 null（名字打错或项目已删）。
     * 一律由服务端算：正则边界与重名规则只在这里一处，前端与 agent 读到的是同一份结论。
     */
    refs: resolveRefs(r.body, { projects: db.projects, requirements: db.requirements }),
    /**
     * 正文里 `@{#序号}` 的解析结果：只认本项目的需求，给 id / seq / 标题 / 状态 / 正文。
     * 与 refs 同一条纪律：服务端解析一处、不存副本，序号对不上（归档 / 删除 / 写错）时 exists:false。
     */
    reqRefs: resolveReqRefs(r.body, r.projectId, { requirements: db.requirements }),
    /**
     * 正文里 `@{file:相对路径}` 的解析结果：只给本项目文件的绝对路径 + 是否存在，不预读内容。
     * 路径越界 / 密钥类文件分别标 bad_path / restricted，agent 据此判断能不能读。
     */
    fileRefs: resolveFileRefs(r.body, db.projects.find((p) => p.id === r.projectId) || null),
    /**
     * `{UseSkill:x}` 的解析结果（解析源见上面的 `skillText`：正文 + 当前打回意见）：
     * 技能目录随视图一起下发，认领的 agent 不必再问一次「这个技能在哪」。
     * 不按认领人过滤 —— 技能是目录，任何 agent 拿到的都是同一个 `dir` / `entry`。
     * 与 refs 一样只在服务端解析一处，不存副本。
     */
    skills: resolveSkills(skillText(r)),
    note: r.note || '',
    source: r.source || 'manual',
    status: r.status,
    claim: r.claim
      ? { agent: r.claim.agent, agentName: nameOf(r.claim.agent), at: r.claim.at }
      : null,
    /**
     * 解锁通行证：有值表示用户已授权下一轮把这条进行中的任务还给认领人，且是一次性的
     * （`/next` 取走即销）。`status === 'doing'` 而没有它，就是「项目锁着、等人工解锁」。
     */
    unlock: r.unlock ? { at: r.unlock.at, by: r.unlock.by || 'manual' } : null,
    /**
     * agent 交付记录：只在调过完成接口后存在，待审核时用户据此判断。
     * note 是会话回复（也进 thread），commitMessage 是独立的 git 提交信息，
     * 只供提交弹窗 / 验收提交预填——不进 thread、不进 reviews 摘要。
     */
    completion: r.completion
      ? {
          agent: r.completion.agent,
          agentName: nameOf(r.completion.agent),
          at: r.completion.at,
          note: r.completion.note || '',
          commitMessage: r.completion.commitMessage || '',
          /** 会话回复里点名的技能：待审核时这条还没进往返记录，块内也要能渲染成 chip */
          skills: resolveSkills(r.completion.note || '')
        }
      : null,
    /**
     * 关联提交：只记真正产生过新提交的那些（带需求上下文的提交成功后自动写入），
     * 按时间倒序、上限 20 条。只给界面展示与跳转用，不参与派发与状态判断。
     */
    commits: (Array.isArray(r.commits) ? r.commits : []).map((c) => ({
      sha: c.sha || '',
      shortSha: c.shortSha || String(c.sha || '').slice(0, 7),
      subject: c.subject || '',
      at: c.at || null
    })),
    /**
     * 回传原因：只记最近一次，随 /claim 与需求详情返回。
     * kind 区分打回（rejection）与撤销重开（reopen），老数据没有 kind 一律按打回处理。
     */
    feedback: r.feedback
      ? { at: r.feedback.at, note: r.feedback.note || '', kind: r.feedback.kind || 'rejection' }
      : null,
    /** 释放记录：也只记最近一次；派发用它做冷却，agent 认领时能读到上一次为什么放弃 */
    release: r.release
      ? {
          agent: r.release.agent,
          agentName: nameOf(r.release.agent),
          at: r.release.at,
          note: r.release.note || ''
        }
      : null,
    /**
     * 待回答的提问：空数组表示没有 agent 卡在这里等答案（按提问时间正序）。
     * 一条需求可以同时挂多条，所以对外是一个列表；`question` 只是「最早那条」的兼容字段，
     * 老界面 / 老脚本读它仍能工作，新代码应当读 `questions`。
     */
    questions,
    /** @deprecated 用 questions；留着是为了老调用方不必同时改 */
    question: questions.length ? questions[0] : null,
    /**
     * 往返记录：交付 / 打回 / 通过 / 拒绝 / 提问 / 回答 / 释放，按时间正序，最多 50 条。
     * 每条消息单独解析 `{UseSkill:x}`：历史轮次里点名的技能不并进「使用技能」清单
     * （那份只认正文与当前打回意见），但气泡仍要能渲染成 chip。
     */
    thread: (Array.isArray(r.thread) ? r.thread : []).map((m) => ({
      id: m.id,
      at: m.at,
      role: m.role,
      kind: m.kind,
      agent: m.agent || null,
      agentName: nameOf(m.agent),
      /** 问答类消息带上提问 id：界面据此把「哪条回答对应哪条提问」对上，不靠时间戳猜 */
      qid: m.qid || null,
      text: m.text || '',
      skills: resolveSkills(m.text)
    })),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt || r.createdAt
  };
}

function runView(r) {
  return {
    id: r.id,
    startedAt: r.startedAt,
    endedAt: r.endedAt || null,
    status: r.status,
    exitCode: r.exitCode === undefined ? null : r.exitCode,
    pid: r.pid || null,
    hostPid: r.hostPid || null,
    detachedAt: r.detachedAt || null,
    // 分离出去的进程宿主还活着就是「仍在运行」；进程随时可能结束，每次取视图现算
    alive: r.status === 'detached' ? runner.isAlivePid(r.hostPid) : false
  };
}

/** 分离出去但宿主还活着：应用不再托管，进程仍在跑 */
function detachedAlive(c) {
  const runs = c.runs || [];
  const last = runs[runs.length - 1];
  return !!(last && last.status === 'detached' && runner.isAlivePid(last.hostPid));
}

function cmdView(c) {
  const runs = c.runs || [];
  const last = runs.length ? runs[runs.length - 1] : null;
  const running = runner.isRunning(c.id);
  return {
    id: c.id,
    projectId: c.projectId,
    name: c.name || '',
    text: c.text,
    cwd: c.cwd,
    status: running ? 'running' : 'stopped',
    running,
    runCount: runs.length,
    lastRun: last ? runView(last) : null,
    runs: runs.slice(-runner.MAX_RUNS).map(runView).reverse()
  };
}

function projectView(p) {
  const db = store.get();
  const profile = detectProfile(p.path);
  const names = agentNameMap();
  const nameOf = (id) => (id && names.get(id)) || '';
  const reqs = db.requirements.filter((r) => r.projectId === p.id);
  // 未完成 = todo + doing + review：待审核没验收前同样算没做完，侧栏与视图下拉的计数口径都靠它
  const unfinished = reqs.filter((r) => UNFINISHED.includes(r.status));
  const cmds = db.commands.filter((c) => c.projectId === p.id);
  // 分离出去但进程还活着的也算运行中：服务确实在跑，角标与关注项不该说「没有运行」
  const runningCount = cmds.filter((c) => runner.isRunning(c.id) || detachedAlive(c)).length;
  return {
    id: p.id,
    name: p.name,
    path: p.path,
    /** 品牌类型（如 obsidian-plugin）：决定主图标是否可提取，识别不出为 null */
    kind: profile.kind,
    /** 技术栈（如 android / kotlin / gradle）：侧栏图标右下角角标与 tooltip 用 */
    stacks: profile.stacks,
    archived: !!p.archived,
    aiScout: p.aiScout !== false,
    /** 启动自动拉取：true / false 为项目自定义，null 表示跟随全局设置 */
    autoPull: typeof p.autoPull === 'boolean' ? p.autoPull : null,
    /** 项目偏好的 IDE：菜单里选过或打开过才写；为空时界面退回全局 lastIdeId */
    ideId: p.ideId || null,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt || p.createdAt,
    requirementCount: reqs.length,
    pendingCount: unfinished.length,
    todoCount: reqs.filter((r) => r.status === 'todo').length,
    doingCount: reqs.filter((r) => r.status === 'doing').length,
    reviewCount: reqs.filter((r) => r.status === 'review').length,
    /**
     * 被锁住的进行中需求：项目里有 doing 就派不出活，而认领人自己也要等人工解锁。
     * 这类需求是「昨晚卡住的活」，界面要能一眼看到，并给出解锁入口。
     */
    lockedCount: reqs.filter((r) => r.status === 'doing' && r.claim && !r.unlock).length,
    locked: reqs
      .filter((r) => r.status === 'doing' && r.claim && !r.unlock)
      .map((r) => ({
        requirementId: r.id,
        seq: r.seq,
        title: r.title,
        agent: r.claim.agent,
        agentName: nameOf(r.claim.agent),
        at: r.claim.at || null
      }))
      .sort((a, b) => String(a.at || '').localeCompare(String(b.at || ''))),
    /** 待回答提问数：一条需求可能挂多条，这里按「提问条数」而不是「需求条数」算 */
    questionCount: reqs.reduce((n, r) => n + listQuestions(r).length, 0),
    /**
     * 待回答提问摘要：顶部全局提醒要能跨项目直接落到具体需求，
     * 光有 questionCount 只知道「某个项目有话要说」，用户还得自己点进去找。
     * 一条需求只出一行（点进去再逐条答），`count` 说明它一共压了几条提问。
     * 按到点先后排序，最先超时的那条排最前。
     */
    questions: reqs
      .filter((r) => listQuestions(r).length)
      .map((r) => {
        const list = listQuestions(r).slice().sort((a, b) => String(a.at).localeCompare(String(b.at)));
        const first = list[0];
        return {
          requirementId: r.id,
          seq: r.seq,
          title: r.title,
          agent: first.agent || '',
          agentName: nameOf(first.agent),
          text: first.text || '',
          count: list.length,
          at: first.at || null,
          // 取最先到点的那条：提醒该按最紧急的算
          expiresAt: list
            .map((q) => q.expiresAt)
            .filter(Boolean)
            .sort()
            .shift() || null
        };
      })
      .sort((a, b) => String(a.expiresAt || a.at).localeCompare(String(b.expiresAt || b.at))),
    /** 待审核交付摘要：右下角强提醒要能跨项目直接落到具体需求并验收 */
    reviews: reqs
      .filter((r) => r.status === 'review')
      .map((r) => {
        const at = (r.completion && r.completion.at) || r.updatedAt || null;
        const startedAt = Date.parse(at || '');
        return {
          requirementId: r.id,
          seq: r.seq,
          title: r.title,
          agent: (r.completion && r.completion.agent) || '',
          agentName: nameOf(r.completion && r.completion.agent),
          text: (r.completion && r.completion.note) || '',
          at,
          // 与 /complete 的服务端等待一致：到点后 agent 不再挂着，但交付仍留着
          expiresAt: Number.isFinite(startedAt) ? new Date(startedAt + REVIEW_TIMEOUT).toISOString() : null
        };
      })
      .sort((a, b) => String(a.at || '').localeCompare(String(b.at || ''))),
    doneCount: reqs.filter((r) => r.status === 'done').length,
    rejectedCount: reqs.filter((r) => r.status === 'rejected').length,
    /** 候选池条数：没被确认的想法不进未完成口径（pendingCount），单列一个计数给界面用 */
    candidateCount: reqs.filter((r) => r.status === CANDIDATE).length,
    commandCount: cmds.length,
    runningCount,
    /** 总览页用：命令清单含最后一条运行结果；不带 runs 数组，避免列表载荷膨胀 */
    commands: cmds.map((c) => {
      const runs = c.runs || [];
      const last = runs.length ? runs[runs.length - 1] : null;
      return {
        id: c.id,
        text: c.text,
        name: c.name || '',
        status: runner.isRunning(c.id) ? 'running' : 'stopped',
        lastRun: last ? runView(last) : null
      };
    })
  };
}

module.exports = { reqView, runView, cmdView, projectView };

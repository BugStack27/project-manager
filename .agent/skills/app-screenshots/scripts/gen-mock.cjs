'use strict';

/* 生成演示截图用的虚构数据桥：名字全部虚构，规模刻意收敛 ——
   左栏只留 10 个项目，状态灯按「谁真的需要你动手」点亮，避免一屏全是点与圈。
   用法：node gen-mock.cjs --out <site/mock.js> */
const fs = require('fs');
const path = require('path');

const BASE = path.join(__dirname, '..', 'assets', 'mock-base.js');
const outIdx = process.argv.indexOf('--out');
const OUT = path.resolve(outIdx > 0 ? process.argv[outIdx + 1] : path.join(__dirname, '..', 'mock.js'));

const NOW = Date.now();
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();

/* 底座里已有：星港数据平台 / 极光移动端 / 灯塔控制台 / Nimbus 网关 / 拾光笔记 / Atlas 计费，
   另有归档的旧版官网。这里只补四个项目，保持一屏放得下。 */
const newProjects = [
  { id: 'p_tide', name: '潮汐任务调度', path: 'D:\\workspace\\tide-scheduler', aiScout: true, stacks: [], createdAt: iso(260 * DAY) },
  { id: 'p_guixu', name: '归墟检索服务', path: 'D:\\workspace\\guixu-search', aiScout: true, stacks: ['spring-boot', 'maven'], createdAt: iso(160 * DAY) },
  { id: 'p_konggu', name: '空谷文件同步', path: 'D:\\workspace\\konggu-sync', aiScout: true, stacks: ['go', 'rust', 'python', 'docker'], createdAt: iso(95 * DAY) },
  { id: 'p_fuguang', name: '浮光图表库', path: 'D:\\workspace\\fuguang-charts', aiScout: true, stacks: ['npm'], createdAt: iso(80 * DAY) }
];

/* 认领人一律用当下主流的 Agent 名字：截图里的名字要一眼能认出来，避免误读 */
const A_CURSOR = { agent: 'cursor-agent', agentName: 'Cursor' };
const A_CLAUDE = { agent: 'claude-code', agentName: 'Claude Code' };

function claim(a, msAgo) {
  return { agent: a.agent, agentName: a.agentName, at: iso(msAgo) };
}
function completion(a, msAgo, note) {
  return { agent: a.agent, agentName: a.agentName, at: iso(msAgo), note };
}
function req(projectId, seq, title, status, extra) {
  return Object.assign(
    {
      id: 'r_' + projectId.replace(/^p_/, '') + '_' + seq,
      projectId,
      seq,
      title,
      body: '',
      note: '',
      source: 'manual',
      status,
      createdAt: iso(8 * DAY),
      updatedAt: iso(2 * HOUR)
    },
    extra || {}
  );
}

const questionText =
  '灰度开关的默认值要不要统一改成「跟随系统」？现在有一批用户显式选了深色，直接改默认值会影响他们下一次启动的首屏。\n\n' +
  '我倾向于只对新增用户生效，存量用户保持原选择。';

const newRequirements = [
  /* 星港数据平台：需求中心 / 看板 / 引用悬停 / 修改记录 几屏都从这里取数据 */
  /* 需求详情截图：正文里同时引用别的项目、本项目需求、本项目文件（含目录）和技能 */
  req('p_aurora', 17, '导出任务列表复用消息分组交互', 'todo', {
    body:
      '导出中心的列表要与 @{极光移动端} 的消息分组保持一致：分组头吸顶、未读置顶、一键全部已读；筛选与分页沿用 @{#13} 里定下的快捷视图，不再另起一套状态。\n\n' +
      '列表直接改 @{file:web/src/views/export/JobList.tsx}，不要新建组件；同目录 @{file:web/src/views/export} 的分组头与筛选 hook 一起看，别只盯列表本身；改完按 {UseSkill:code-review} 的清单把空态、加载失败和超长标题过一遍。',
    source: 'manual',
    refs: [
      {
        name: '极光移动端',
        projectId: 'p_mobile',
        projectName: '极光移动端',
        path: 'D:\\workspace\\aurora-mobile',
        archived: false,
        ambiguous: false,
        requirementCount: 3,
        pendingCount: 3,
        pending: [
          { seq: 10, title: '灰度开关默认值改为跟随系统', status: 'doing' },
          { seq: 7, title: '消息中心支持按项目分组并置顶未读', status: 'doing' },
          { seq: 4, title: '通知支持免打扰时段', status: 'todo' }
        ]
      }
    ],
    reqRefs: [
      {
        name: '#13',
        seq: 13,
        requirementId: 'r_aurora_13',
        projectId: 'p_aurora',
        title: '筛选条件支持保存为快捷视图',
        status: 'todo',
        body: '常用筛选组合目前靠记忆，保存成快捷视图后一键切换。',
        exists: true
      }
    ],
    fileRefs: [
      {
        name: 'file:web/src/views/export',
        path: 'web/src/views/export',
        absPath: 'D:\\workspace\\aurora-platform\\web\\src\\views\\export',
        exists: true,
        directory: true,
        restricted: false,
        reason: null
      },
      {
        name: 'file:web/src/views/export/JobList.tsx',
        path: 'web/src/views/export/JobList.tsx',
        absPath: 'D:\\workspace\\aurora-platform\\web\\src\\views\\export\\JobList.tsx',
        exists: true,
        directory: false,
        restricted: false,
        reason: null
      }
    ],
    skills: [
      {
        name: 'code-review',
        skillId: 'workbuddy/code-review',
        source: 'workbuddy',
        dir: 'C:\\Users\\demo\\.workbuddy\\skills\\code-review',
        entry: 'C:\\Users\\demo\\.workbuddy\\skills\\code-review\\SKILL.md',
        description: '按清单检查空态、加载失败、超长文本与边界用例，输出可直接改的问题列表',
        exists: true,
        ambiguous: false,
        candidates: []
      }
    ],
    createdAt: iso(1 * DAY),
    updatedAt: iso(3 * HOUR)
  }),
  req('p_aurora', 16, '导出中心支持按对象存储直传', 'doing', {
    body: '大文件导出目前经服务端中转，峰值时会把带宽打满。希望导出任务直接写对象存储，完成后回传签名地址；断点续传要能跨进程恢复，同时保留服务端中转作为兜底。',
    source: 'manual',
    claim: claim(A_CURSOR, 70 * MIN),
    createdAt: iso(2 * DAY),
    updatedAt: iso(70 * MIN)
  }),
  req('p_aurora', 15, '工作台首页支持自定义卡片排序', 'review', {
    body: '首页卡片顺序固定，常用的指标每次都要往下翻。希望支持拖拽排序并按人保存，右上角提供恢复默认的入口；移动端保持只读。',
    source: 'ai',
    note: '夜间巡检提出：同一组指标被反复查找。',
    claim: claim(A_CLAUDE, 6 * HOUR),
    completion: completion(A_CLAUDE, 40 * MIN, '拖拽排序与本地持久化已完成，恢复了默认顺序入口；补了 5 个桌面宽度断点验证。'),
    /* 带需求上下文的提交：详情页的「关联提交」从这里渲染 */
    commits: [
      {
        sha: 'b7d1e9c4a2f8036d5e1c9b4a7f2d8c6e0a3b5d91',
        shortSha: 'b7d1e9c',
        subject: 'feat(workbench): 首页卡片支持拖拽排序',
        at: iso(52 * MIN)
      },
      {
        sha: '7e2c4a9f1b6d8e0c3a5f7b2d9e4c6a8b0d1f3e57',
        shortSha: '7e2c4a9',
        subject: 'fix(workbench): 恢复默认顺序并补断点验证',
        at: iso(2 * HOUR + 20 * MIN)
      }
    ],
    createdAt: iso(3 * DAY),
    updatedAt: iso(40 * MIN)
  }),
  req('p_aurora', 14, '批量导入支持断点续传', 'todo', {
    body: '导入中途关闭窗口要整批重来。后端按批次记录游标，前端显示已处理行数。',
    source: 'manual',
    createdAt: iso(4 * DAY),
    updatedAt: iso(6 * HOUR)
  }),
  req('p_aurora', 13, '筛选条件支持保存为快捷视图', 'todo', {
    body: '常用筛选组合目前靠记忆，保存成快捷视图后一键切换。',
    source: 'ai',
    note: '巡检建议：最近两周同一组筛选被重复使用 30 次以上。',
    createdAt: iso(5 * DAY),
    updatedAt: iso(8 * HOUR)
  }),
  req('p_aurora', 6, '接入企业微信审批回调', 'candidate', {
    body: '审批结果回写到需求备注，减少手动同步。',
    source: 'ai',
    createdAt: iso(9 * DAY),
    updatedAt: iso(9 * DAY)
  }),

  /* 极光移动端：Agent 询问 / Agent 恢复 两屏都从这里取 */
  req('p_mobile', 10, '灰度开关默认值改为跟随系统', 'doing', {
    body: '设置页的深色开关目前写死默认开启。希望新增用户默认跟随系统，存量用户保留原选择；切换系统主题时实时响应。',
    source: 'manual',
    claim: claim(A_CLAUDE, 55 * MIN),
    question: {
      agent: A_CLAUDE.agent,
      agentName: A_CLAUDE.agentName,
      at: iso(12 * MIN),
      text: questionText,
      expiresAt: iso(-18 * MIN),
      default: '只对新增用户生效，存量用户保持原选择',
      options: ['统一改成跟随系统', '只对新增用户生效', '先不动，等下一版']
    },
    createdAt: iso(2 * DAY),
    updatedAt: iso(12 * MIN)
  }),
  req('p_mobile', 4, '通知支持免打扰时段', 'todo', {
    body: '22:00–08:00 之间不弹系统通知，站内消息保留。',
    source: 'manual',
    createdAt: iso(6 * DAY),
    updatedAt: iso(1 * DAY)
  }),
  req('p_mobile', 3, '桌面小组件', 'candidate', {
    body: '展示今日待办数量与最近一条消息。',
    source: 'manual',
    createdAt: iso(7 * DAY),
    updatedAt: iso(7 * DAY)
  }),

  req('p_beacon', 7, '告警规则支持批量导入', 'todo', {
    body: '支持上传 YAML 批量建规则，冲突项先预览再覆盖。',
    source: 'ai',
    createdAt: iso(5 * DAY),
    updatedAt: iso(3 * HOUR)
  }),

  req('p_nimbus', 8, '网关接入配置热更新', 'doing', {
    body: '路由与证书变更不再重启进程。',
    source: 'manual',
    claim: claim(A_CLAUDE, 3 * HOUR),
    createdAt: iso(2 * DAY),
    updatedAt: iso(3 * HOUR)
  }),

  req('p_notes', 5, '冲突合并界面支持逐行选择', 'todo', {
    body: '同步冲突时逐行选保留哪一版，而不是整文件覆盖。',
    source: 'ai',
    createdAt: iso(8 * DAY),
    updatedAt: iso(5 * HOUR)
  }),

  req('p_tide', 4, '调度依赖图支持跨天窗口', 'doing', {
    body: '跨天依赖在零点前后要能正确判断就绪。',
    source: 'manual',
    claim: claim(A_CURSOR, 90 * MIN),
    createdAt: iso(3 * DAY),
    updatedAt: iso(90 * MIN)
  }),

  req('p_guixu', 5, '检索结果支持标注高亮', 'doing', {
    body: '命中的关键词在摘要里高亮，支持同义词展开。',
    source: 'manual',
    claim: claim(A_CLAUDE, 150 * MIN),
    createdAt: iso(3 * DAY),
    updatedAt: iso(150 * MIN)
  }),

  /* 空谷用于项目悬停卡：四种技术栈 + 一条进行中的需求 */
  req('p_konggu', 2, '断点续传校验失败自动回滚', 'doing', {
    body: '分片校验失败时回滚到上一个完整版本。',
    source: 'manual',
    claim: claim(A_CURSOR, 4 * HOUR),
    createdAt: iso(4 * DAY),
    updatedAt: iso(4 * HOUR)
  }),

  /* 浮光只有候选池：左栏这一行不亮灯，只挂一个候选角标 */
  req('p_fuguang', 2, '折线图支持区间缩放', 'candidate', {
    body: '拖选区间缩放，双击恢复全量。',
    source: 'ai',
    createdAt: iso(5 * DAY),
    updatedAt: iso(5 * DAY)
  })
];

function runObj(msAgo, opts) {
  return Object.assign(
    {
      id: 'run_' + Math.random().toString(36).slice(2, 9),
      startedAt: iso(msAgo),
      endedAt: null,
      status: 'running',
      exitCode: null,
      pid: 18000 + Math.floor(Math.random() * 900),
      hostPid: 15000 + Math.floor(Math.random() * 900),
      detachedAt: null,
      alive: false
    },
    opts || {}
  );
}

function cmd(id, projectId, name, text, runs) {
  return { id, projectId, name, text, cwd: '', runs };
}

/* 只补三个新项目各一条命令；运行中的都留在底座里，避免总览「在跑」太多 */
const newCommands = [
  cmd('c_tide_worker', 'p_tide', '任务 Worker', 'go run ./cmd/worker', [runObj(1 * DAY, { status: 'exited', endedAt: iso(1 * DAY - 2 * HOUR), exitCode: 0 })]),
  cmd('c_guixu_api', 'p_guixu', '检索服务', './mvnw spring-boot:run', [runObj(1 * DAY, { status: 'failed', endedAt: iso(1 * DAY - 50 * 1000), exitCode: 1 })]),
  cmd('c_konggu_sync', 'p_konggu', '同步服务', 'cargo tauri dev', [runObj(2 * DAY, { status: 'stopped', endedAt: iso(2 * DAY - 3 * HOUR), exitCode: 0 })])
];

function file(path, code, added, removed, untracked) {
  return {
    path,
    origPath: null,
    status: untracked ? '??' : code,
    xy: untracked ? '??' : ' M',
    staged: false,
    unstaged: !untracked,
    untracked: !!untracked,
    added,
    removed,
    binary: false
  };
}

/* 星港数据平台：五个改动文件，含一张 SVG，供「修改记录预览 SVG」截图；
   极光与 Nimbus 保持干净 —— 左栏的橙点只留给真正要处理的项目 */
const cleanChanges = (branch) => ({
  isRepo: true,
  branch,
  clean: true,
  counts: { total: 0, staged: 0, unstaged: 0, untracked: 0 },
  files: []
});

const newChanges = {
  p_aurora: {
    isRepo: true,
    branch: 'feat/export-filters',
    clean: false,
    counts: { total: 5, staged: 1, unstaged: 3, untracked: 1 },
    files: [
      file('assets/logo-mark.svg', 'M', 9, 3),
      file('web/src/export/ExportPanel.tsx', 'M', 38, 6),
      file('web/src/export/filters.ts', '??', 52, 0, true),
      file('server/app/exports.py', 'M', 12, 4),
      Object.assign(file('docs/export.md', 'A', 24, 0), { staged: true, unstaged: false, xy: 'A ' })
    ]
  },
  p_mobile: cleanChanges('main'),
  p_nimbus: cleanChanges('release/2.4'),
  p_beacon: {
    isRepo: true,
    branch: 'main',
    clean: false,
    counts: { total: 3, staged: 0, unstaged: 2, untracked: 1 },
    files: [
      file('web/src/views/NodeHealth.tsx', 'M', 64, 12),
      file('server/alerts/rules.go', 'M', 28, 5),
      file('web/src/views/health/__tests__/drilldown.test.ts', '??', 41, 0, true)
    ]
  }
};

/* 左栏状态灯口径：只有这几个项目有未拉取的远程提交，其余行保持干净 */
const behindMap = { p_aurora: 2 };

const weights = {
  p_tide: 2.0,
  p_guixu: 1.7,
  p_konggu: 1.1,
  p_fuguang: 1.4
};

const doneByOffset = {
  p_tide: { 1: 1, 5: 1 },
  p_guixu: { 2: 1 },
  p_konggu: { 4: 1 },
  p_fuguang: { 3: 1 }
};

function insertBefore(text, markerStart, markerEnd, payload) {
  const start = text.indexOf(markerStart);
  const end = text.indexOf(markerEnd, start + 1);
  if (start < 0 || end < 0) throw new Error('找不到插入点：' + markerStart);
  /* 既有数组的最后一个元素没有尾逗号，补一个再接新元素 */
  return text.slice(0, end) + ',\n' + payload + text.slice(end);
}

function insertObjectEntries(text, startMarker, endMarker, entries) {
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker, start + 1);
  if (start < 0 || end < 0) throw new Error('找不到插入点：' + startMarker);
  const payload = Object.entries(entries)
    .map(([k, v]) => '    ' + JSON.stringify(k) + ': ' + JSON.stringify(v))
    .join(',\n');
  return text.slice(0, end) + ',\n' + payload + ',\n' + text.slice(end);
}

/* 仓库在 Windows 上检出常是 CRLF，而下面的插入点都按 \n 写：统一成 LF 再替换 */
let mock = fs.readFileSync(BASE, 'utf8').replace(/\r\n/g, '\n');

/* 列表预览直接平铺正文，演示数据里的 markdown 记号在窄行里不好看，改成白描 */
mock = mock.replace(
  /'导出中心目前只能按日期范围筛选[^']*不改动现有权限模型'/,
  JSON.stringify(
    '导出中心目前只能按日期范围筛选，运营每周手动挑标签，重复操作很多。希望顶部筛选栏支持标签多选，不选即全部；记住上次选择并按项目隔离；导出进度与列表分页共用同一套状态。旧参数 from / to 保持兼容，不改动现有权限模型。'
  )
);
mock = mock.replace(
  /'## 需求\\n\\n- 消息按项目聚合[^']*第一阶段先做分组与未读状态。'/,
  JSON.stringify('消息需要按项目聚合、未读消息置顶，并支持一键全部已读。第一阶段先做分组与未读状态。')
);

mock = insertBefore(
  mock,
  'const projects = [',
  '\n  ];',
  newProjects.map((p) => '    ' + JSON.stringify(p)).join(',\n') + ',\n'
);

mock = insertBefore(
  mock,
  'const requirements = [',
  '\n  ];',
  newRequirements.map((r) => '    ' + JSON.stringify(r)).join(',\n') + ',\n'
);

mock = insertBefore(
  mock,
  'const commands = [',
  '\n  ];',
  newCommands.map((c) => '    ' + JSON.stringify(c)).join(',\n') + ',\n'
);

mock = insertObjectEntries(mock, 'const changes = {', '\n  };', newChanges);
mock = insertObjectEntries(mock, 'const weights = {', '\n  };', weights);
mock = insertObjectEntries(mock, 'const doneByOffset = {', '\n  };', doneByOffset);

mock = mock.replace(
  '  function cleanChanges(p) {',
  '  const behindMap = ' + JSON.stringify(behindMap) + ';\n\n  function cleanChanges(p) {'
);

/* 时间线按当前需求生成：演示数据里原来固定输出 #12 的事件，切到别的需求会串台 */
mock = mock.replace(
  '  function timelineOf(rid) {\n    const list = [',
  `  function timelineOf(rid) {
    const own = reqById.get(rid);
    if (own && rid !== 'r_aurora_12' && rid !== 'r_atlas_9') {
      const pname = (projects.find((p) => p.id === own.projectId) || {}).name || '';
      const who = (a) => ({ kind: 'agent', name: a.agentName || AGENT_NAME[a.agent] || a.agent });
      const list = [];
      if (own.claim) {
        list.push(ev({ at: own.claim.at, type: 'requirement.claimed', projectId: own.projectId, requirementId: rid, actor: who(own.claim), data: { projectName: pname, seq: own.seq, title: own.title, agent: own.claim.agentName || AGENT_NAME[own.claim.agent] || own.claim.agent } }));
      }
      if (own.question) {
        list.push(ev({ at: own.question.at, type: 'requirement.asked', projectId: own.projectId, requirementId: rid, actor: who(own.question), data: { projectName: pname, seq: own.seq, title: own.title, agent: own.question.agentName || AGENT_NAME[own.question.agent] || own.question.agent } }));
      }
      if (own.completion) {
        list.push(ev({ at: own.completion.at, type: 'requirement.completed', projectId: own.projectId, requirementId: rid, actor: who(own.completion), data: { projectName: pname, seq: own.seq, title: own.title, agent: own.completion.agentName || AGENT_NAME[own.completion.agent] || own.completion.agent, note: own.completion.note } }));
      }
      list.push(ev({ at: own.createdAt, type: 'requirement.created', projectId: own.projectId, requirementId: rid, actor: { kind: 'agent', name: own.source === 'ai' ? 'AI 巡检' : '我' }, data: { projectName: pname, seq: own.seq, title: own.title, source: own.source } }));
      return list.sort((a, b) => String(b.at).localeCompare(String(a.at)));
    }
    const list = [`
);

/* 视图补齐当前版本字段；Agent 名字统一走注册表，底座里只写 id 的认领记录也能显示成主流名字 */
mock = mock.replace(
  '  function reqView(r) {',
  "  const AGENT_NAME = { 'cursor-agent': 'Cursor', 'claude-code': 'Claude Code', 'workbuddy-agent': 'Work Buddy', 'copilot-agent': 'Copilot Agent', 'scout-agent': 'Qoder' };\n\n  function reqView(r) {"
);
mock = mock.replace(
  "      body: r.body || '',\n      note: r.note || '',",
  "      body: r.body || '',\n      refs: r.refs || [],\n      reqRefs: r.reqRefs || [],\n      fileRefs: r.fileRefs || [],\n      skills: r.skills || [],\n      commits: r.commits || [],\n      note: r.note || '',"
);
mock = mock.replace(
  '      path: p.path,\n      archived: !!p.archived,',
  '      path: p.path,\n      kind: p.kind || null,\n      stacks: p.stacks || [],\n      archived: !!p.archived,'
);
mock = mock.replace(
  '      pendingCount: unfinished.length,',
  "      pendingCount: unfinished.length,\n      candidateCount: reqs.filter((r) => r.status === 'candidate').length,\n      questionCount: reqs.filter((r) => r.question).length,"
);
mock = mock.replace(
  '      status: r.status,\n      claim: r.claim ? { agent: r.claim.agent, at: r.claim.at } : null,',
  '      status: r.status,\n      question: r.question || null,\n      unlock: r.unlock || null,\n      claim: r.claim ? { agent: r.claim.agent, agentName: r.claim.agentName || AGENT_NAME[r.claim.agent] || null, at: r.claim.at } : null,'
);
mock = mock.replace(
  'completion: r.completion\n        ? { agent: r.completion.agent, at: r.completion.at, note: r.completion.note || \'\' }',
  'completion: r.completion\n        ? { agent: r.completion.agent, agentName: r.completion.agentName || AGENT_NAME[r.completion.agent] || null, at: r.completion.at, note: r.completion.note || \'\' }'
);

/* gitSummary 带远程差量 */
const gsStart = mock.indexOf('    gitSummary: () => ({');
const gsNext = mock.indexOf('    gitChanges:', gsStart);
const gsEnd = mock.lastIndexOf('}),', gsNext);
if (gsStart < 0 || gsNext < 0) throw new Error('找不到 gitSummary');
const gsNew =
  '    gitSummary: () => ({\n' +
  '      projects: projects\n' +
  '        .filter((p) => !p.archived)\n' +
  '        .map((p) => {\n' +
  '          const ch = changes[p.id];\n' +
  '          const files = ch ? ch.counts.total : 0;\n' +
  '          return {\n' +
  '            id: p.id,\n' +
  '            name: p.name,\n' +
  '            isRepo: true,\n' +
  '            dirty: files > 0,\n' +
  '            files,\n' +
  '            behind: behindMap[p.id] || 0,\n' +
  '            sample: ch ? ch.files.slice(0, 2).map((f) => ({ path: f.path, code: f.status })) : []\n' +
  '          };\n' +
  '        })\n' +
  '    }),';
mock = mock.slice(0, gsStart) + gsNew + mock.slice(gsEnd + 3);

/* 技能悬停卡需要技能清单与 Agent 注册表：Agent 名字与认领人保持一致 */
mock = mock.replace(
  "    agents: () => ({\n      agents: [{ id: 'a_demo1', name: 'demo', createdAt: '2026-11-07T08:00:00.000Z' }]\n    }),",
  "    agents: () => ({\n      agents: [\n" +
    "        { id: 'cursor-agent', name: 'Cursor', createdAt: '2026-10-12T08:00:00.000Z' },\n" +
    "        { id: 'claude-code', name: 'Claude Code', createdAt: '2026-10-20T08:00:00.000Z' },\n" +
    "        { id: 'workbuddy-agent', name: 'Work Buddy', createdAt: '2026-11-02T08:00:00.000Z' },\n" +
    "        { id: 'copilot-agent', name: 'Copilot Agent', createdAt: '2026-11-07T08:00:00.000Z' }\n" +
    "      ]\n" +
    "    }),\n" +
    "    skills: () => ({\n" +
    "      skills: [\n" +
    "        { id: 'workbuddy/code-review', name: 'code-review', source: 'workbuddy', dir: 'C:\\\\Users\\\\demo\\\\.workbuddy\\\\skills\\\\code-review', entry: 'C:\\\\Users\\\\demo\\\\.workbuddy\\\\skills\\\\code-review\\\\SKILL.md', description: '按清单检查空态、加载失败、超长文本与边界用例，输出可直接改的问题列表', exists: true, agents: ['claude-code', 'cursor-agent'] },\n" +
    "        { id: 'workbuddy/pdf', name: 'pdf', source: 'workbuddy', dir: 'C:\\\\Users\\\\demo\\\\.workbuddy\\\\skills\\\\pdf', entry: 'C:\\\\Users\\\\demo\\\\.workbuddy\\\\skills\\\\pdf\\\\SKILL.md', description: '生成、合并与检查 PDF 文件', exists: true, agents: ['claude-code'] },\n" +
    "        { id: 'qoder/ui-review', name: 'ui-review', source: 'qoder', dir: 'C:\\\\Users\\\\demo\\\\.qoder\\\\skills\\\\ui-review', entry: 'C:\\\\Users\\\\demo\\\\.qoder\\\\skills\\\\ui-review\\\\SKILL.md', description: '前端界面走查：层级、间距与交互状态', exists: true, agents: [] }\n" +
    "      ]\n" +
    "    }),"
);

/* 文件夹引用的悬停卡：目录列一级条目（形状与 files.readDir 一致） */
mock = mock.replace(
  "    fileSnippet: ({ path }) => snippet(path, ['// 演示文件内容', 'export const demo = true;'])",
  "    projectDir: ({ path }) => {\n" +
    "      if (/^web\\/src\\/views\\/export\\/?$/.test(String(path))) {\n" +
    "        return {\n" +
    "          path: 'web/src/views/export',\n" +
    "          entries: [\n" +
    "            { name: '__tests__', directory: true, size: null },\n" +
    "            { name: 'ExportPanel.tsx', directory: false, size: 9830 },\n" +
    "            { name: 'JobList.tsx', directory: false, size: 12288 },\n" +
    "            { name: 'JobRow.tsx', directory: false, size: 6860 },\n" +
    "            { name: 'filters.ts', directory: false, size: 3174 },\n" +
    "            { name: 'types.ts', directory: false, size: 1229 },\n" +
    "            { name: 'useRememberedTags.ts', directory: false, size: 2458 }\n" +
    "          ],\n" +
    "          total: 7,\n" +
    "          truncated: false\n" +
    "        };\n" +
    "      }\n" +
    "      return { path, entries: [{ name: 'README.md', directory: false, size: 2148 }], total: 1, truncated: false };\n" +
    "    },\n" +
    "    fileSnippet: ({ path }) => snippet(path, ['// 演示文件内容', 'export const demo = true;'])"
);

/* 文件悬停卡：需求里引用的 JobList.tsx 返回一段像样的代码，其余文件仍用演示内容 */
const jobListLines = [
  "import { useMemo, useState } from 'react';",
  "import { useJobGroups } from '../../hooks/useJobGroups';",
  "import JobRow from './JobRow';",
  '',
  'type Props = { keyword: string; pageSize?: number };',
  '',
  'export default function JobList({ keyword, pageSize = 20 }: Props) {',
  '  const [page, setPage] = useState(1);',
  '  const [selected, setSelected] = useState<string[]>([]);',
  "  const { groups, loading, error, reload } = useJobGroups(",
  '    keyword,',
  '    page,',
  '    pageSize',
  '  );',
  '',
  '  const unread = useMemo(',
  '    () => groups.filter((g) => g.unread > 0),',
  '    [groups]',
  '  );',
  '',
  '  if (error) return <EmptyState tone="error" onRetry={reload} />;',
  '  if (loading) return <ListSkeleton rows={pageSize} />;',
  '',
  '  return (',
  '    <section className="job-list">',
  '      {unread.length ? (',
  '        <button className="linklike">全部标为已读</button>',
  '      ) : null}',
  '      {groups.map((g) => (',
  '        <JobRow key={g.id} group={g} />',
  '      ))}',
  '    </section>',
  '  );',
  '}'
];
mock = mock.replace(
  "    fileSnippet: ({ path }) => snippet(path, ['// 演示文件内容', 'export const demo = true;'])",
  "    fileSnippet: ({ path }) =>\n" +
    "      String(path).includes('JobList')\n" +
    '        ? snippet(path, ' + JSON.stringify(jobListLines) + ')\n' +
    "        : snippet(path, ['// 演示文件内容', 'export const demo = true;'])"
);

/* SVG 改动预览：一张灰版、一张蓝版，叠在源码 diff 上面 */
const svgLogoOld =
  '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240">' +
  '<rect width="240" height="240" rx="48" fill="#d7d7dc"/>' +
  '<path d="M78 96l30 24-30 24" fill="none" stroke="#8a8a94" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/>' +
  '<rect x="126" y="136" width="42" height="16" rx="8" fill="#8a8a94"/>' +
  '</svg>';
const svgLogoNew =
  '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240">' +
  '<rect width="240" height="240" rx="56" fill="#4f6bff"/>' +
  '<path d="M74 92l34 28-34 28" fill="none" stroke="#ffffff" stroke-width="20" stroke-linecap="round" stroke-linejoin="round"/>' +
  '<rect x="128" y="140" width="48" height="18" rx="9" fill="#ffffff"/>' +
  '</svg>';
const svgDataUrl = (svg) => 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
const diffLogoMark = [
  'diff --git a/assets/logo-mark.svg b/assets/logo-mark.svg',
  'index e3f1c0a..b7d92f4 100644',
  '--- a/assets/logo-mark.svg',
  '+++ b/assets/logo-mark.svg',
  '@@ -1,6 +1,11 @@',
  '-<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240">',
  '-  <rect width="240" height="240" rx="48" fill="#d7d7dc"/>',
  '-  <path d="M78 96l30 24-30 24" stroke="#8a8a94" stroke-width="18"/>',
  '+<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240">',
  '+  <rect width="240" height="240" rx="56" fill="#4f6bff"/>',
  '+  <path d="M74 92l34 28-34 28" stroke="#ffffff" stroke-width="20"/>',
  '+  <rect x="128" y="140" width="48" height="18" rx="9" fill="#ffffff"/>',
  ' </svg>'
];
mock = mock.replace(
  '    gitDiff: ({ path, untracked }) => {\n' +
    '      if (untracked) {\n' +
    '        return { path, untracked: true, binary: false, content: diffFilters, truncated: false };\n' +
    '      }\n' +
    '      return { path, untracked: false, binary: false, diff: diffExportPanel, truncated: false };\n' +
    '    },',
  '    gitDiff: ({ path, untracked }) => {\n' +
    "      if (/\\.svg$/i.test(String(path))) {\n" +
    '        return {\n' +
    '          path,\n' +
    '          untracked: false,\n' +
    '          binary: false,\n' +
    '          diff: ' + JSON.stringify(diffLogoMark.join('\n')) + ',\n' +
    '          image: { old: ' + JSON.stringify(svgDataUrl(svgLogoOld)) + ', new: ' + JSON.stringify(svgDataUrl(svgLogoNew)) + ', maxBytes: 0 },\n' +
    '          truncated: false\n' +
    '        };\n' +
    '      }\n' +
    '      if (untracked) {\n' +
    '        return { path, untracked: true, binary: false, content: diffFilters, truncated: false };\n' +
    '      }\n' +
    '      return { path, untracked: false, binary: false, diff: diffExportPanel, truncated: false };\n' +
    '    },'
);

fs.writeFileSync(OUT, mock);

/* 校验关键数据确实生效 */
const count = (re) => (mock.match(re) || []).length;
console.log(
  JSON.stringify({
    out: OUT,
    projects: count(/id['"]?\s*:\s*['"]p_/g),
    requirements: count(/id['"]?\s*:\s*['"]r_/g),
    commands: count(/id['"]?\s*:\s*['"]c_/g),
    changes: Object.keys(newChanges).length
  })
);

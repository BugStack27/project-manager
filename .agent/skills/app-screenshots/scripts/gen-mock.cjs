'use strict';

/* 生成演示截图用的虚构数据桥：参考真实项目的规模与多样性，名字全部虚构。
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

const newProjects = [
  { id: 'p_tide', name: '潮汐任务调度', path: 'D:\\workspace\\tide-scheduler', aiScout: true, stacks: [], createdAt: iso(260 * DAY) },
  { id: 'p_gray', name: '苍梧设计系统', path: 'D:\\workspace\\cangwu-design', aiScout: true, stacks: ['npm'], createdAt: iso(220 * DAY) },
  { id: 'p_changeng', name: '长庚运维面板', path: 'D:\\workspace\\changeng-console', aiScout: true, stacks: ['electron', 'npm'], createdAt: iso(200 * DAY) },
  { id: 'p_bailu', name: '白露插件', path: 'D:\\workspace\\bailu-plugin', aiScout: false, stacks: ['obsidian-plugin'], createdAt: iso(190 * DAY) },
  { id: 'p_shuofeng', name: '朔风固件工具', path: 'D:\\workspace\\shuofeng-tools', aiScout: true, stacks: ['android', 'kotlin'], createdAt: iso(175 * DAY) },
  { id: 'p_guixu', name: '归墟检索服务', path: 'D:\\workspace\\guixu-search', aiScout: true, stacks: ['spring-boot', 'maven'], createdAt: iso(160 * DAY) },
  { id: 'p_qingniao', name: '青鸟推送网关', path: 'D:\\workspace\\qingniao-gateway', aiScout: false, stacks: [], createdAt: iso(140 * DAY) },
  { id: 'p_shanlan', name: '山岚监控大屏', path: 'D:\\workspace\\shanlan-board', aiScout: true, stacks: ['npm'], createdAt: iso(120 * DAY) },
  { id: 'p_yuanshan', name: '远山文档站', path: 'D:\\workspace\\yuanshan-docs', aiScout: false, stacks: ['npm'], createdAt: iso(110 * DAY) },
  { id: 'p_konggu', name: '空谷文件同步', path: 'D:\\workspace\\konggu-sync', aiScout: true, stacks: [], createdAt: iso(95 * DAY) },
  { id: 'p_fuguang', name: '浮光图表库', path: 'D:\\workspace\\fuguang-charts', aiScout: false, stacks: ['npm'], createdAt: iso(80 * DAY) },
  { id: 'p_suixing', name: '岁星报表引擎', path: 'D:\\workspace\\suixing-report', aiScout: true, stacks: ['javafx', 'gradle'], createdAt: iso(60 * DAY) }
];

const A_CURSOR = { agent: 'cursor-agent', agentName: '光标' };
const A_CLAUDE = { agent: 'claude-code', agentName: '白泽' };
const A_SCOUT = { agent: 'scout-agent', agentName: '巡星' };
const A_COPILOT = { agent: 'copilot-agent', agentName: '青鸾' };

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
  '灰度开关的默认值要不要统一改成「跟随系统」？现在有一批用户显式选了深色，直接改默认值会影响他们下一次启动的首屏。\n\n我倾向于只对新增用户生效，存量用户保持原选择。';

const newRequirements = [
  /* 星港数据平台：做成需求中心截图里最丰富的一屏 */
  /* 需求详情截图：正文里同时引用别的项目、本项目需求、本项目文件和技能 */
  req('p_aurora', 17, '导出任务列表复用消息分组交互', 'todo', {
    body:
      '导出中心的列表要与 @{极光移动端} 的消息分组保持一致：分组头吸顶、未读置顶、一键全部已读；筛选与分页沿用 @{#13} 里定下的快捷视图，不再另起一套状态。\n\n' +
      '列表直接改 @{file:web/src/views/export/JobList.tsx}，不要新建组件；改完按 {UseSkill:code-review} 的清单把空态、加载失败和超长标题过一遍。',
    source: 'manual',
    refs: [
      {
        name: '极光移动端',
        projectId: 'p_mobile',
        projectName: '极光移动端',
        path: 'D:\\workspace\\aurora-mobile',
        archived: false,
        ambiguous: false,
        requirementCount: 4,
        pendingCount: 3,
        pending: [
          { seq: 10, title: '灰度开关默认值改为跟随系统', status: 'doing' },
          { seq: 9, title: '启动页骨架屏与首屏耗时上报', status: 'review' },
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
  req('p_mobile', 9, '启动页骨架屏与首屏耗时上报', 'review', {
    body: '冷启动白屏时间偏长，先上骨架屏，同时把首屏耗时打进埋点。',
    source: 'ai',
    claim: claim(A_CURSOR, 5 * HOUR),
    completion: completion(A_CURSOR, 35 * MIN, '骨架屏已接入启动流程，首屏耗时埋点覆盖冷启动与热启动；灰度 10% 验证通过。'),
    createdAt: iso(3 * DAY),
    updatedAt: iso(35 * MIN)
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

  req('p_beacon', 8, '节点健康度看板支持下钻', 'review', {
    body: '看板点节点后进入该节点的耗时、错误率与最近告警。',
    source: 'manual',
    claim: claim(A_COPILOT, 4 * HOUR),
    completion: completion(A_COPILOT, 1.5 * HOUR, '下钻页已完成，复用现有图表组件；空数据与加载失败都有占位。'),
    createdAt: iso(4 * DAY),
    updatedAt: iso(1.5 * HOUR)
  }),
  req('p_beacon', 7, '告警规则支持批量导入', 'todo', {
    body: '支持上传 YAML 批量建规则，冲突项先预览再覆盖。',
    source: 'ai',
    createdAt: iso(5 * DAY),
    updatedAt: iso(3 * HOUR)
  }),

  req('p_nimbus', 9, '限流支持按租户维度配置', 'review', {
    body: '现在只有全局阈值，大客户和小客户互相影响。',
    source: 'manual',
    claim: claim(A_CURSOR, 8 * HOUR),
    completion: completion(A_CURSOR, 2 * HOUR, '租户维度限流已上线预发，配置热更新走现有通道；补了超限回退用例。'),
    createdAt: iso(6 * DAY),
    updatedAt: iso(2 * HOUR)
  }),
  req('p_nimbus', 8, '网关接入配置热更新', 'doing', {
    body: '路由与证书变更不再重启进程。',
    source: 'manual',
    claim: claim(A_CLAUDE, 3 * HOUR),
    createdAt: iso(2 * DAY),
    updatedAt: iso(3 * HOUR)
  }),

  req('p_notes', 6, '双向链接面板支持标签过滤', 'review', {
    body: '反链面板里按标签筛，长文档也能快速定位。',
    source: 'manual',
    claim: claim(A_COPILOT, 10 * HOUR),
    completion: completion(A_COPILOT, 4 * HOUR, '过滤条与标签聚合已完成，空结果有提示；补了键盘操作。'),
    createdAt: iso(7 * DAY),
    updatedAt: iso(4 * HOUR)
  }),
  req('p_notes', 5, '冲突合并界面支持逐行选择', 'todo', {
    body: '同步冲突时逐行选保留哪一版，而不是整文件覆盖。',
    source: 'ai',
    createdAt: iso(8 * DAY),
    updatedAt: iso(5 * HOUR)
  }),

  req('p_atlas', 9, '账单导出支持分区字段', 'doing', {
    body: '导出文件按账期分区，下游离线任务不用再切分。',
    source: 'manual',
    claim: claim(A_CURSOR, 2 * HOUR),
    createdAt: iso(3 * DAY),
    updatedAt: iso(2 * HOUR)
  }),
  req('p_atlas', 8, '发票抬头支持批量维护', 'todo', {
    body: '财务一次维护多个抬头，支持模板导入。',
    source: 'manual',
    createdAt: iso(5 * DAY),
    updatedAt: iso(10 * HOUR)
  }),

  /* 新项目 */
  req('p_tide', 5, '任务失败重试支持指数退避', 'review', {
    body: '重试间隔按次数递增，避免下游被打穿。',
    source: 'ai',
    claim: claim(A_CLAUDE, 6 * HOUR),
    completion: completion(A_CLAUDE, 1 * HOUR, '退避策略已按 1s/2s/4s 上限 5 分钟实现，补了取消任务的边界用例。'),
    createdAt: iso(4 * DAY),
    updatedAt: iso(1 * HOUR)
  }),
  req('p_tide', 4, '调度依赖图支持跨天窗口', 'doing', {
    body: '跨天依赖在零点前后要能正确判断就绪。',
    source: 'manual',
    claim: claim(A_CURSOR, 90 * MIN),
    createdAt: iso(3 * DAY),
    updatedAt: iso(90 * MIN)
  }),
  req('p_tide', 3, '任务模板支持参数化', 'todo', {
    body: '同一套任务按参数生成多份，减少复制粘贴。',
    source: 'manual',
    createdAt: iso(6 * DAY),
    updatedAt: iso(7 * HOUR)
  }),

  req('p_gray', 3, '暗色令牌接入新皮肤', 'todo', {
    body: '新皮肤使用独立色板，组件不改结构。',
    source: 'manual',
    createdAt: iso(4 * DAY),
    updatedAt: iso(9 * HOUR)
  }),
  req('p_gray', 2, '表单控件补齐无障碍状态', 'candidate', {
    body: '焦点、错误、禁用三态的读屏描述要完整。',
    source: 'ai',
    createdAt: iso(5 * DAY),
    updatedAt: iso(5 * DAY)
  }),

  req('p_changeng', 4, '面板支持多机批量巡检', 'review', {
    body: '一次选中多台机器执行巡检脚本，结果按机器分列。',
    source: 'manual',
    claim: claim(A_COPILOT, 7 * HOUR),
    completion: completion(A_COPILOT, 3 * HOUR, '批量执行与结果分列已完成，失败机器可单独重跑。'),
    createdAt: iso(5 * DAY),
    updatedAt: iso(3 * HOUR)
  }),
  req('p_changeng', 3, '日志面板支持按级别过滤', 'doing', {
    body: 'info / warn / error 分级过滤，支持关键字组合。',
    source: 'manual',
    claim: claim(A_CLAUDE, 100 * MIN),
    createdAt: iso(2 * DAY),
    updatedAt: iso(100 * MIN)
  }),

  req('p_bailu', 2, '插件设置页支持导入导出', 'todo', {
    body: '把快捷键与模板配置导出成 JSON，换设备直接导入。',
    source: 'manual',
    createdAt: iso(5 * DAY),
    updatedAt: iso(1 * DAY)
  }),

  req('p_shuofeng', 4, '固件升级支持断点续传', 'review', {
    body: '弱网环境下升级包可分段续传，失败不重来。',
    source: 'ai',
    claim: claim(A_CURSOR, 9 * HOUR),
    completion: completion(A_CURSOR, 2.5 * HOUR, '分片校验与续传已完成，设备端协议不变；补了断网重连用例。'),
    createdAt: iso(6 * DAY),
    updatedAt: iso(2.5 * HOUR)
  }),
  req('p_shuofeng', 3, '诊断日志支持一键导出', 'todo', {
    body: '导出最近 24 小时日志并自动脱敏。',
    source: 'manual',
    createdAt: iso(7 * DAY),
    updatedAt: iso(4 * HOUR)
  }),

  req('p_guixu', 5, '检索结果支持标注高亮', 'doing', {
    body: '命中的关键词在摘要里高亮，支持同义词展开。',
    source: 'manual',
    claim: claim(A_CLAUDE, 150 * MIN),
    createdAt: iso(3 * DAY),
    updatedAt: iso(150 * MIN)
  }),
  req('p_guixu', 4, '索引重建支持限速', 'todo', {
    body: '重建期间按磁盘与 CPU 水位限速，避免影响线上查询。',
    source: 'ai',
    createdAt: iso(5 * DAY),
    updatedAt: iso(6 * HOUR)
  }),
  req('p_guixu', 2, '接入向量召回', 'candidate', {
    body: '关键词召回之外补一路向量召回，先做离线评估。',
    source: 'ai',
    createdAt: iso(8 * DAY),
    updatedAt: iso(8 * DAY)
  }),

  req('p_qingniao', 3, '推送失败重试支持死信队列', 'todo', {
    body: '超过重试上限的消息进入死信队列，支持手动重放。',
    source: 'manual',
    createdAt: iso(4 * DAY),
    updatedAt: iso(8 * HOUR)
  }),

  req('p_shanlan', 2, '大屏支持移动端巡检视图', 'candidate', {
    body: '把关键指标抽成移动端只读视图。',
    source: 'manual',
    createdAt: iso(9 * DAY),
    updatedAt: iso(9 * DAY)
  }),

  req('p_yuanshan', 3, '搜索支持快捷键唤起', 'todo', {
    body: 'Cmd/Ctrl + K 唤起全站搜索。',
    source: 'manual',
    createdAt: iso(6 * DAY),
    updatedAt: iso(2 * DAY)
  }),
  req('p_yuanshan', 1, '站点支持暗色模式', 'done', {
    body: '跟随系统并提供手动切换。',
    source: 'manual',
    note: '已随 2.0 文档站上线。',
    createdAt: iso(20 * DAY),
    updatedAt: iso(6 * DAY)
  }),

  req('p_konggu', 2, '断点续传校验失败自动回滚', 'doing', {
    body: '分片校验失败时回滚到上一个完整版本。',
    source: 'manual',
    claim: claim(A_CURSOR, 4 * HOUR),
    createdAt: iso(4 * DAY),
    updatedAt: iso(4 * HOUR)
  }),

  req('p_fuguang', 2, '折线图支持区间缩放', 'review', {
    body: '拖选区间缩放，双击恢复全量。',
    source: 'ai',
    claim: claim(A_CLAUDE, 5 * HOUR),
    completion: completion(A_CLAUDE, 45 * MIN, '缩放与复位交互已完成，补了触摸板手势与边界用例。'),
    createdAt: iso(5 * DAY),
    updatedAt: iso(45 * MIN)
  }),

  req('p_suixing', 3, '表头支持冻结列配置', 'todo', {
    body: '冻结前 N 列，横向滚动时保持可见。',
    source: 'manual',
    createdAt: iso(4 * DAY),
    updatedAt: iso(5 * HOUR)
  }),
  req('p_suixing', 2, '导出支持公式单元格', 'review', {
    body: '导出 Excel 时保留公式而不是只写值。',
    source: 'manual',
    claim: claim(A_COPILOT, 11 * HOUR),
    completion: completion(A_COPILOT, 5 * HOUR, '公式单元格导出已完成，覆盖常用聚合函数；兼容旧模板。'),
    createdAt: iso(7 * DAY),
    updatedAt: iso(5 * HOUR)
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

const newCommands = [
  cmd('c_aurora_build', 'p_aurora', '生产构建', 'pnpm build', [runObj(3 * DAY, { status: 'exited', endedAt: iso(3 * DAY - 2 * MIN), exitCode: 0 })]),
  cmd('c_mobile_dev', 'p_mobile', 'Android 调试', './gradlew :app:assembleDebug', [runObj(5 * HOUR, { status: 'exited', endedAt: iso(5 * HOUR - 90 * 1000), exitCode: 0 })]),
  cmd('c_beacon_dev', 'p_beacon', '控制台开发', 'pnpm dev', [runObj(2 * HOUR, { status: 'failed', endedAt: iso(2 * HOUR - 20 * 1000), exitCode: 1 })]),
  cmd('c_nimbus_srv', 'p_nimbus', '网关服务', 'go run ./cmd/gateway -config ./config/dev.yaml', [
    runObj(3 * HOUR + 12 * MIN, { status: 'running' }),
    runObj(2 * DAY, { status: 'stopped', endedAt: iso(2 * DAY - 40 * MIN), exitCode: 0 })
  ]),
  cmd('c_nimbus_test', 'p_nimbus', '集成测试', 'go test ./... -count=1', [runObj(6 * HOUR, { status: 'exited', endedAt: iso(6 * HOUR - 3 * MIN), exitCode: 0 })]),
  cmd('c_notes_dev', 'p_notes', '插件热重载', 'npm run dev', [runObj(9 * HOUR, { status: 'stopped', endedAt: iso(9 * HOUR - 50 * MIN), exitCode: 0 })]),
  cmd('c_atlas_api', 'p_atlas', '计费接口', './mvnw spring-boot:run', [runObj(7 * HOUR, { status: 'failed', endedAt: iso(7 * HOUR - 80 * 1000), exitCode: 1 })]),
  cmd('c_tide_worker', 'p_tide', '任务 Worker', 'go run ./cmd/worker', [runObj(1 * DAY, { status: 'exited', endedAt: iso(1 * DAY - 2 * HOUR), exitCode: 0 })]),
  cmd('c_gray_story', 'p_gray', 'Storybook', 'pnpm storybook', [runObj(2 * DAY, { status: 'stopped', endedAt: iso(2 * DAY - 30 * MIN), exitCode: 0 })]),
  cmd('c_changeng_dev', 'p_changeng', '面板开发', 'pnpm dev', [runObj(25 * MIN, { status: 'running' })]),
  cmd('c_bailu_dev', 'p_bailu', '插件开发', 'npm run dev', [runObj(3 * DAY, { status: 'stopped', endedAt: iso(3 * DAY - 20 * MIN), exitCode: 0 })]),
  cmd('c_shuofeng_install', 'p_shuofeng', '真机安装', './gradlew :app:installDebug', [runObj(4 * HOUR, { status: 'exited', endedAt: iso(4 * HOUR - 35 * 1000), exitCode: 0 })]),
  cmd('c_guixu_api', 'p_guixu', '检索服务', './mvnw spring-boot:run', [runObj(1 * DAY, { status: 'failed', endedAt: iso(1 * DAY - 50 * 1000), exitCode: 1 })]),
  cmd('c_qingniao_push', 'p_qingniao', '推送网关', 'cargo run --bin gateway', [runObj(8 * HOUR, { status: 'failed', endedAt: iso(8 * HOUR - 12 * 1000), exitCode: 1 })]),
  cmd('c_shanlan_web', 'p_shanlan', '大屏预览', 'pnpm dev', [runObj(10 * HOUR, { status: 'exited', endedAt: iso(10 * HOUR - 3 * MIN), exitCode: 0 })]),
  cmd('c_yuanshan_docs', 'p_yuanshan', '文档预览', 'pnpm docs:dev', [runObj(2 * DAY, { status: 'exited', endedAt: iso(2 * DAY - 4 * MIN), exitCode: 0 })]),
  cmd('c_konggu_sync', 'p_konggu', '同步服务', 'cargo tauri dev', [runObj(2 * DAY, { status: 'stopped', endedAt: iso(2 * DAY - 3 * HOUR), exitCode: 0 })]),
  cmd('c_fuguang_test', 'p_fuguang', '组件测试', 'pnpm test', [runObj(5 * HOUR, { status: 'exited', endedAt: iso(5 * HOUR - 70 * 1000), exitCode: 0 })]),
  cmd('c_suixing_boot', 'p_suixing', '报表预览', './gradlew bootRun', [runObj(6 * HOUR, { status: 'failed', endedAt: iso(6 * HOUR - 30 * 1000), exitCode: 1 })])
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

const newChanges = {
  p_beacon: {
    isRepo: true,
    branch: 'main',
    clean: false,
    counts: { total: 3, staged: 0, unstaged: 2, untracked: 1 },
    files: [
      file('web/src/views/NodeHealth.tsx', 'M', 64, 12),
      file('server/alerts/rules.go', 'M', 28, 5),
      file('web/src/views/health/__tests__/drilldown.test.ts', 'M', 41, 0, true)
    ]
  },
  p_tide: {
    isRepo: true,
    branch: 'feat/backoff',
    clean: false,
    counts: { total: 1, staged: 0, unstaged: 1, untracked: 0 },
    files: [file('internal/scheduler/backoff.go', 'M', 33, 7)]
  },
  p_gray: {
    isRepo: true,
    branch: 'main',
    clean: false,
    counts: { total: 2, staged: 0, unstaged: 2, untracked: 0 },
    files: [file('packages/tokens/color.json', 'M', 18, 6), file('packages/ui/Button.tsx', 'M', 9, 3)]
  },
  p_guixu: {
    isRepo: true,
    branch: 'feat/highlight',
    clean: false,
    counts: { total: 1, staged: 0, unstaged: 1, untracked: 0 },
    files: [file('src/main/java/dev/guixu/index/RebuildJob.java', 'M', 46, 11)]
  },
  p_changeng: {
    isRepo: true,
    branch: 'main',
    clean: false,
    counts: { total: 2, staged: 0, unstaged: 1, untracked: 1 },
    files: [file('app/main/ipc.ts', 'M', 22, 4), file('web/src/panel/logs/filters.tsx', 'M', 57, 0, true)]
  }
};

const behindMap = { p_aurora: 2, p_nimbus: 3, p_beacon: 1, p_guixu: 2 };

const weights = {
  p_tide: 2.6,
  p_gray: 1.1,
  p_changeng: 1.9,
  p_bailu: 0.4,
  p_shuofeng: 1.6,
  p_guixu: 2.2,
  p_qingniao: 0.9,
  p_shanlan: 0.7,
  p_yuanshan: 0.5,
  p_konggu: 1.2,
  p_fuguang: 1.4,
  p_suixing: 2.4
};

const doneByOffset = {
  p_tide: { 1: 1, 5: 1 },
  p_gray: { 2: 1 },
  p_changeng: { 0: 1, 3: 1 },
  p_bailu: { 12: 1 },
  p_shuofeng: { 4: 1, 9: 1 },
  p_guixu: { 1: 1, 4: 1 },
  p_qingniao: { 7: 1 },
  p_shanlan: { 6: 1 },
  p_yuanshan: { 2: 1 },
  p_konggu: { 8: 1 },
  p_fuguang: { 3: 1 },
  p_suixing: { 0: 1, 2: 1 }
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
      const who = (a) => ({ kind: 'agent', name: a.agentName || a.agent });
      const list = [];
      if (own.claim) {
        list.push(ev({ at: own.claim.at, type: 'requirement.claimed', projectId: own.projectId, requirementId: rid, actor: who(own.claim), data: { projectName: pname, seq: own.seq, title: own.title, agent: own.claim.agentName || own.claim.agent } }));
      }
      if (own.question) {
        list.push(ev({ at: own.question.at, type: 'requirement.asked', projectId: own.projectId, requirementId: rid, actor: who(own.question), data: { projectName: pname, seq: own.seq, title: own.title, agent: own.question.agentName || own.question.agent } }));
      }
      if (own.completion) {
        list.push(ev({ at: own.completion.at, type: 'requirement.completed', projectId: own.projectId, requirementId: rid, actor: who(own.completion), data: { projectName: pname, seq: own.seq, title: own.title, agent: own.completion.agentName || own.completion.agent, note: own.completion.note } }));
      }
      list.push(ev({ at: own.createdAt, type: 'requirement.created', projectId: own.projectId, requirementId: rid, actor: { kind: 'agent', name: own.source === 'ai' ? 'AI 巡检' : '我' }, data: { projectName: pname, seq: own.seq, title: own.title, source: own.source } }));
      return list.sort((a, b) => String(b.at).localeCompare(String(a.at)));
    }
    const list = [`
);

/* 视图补齐当前版本字段 */
mock = mock.replace(
  "      body: r.body || '',\n      note: r.note || '',",
  "      body: r.body || '',\n      refs: r.refs || [],\n      reqRefs: r.reqRefs || [],\n      fileRefs: r.fileRefs || [],\n      skills: r.skills || [],\n      note: r.note || '',"
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
  '      status: r.status,\n      question: r.question || null,\n      unlock: r.unlock || null,\n      claim: r.claim ? { agent: r.claim.agent, agentName: r.claim.agentName || null, at: r.claim.at } : null,'
);
mock = mock.replace(
  'completion: r.completion\n        ? { agent: r.completion.agent, at: r.completion.at, note: r.completion.note || \'\' }',
  'completion: r.completion\n        ? { agent: r.completion.agent, agentName: r.completion.agentName || null, at: r.completion.at, note: r.completion.note || \'\' }'
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

/* 技能悬停卡需要技能清单与 Agent 注册表：补齐三条虚构技能与几个 Agent 名字 */
mock = mock.replace(
  "    agents: () => ({\n      agents: [{ id: 'a_demo1', name: 'demo', createdAt: '2026-11-07T08:00:00.000Z' }]\n    }),",
  "    agents: () => ({\n      agents: [\n" +
    "        { id: 'a_claude', name: '白泽', createdAt: '2026-10-12T08:00:00.000Z' },\n" +
    "        { id: 'a_cursor', name: '光标', createdAt: '2026-10-20T08:00:00.000Z' },\n" +
    "        { id: 'a_demo1', name: 'demo', createdAt: '2026-11-07T08:00:00.000Z' }\n" +
    "      ]\n" +
    "    }),\n" +
    "    skills: () => ({\n" +
    "      skills: [\n" +
    "        { id: 'workbuddy/code-review', name: 'code-review', source: 'workbuddy', dir: 'C:\\\\Users\\\\demo\\\\.workbuddy\\\\skills\\\\code-review', entry: 'C:\\\\Users\\\\demo\\\\.workbuddy\\\\skills\\\\code-review\\\\SKILL.md', description: '按清单检查空态、加载失败、超长文本与边界用例，输出可直接改的问题列表', exists: true, agents: ['a_claude', 'a_cursor'] },\n" +
    "        { id: 'workbuddy/pdf', name: 'pdf', source: 'workbuddy', dir: 'C:\\\\Users\\\\demo\\\\.workbuddy\\\\skills\\\\pdf', entry: 'C:\\\\Users\\\\demo\\\\.workbuddy\\\\skills\\\\pdf\\\\SKILL.md', description: '生成、合并与检查 PDF 文件', exists: true, agents: ['a_claude'] },\n" +
    "        { id: 'qoder/ui-review', name: 'ui-review', source: 'qoder', dir: 'C:\\\\Users\\\\demo\\\\.qoder\\\\skills\\\\ui-review', entry: 'C:\\\\Users\\\\demo\\\\.qoder\\\\skills\\\\ui-review\\\\SKILL.md', description: '前端界面走查：层级、间距与交互状态', exists: true, agents: [] }\n" +
    "      ]\n" +
    "    }),"
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
  '  const { groups, loading, error, reload } = useJobGroups(',
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

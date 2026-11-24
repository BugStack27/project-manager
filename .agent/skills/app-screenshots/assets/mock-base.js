/*
 * 宣传页演示数据桥：在浏览器里替身 window.pm，用一份完全虚构的数据驱动真实界面。
 * 只用于截图与宣传页，不参与应用打包；数据里的项目名、路径、提交、日志均为演示内容。
 */
(function () {
  const NOW = Date.now();
  const MIN = 60 * 1000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;
  const UNFINISHED = ['todo', 'doing', 'review'];

  const iso = (msAgo) => new Date(NOW - msAgo).toISOString();
  const clock = (msAgo) => {
    const d = new Date(NOW - msAgo);
    return [d.getHours(), d.getMinutes(), d.getSeconds()]
      .map((n) => String(n).padStart(2, '0'))
      .join(':');
  };

  /* ───────── 项目 ───────── */

  const projects = [
    {
      id: 'p_aurora',
      name: '星港数据平台',
      path: 'D:\\workspace\\aurora-platform',
      aiScout: true,
      createdAt: iso(210 * DAY),
      extras: {
        links: [
          { id: 'pl_demo_1', projectId: 'p_mobile', note: '移动端复用同一套鉴权与导出接口' },
          { id: 'pl_demo_2', projectId: 'p_nimbus', note: '网关暴露导出任务的开放接口' }
        ],
        env: [
          { id: 'pe_demo_1', key: 'JAVA_HOME', value: 'D:\\software\\jdk-21' },
          { id: 'pe_demo_2', key: 'MAVEN_HOME', value: 'D:\\software\\maven-3.9' }
        ],
        rules: [
          {
            id: 'pr_demo_1',
            title: 'docs 收敛',
            body: 'docs 目录条目超过 30 条时，调用 {UseSkill:workbuddy/收敛文档} 整理后再提交。\n\n- 先合并重复主题\n- 再删除过期草稿',
            enabled: true,
            skills: [
              {
                name: 'workbuddy/收敛文档',
                skillId: 'workbuddy/收敛文档',
                source: 'workbuddy',
                dir: 'C:\\Users\\demo\\.workbuddy\\skills\\doc-consolidate',
                entry: 'C:\\Users\\demo\\.workbuddy\\skills\\doc-consolidate\\SKILL.md',
                description: '把散落的文档合并、去重并重建索引',
                exists: true,
                ambiguous: false,
                candidates: [],
                reason: null
              }
            ]
          },
          { id: 'pr_demo_2', title: '导出改动补失败用例', body: '改动导出中心时，为失败分支补一条集成测试。', enabled: false, skills: [] }
        ]
      }
    },
    {
      id: 'p_mobile',
      name: '极光移动端',
      path: 'D:\\workspace\\aurora-mobile',
      aiScout: true,
      createdAt: iso(180 * DAY)
    },
    {
      id: 'p_beacon',
      name: '灯塔控制台',
      path: 'D:\\workspace\\beacon-console',
      aiScout: true,
      createdAt: iso(96 * DAY)
    },
    {
      id: 'p_nimbus',
      name: 'Nimbus 网关',
      path: 'D:\\workspace\\nimbus-gateway',
      aiScout: true,
      createdAt: iso(140 * DAY)
    },
    {
      id: 'p_notes',
      name: '拾光笔记',
      path: 'D:\\workspace\\shiguang-notes',
      aiScout: false,
      createdAt: iso(300 * DAY)
    },
    {
      id: 'p_atlas',
      name: 'Atlas 计费',
      path: 'D:\\workspace\\atlas-billing',
      aiScout: true,
      createdAt: iso(120 * DAY)
    },
    {
      id: 'p_legacy',
      name: '旧版官网',
      path: 'D:\\workspace\\legacy-site',
      aiScout: true,
      createdAt: iso(400 * DAY),
      archived: true
    }
  ];

  /* ───────── 需求 ───────── */

  const requirements = [
    {
      id: 'r_aurora_12',
      projectId: 'p_aurora',
      seq: 12,
      title: '导出中心支持按标签筛选并记住上次选择',
      body:
        '导出中心目前只能按日期范围筛选，运营每周手动挑标签，重复操作很多。\n\n## 期望效果\n\n- 顶部筛选栏支持**标签多选**，不选 = 全部\n- 记住上次选择（按项目隔离）\n- 导出进度与列表分页共用同一套状态\n\n## 约束\n\n- 旧参数 `from` / `to` 保持兼容\n- 不改动现有权限模型',
      note: '夜间巡检提出：运营每周重复筛选同一组标签，建议把选择持久化。',
      source: 'ai',
      status: 'review',
      claim: { agent: 'scout-agent', at: iso(2 * HOUR) },
      completion: {
        agent: 'scout-agent',
        at: iso(25 * MIN),
        note: '筛选栏与本地记忆已完成，导出接口兼容旧参数；补充了 6 个组合用例。'
      },
      createdAt: iso(3 * HOUR + 12 * MIN),
      updatedAt: iso(25 * MIN)
    },
    {
      id: 'r_aurora_11',
      projectId: 'p_aurora',
      seq: 11,
      title: '批量导入失败时提供可下载的错误明细',
      body:
        '导入任务失败后只能看到前 10 条错误。\n\n- 完整错误写入 CSV\n- 失败行保留原始行号\n- 下载入口挂在任务详情',
      note: '已完成，失败行可导出 CSV',
      source: 'ai',
      status: 'done',
      createdAt: iso(9 * DAY),
      updatedAt: iso(2 * DAY)
    },
    {
      id: 'r_aurora_10',
      projectId: 'p_aurora',
      seq: 10,
      title: '接入 OpenTelemetry 上报关键链路耗时',
      body: '- 导出、导入、鉴权三条链路\n- 采样率 10%\n- 只在 staging / prod 开启',
      note: '',
      source: 'manual',
      status: 'done',
      createdAt: iso(12 * DAY),
      updatedAt: iso(4 * DAY)
    },
    {
      id: 'r_aurora_9',
      projectId: 'p_aurora',
      seq: 9,
      title: '移除已废弃的 v1 导出接口',
      body: 'v1 接口已标记废弃两个版本，计划本季度下线。',
      note: '有外部调用方仍在使用，暂不删除',
      source: 'manual',
      status: 'rejected',
      createdAt: iso(15 * DAY),
      updatedAt: iso(6 * DAY)
    },
    {
      id: 'r_aurora_8',
      projectId: 'p_aurora',
      seq: 8,
      title: '总览页增加磁盘占用提示',
      body: '项目卡片显示仓库体积与最近一次清理时间。',
      note: '',
      source: 'ai',
      status: 'done',
      createdAt: iso(19 * DAY),
      updatedAt: iso(8 * DAY)
    },
    {
      id: 'r_mobile_7',
      projectId: 'p_mobile',
      seq: 7,
      title: '消息中心支持按项目分组并置顶未读',
      body:
        '## 需求\n\n- 消息按项目聚合\n- 未读消息置顶\n- 支持一键全部已读\n\n> 第一阶段先做分组与未读状态。',
      note: '先做分组，未读置顶放第二阶段',
      source: 'manual',
      status: 'doing',
      claim: { agent: 'cursor-agent', at: iso(40 * MIN) },
      createdAt: iso(2 * DAY),
      updatedAt: iso(40 * MIN)
    },
    {
      id: 'r_mobile_6',
      projectId: 'p_mobile',
      seq: 6,
      title: '启动页权限弹窗文案统一',
      body: '相机、通知、定位三处弹窗文案与产品稿不一致。',
      note: '文案已按产品稿更新',
      source: 'ai',
      status: 'done',
      createdAt: iso(6 * DAY),
      updatedAt: iso(1 * DAY)
    },
    {
      id: 'r_mobile_5',
      projectId: 'p_mobile',
      seq: 5,
      title: '修复深色模式下输入框边框不可见',
      body: '深色主题下输入框边框与背景同色，聚焦态不明显。',
      note: '',
      source: 'manual',
      status: 'done',
      createdAt: iso(8 * DAY),
      updatedAt: iso(5 * DAY)
    },
    {
      id: 'r_beacon_3',
      projectId: 'p_beacon',
      seq: 3,
      title: '看板支持拖拽调整卡片顺序',
      body:
        '目前卡片顺序写死在配置文件里，调整需要重启。\n\n- 拖拽后立即保存\n- 支持键盘移动\n- 与现有筛选共存',
      note: '巡检发现：排序写死在 config/board.json，用户改一次要重启。',
      source: 'ai',
      status: 'todo',
      createdAt: iso(3 * HOUR + 40 * MIN),
      updatedAt: iso(3 * HOUR + 40 * MIN)
    },
    {
      id: 'r_beacon_2',
      projectId: 'p_beacon',
      seq: 2,
      title: '图表图例支持点击隐藏系列',
      body: '折线图图例需要支持点击隐藏 / 显示对应系列。',
      note: '',
      source: 'manual',
      status: 'done',
      createdAt: iso(9 * DAY),
      updatedAt: iso(3 * DAY)
    },
    {
      id: 'r_beacon_1',
      projectId: 'p_beacon',
      seq: 1,
      title: '初始化项目骨架',
      body: 'Vite + React + ECharts，接入统一鉴权。',
      note: '',
      source: 'manual',
      status: 'done',
      createdAt: iso(26 * DAY),
      updatedAt: iso(20 * DAY)
    },
    {
      id: 'r_nimbus_18',
      projectId: 'p_nimbus',
      seq: 18,
      title: '网关限流规则支持按路径前缀匹配',
      body: '按路径前缀配置限流规则，支持分钟级窗口。',
      note: '已上线，灰度期间无异常',
      source: 'ai',
      status: 'done',
      createdAt: iso(4 * DAY),
      updatedAt: iso(6 * HOUR)
    },
    {
      id: 'r_nimbus_17',
      projectId: 'p_nimbus',
      seq: 17,
      title: '补充健康检查的超时配置',
      body: '健康检查探针超时时间写死为 1s，需要可配置。',
      note: '',
      source: 'manual',
      status: 'done',
      createdAt: iso(5 * DAY),
      updatedAt: iso(2 * DAY)
    },
    {
      id: 'r_nimbus_16',
      projectId: 'p_nimbus',
      seq: 16,
      title: '升级 Go 1.24 并修复 vet 告警',
      body: '升级工具链，清理 go vet 告警。',
      note: '',
      source: 'manual',
      status: 'done',
      createdAt: iso(11 * DAY),
      updatedAt: iso(6 * DAY)
    },
    {
      id: 'r_notes_4',
      projectId: 'p_notes',
      seq: 4,
      title: '笔记导出为 Markdown 时保留标签',
      body: '导出文件 frontmatter 写入标签与创建时间。',
      note: '',
      source: 'manual',
      status: 'done',
      createdAt: iso(14 * DAY),
      updatedAt: iso(10 * DAY)
    },
    {
      id: 'r_notes_3',
      projectId: 'p_notes',
      seq: 3,
      title: '新增全局搜索快捷键',
      body: 'Cmd / Ctrl + K 打开全局搜索。',
      note: '',
      source: 'manual',
      status: 'done',
      createdAt: iso(20 * DAY),
      updatedAt: iso(15 * DAY)
    },
    {
      id: 'r_atlas_9',
      projectId: 'p_atlas',
      seq: 9,
      title: '账单明细支持按成本中心汇总',
      body:
        '## 目标\n\n财务每月按成本中心核对账单，目前只能导出后手工透视。\n\n- 明细表新增「成本中心」列\n- 顶部可按成本中心筛选\n- 接口返回保持向后兼容\n\n## 验收\n\n- 汇总结果与财务手工核对一致\n- 旧客户端不受影响',
      note: '夜间巡检提出：财务每月手工透视，容易漏项。',
      source: 'ai',
      status: 'review',
      claim: { agent: 'scout-agent', at: iso(5 * HOUR) },
      completion: {
        agent: 'scout-agent',
        at: iso(12 * MIN),
        note: '汇总视图已上线，分组逻辑复用报表模块，接口返回兼容旧字段。'
      },
      createdAt: iso(3 * DAY),
      updatedAt: iso(12 * MIN)
    },
    {
      id: 'r_atlas_8',
      projectId: 'p_atlas',
      seq: 8,
      title: '对账任务失败时自动重试两次',
      body: '对账任务增加指数退避重试，超过两次后告警。',
      note: '',
      source: 'manual',
      status: 'done',
      createdAt: iso(7 * DAY),
      updatedAt: iso(1 * DAY)
    },
    {
      id: 'r_atlas_7',
      projectId: 'p_atlas',
      seq: 7,
      title: '修复金额格式化在负数时的显示',
      body: '负数金额缺少负号，千分位分隔错误。',
      note: '',
      source: 'manual',
      status: 'done',
      createdAt: iso(8 * DAY),
      updatedAt: iso(4 * DAY)
    },
    {
      id: 'r_atlas_6',
      projectId: 'p_atlas',
      seq: 6,
      title: '移除测试环境硬编码的商户号',
      body: '测试配置里的商户号改为环境变量注入。',
      note: '',
      source: 'ai',
      status: 'done',
      createdAt: iso(10 * DAY),
      updatedAt: iso(6 * DAY)
    },
    {
      id: 'r_legacy_2',
      projectId: 'p_legacy',
      seq: 2,
      title: '迁移旧版静态页面',
      body: '',
      note: '',
      source: 'manual',
      status: 'done',
      createdAt: iso(60 * DAY),
      updatedAt: iso(40 * DAY)
    },
    {
      id: 'r_legacy_1',
      projectId: 'p_legacy',
      seq: 1,
      title: '归档仓库',
      body: '',
      note: '',
      source: 'manual',
      status: 'done',
      createdAt: iso(80 * DAY),
      updatedAt: iso(60 * DAY)
    }
  ];

  const reqById = new Map(requirements.map((r) => [r.id, r]));

  function reqView(r) {
    return {
      id: r.id,
      projectId: r.projectId,
      seq: r.seq,
      title: r.title,
      body: r.body || '',
      note: r.note || '',
      source: r.source || 'manual',
      status: r.status,
      claim: r.claim ? { agent: r.claim.agent, at: r.claim.at } : null,
      completion: r.completion
        ? { agent: r.completion.agent, at: r.completion.at, note: r.completion.note || '' }
        : null,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt || r.createdAt
    };
  }

  /* ───────── 命令与运行 ───────── */

  function run(startedAgo, opts) {
    return Object.assign(
      {
        id: 'run_' + Math.random().toString(36).slice(2, 9),
        startedAt: iso(startedAgo),
        endedAt: null,
        status: 'running',
        exitCode: null,
        pid: null,
        hostPid: null,
        detachedAt: null,
        alive: false
      },
      opts || {}
    );
  }

  const commands = [
    {
      id: 'c_aurora_web',
      projectId: 'p_aurora',
      name: '前端开发',
      text: 'pnpm dev',
      cwd: 'D:\\workspace\\aurora-platform\\web',
      runs: [
        run(42 * MIN, { status: 'running', pid: 18432 }),
        run(26 * HOUR, { status: 'stopped', endedAt: iso(25 * HOUR + 12 * MIN), pid: 18010 }),
        run(2 * DAY, { status: 'failed', endedAt: iso(2 * DAY - 3 * MIN), exitCode: 1, pid: 17790 })
      ]
    },
    {
      id: 'c_aurora_api',
      projectId: 'p_aurora',
      name: '接口服务',
      text: 'uvicorn app.main:app --reload --port 8000',
      cwd: 'D:\\workspace\\aurora-platform\\server',
      runs: [
        run(3 * HOUR, { status: 'failed', endedAt: iso(2 * HOUR + 50 * MIN), exitCode: 1, pid: 17310 }),
        run(1 * DAY + 2 * HOUR, { status: 'exited', endedAt: iso(1 * DAY + 1 * HOUR), exitCode: 0, pid: 17002 })
      ]
    },
    {
      id: 'c_aurora_test',
      projectId: 'p_aurora',
      name: '单元测试',
      text: 'pytest -q',
      cwd: 'D:\\workspace\\aurora-platform\\server',
      runs: [
        run(1 * DAY + 4 * HOUR, {
          status: 'exited',
          endedAt: iso(1 * DAY + 3 * HOUR + 52 * MIN),
          exitCode: 0,
          pid: 16985
        })
      ]
    },
    {
      id: 'c_mobile_app',
      projectId: 'p_mobile',
      name: 'iOS 模拟器',
      text: 'flutter run -d "iPhone 16 Pro"',
      cwd: 'D:\\workspace\\aurora-mobile',
      runs: [run(18 * MIN, { status: 'running', pid: 22310 })]
    },
    {
      id: 'c_mobile_lint',
      projectId: 'p_mobile',
      name: '静态检查',
      text: 'flutter analyze',
      cwd: 'D:\\workspace\\aurora-mobile',
      runs: [
        run(1 * DAY + 2 * HOUR, {
          status: 'exited',
          endedAt: iso(1 * DAY + 1 * HOUR + 58 * MIN),
          exitCode: 0,
          pid: 21884
        })
      ]
    },
    {
      id: 'c_beacon_web',
      projectId: 'p_beacon',
      name: '本地预览',
      text: 'npm run dev',
      cwd: 'D:\\workspace\\beacon-console',
      runs: [
        run(3 * DAY, { status: 'exited', endedAt: iso(3 * DAY - 2 * MIN), exitCode: 0, pid: 15630 })
      ]
    },
    {
      id: 'c_nimbus_gateway',
      projectId: 'p_nimbus',
      name: '网关服务',
      text: 'go run ./cmd/gateway -config ./config/dev.yaml',
      cwd: 'D:\\workspace\\nimbus-gateway',
      runs: [run(2 * HOUR + 12 * MIN, { status: 'running', pid: 4012 })]
    },
    {
      id: 'c_nimbus_worker',
      projectId: 'p_nimbus',
      name: '异步任务 Worker',
      text: 'go run ./cmd/worker',
      cwd: 'D:\\workspace\\nimbus-gateway',
      runs: [
        run(5 * HOUR, {
          status: 'detached',
          detachedAt: iso(3 * HOUR),
          pid: 4020,
          hostPid: 4020,
          alive: true
        })
      ]
    },
    {
      id: 'c_nimbus_bench',
      projectId: 'p_nimbus',
      name: '吞吐压测',
      text: 'k6 run ./bench/throughput.js',
      cwd: 'D:\\workspace\\nimbus-gateway',
      runs: [
        run(2 * DAY, { status: 'exited', endedAt: iso(2 * DAY - 26 * MIN), exitCode: 0, pid: 15022 })
      ]
    },
    {
      id: 'c_notes_app',
      projectId: 'p_notes',
      name: '桌面预览',
      text: 'npm run tauri dev',
      cwd: 'D:\\workspace\\shiguang-notes',
      runs: [
        run(9 * DAY, { status: 'exited', endedAt: iso(9 * DAY - 2 * MIN), exitCode: 0, pid: 12008 })
      ]
    },
    {
      id: 'c_atlas_boot',
      projectId: 'p_atlas',
      name: '账单服务',
      text: './gradlew bootRun --args="--spring.profiles.active=dev"',
      cwd: 'D:\\workspace\\atlas-billing',
      runs: [run(3 * HOUR + 5 * MIN, { status: 'running', pid: 5120 })]
    },
    {
      id: 'c_atlas_migrate',
      projectId: 'p_atlas',
      name: '数据库迁移',
      text: 'flyway migrate',
      cwd: 'D:\\workspace\\atlas-billing',
      runs: [
        run(2 * DAY, { status: 'exited', endedAt: iso(2 * DAY - 4 * MIN), exitCode: 0, pid: 14032 })
      ]
    }
  ];

  const cmdById = new Map(commands.map((c) => [c.id, c]));

  function isActive(c) {
    const last = c.runs[0];
    return !!last && (last.status === 'running' || (last.status === 'detached' && last.alive));
  }

  function cmdView(c) {
    const running = !!(c.runs[0] && c.runs[0].status === 'running');
    return {
      id: c.id,
      projectId: c.projectId,
      name: c.name || '',
      text: c.text,
      cwd: c.cwd,
      status: running ? 'running' : 'stopped',
      running,
      runCount: c.runs.length,
      lastRun: c.runs[0] || null,
      runs: c.runs.slice()
    };
  }

  /* ───────── 运行日志（ANSI） ───────── */

  const C = {
    reset: '\x1b[0m',
    dim: '\x1b[2m',
    bold: '\x1b[1m',
    gray: '\x1b[90m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
    brightCyan: '\x1b[96m',
    brightGreen: '\x1b[92m'
  };

  const logs = {
    c_aurora_web: [
      [41, 'info', C.brightCyan + '▲' + C.reset + ' Vite ' + C.dim + 'v8.3.4' + C.reset + '  ready in ' + C.bold + '412' + C.reset + ' ms'],
      [41, 'info', C.green + '➜' + C.reset + '  ' + C.bold + 'Local:' + C.reset + '   ' + C.cyan + 'http://localhost:5173/' + C.reset],
      [41, 'info', C.green + '➜' + C.reset + '  ' + C.bold + 'Network:' + C.reset + ' ' + C.dim + 'http://192.168.1.24:5173/' + C.reset],
      [40, 'info', C.dim + '  press h + enter to show help' + C.reset],
      [37, 'info', C.dim + '[vite]' + C.reset + ' hmr update ' + C.cyan + '/src/export/ExportPanel.tsx' + C.reset],
      [33, 'info', C.dim + '[vite]' + C.reset + ' hmr update ' + C.cyan + '/src/export/filters.ts' + C.reset],
      [31, 'warn', C.yellow + '[ts]' + C.reset + ' ExportPanel.tsx(118,9): ' + C.dim + "'before' is declared but never read" + C.reset],
      [28, 'info', C.green + 'GET' + C.reset + '  /api/export/tags        ' + C.green + '200' + C.reset + '  ' + C.dim + '18ms' + C.reset],
      [27, 'info', C.green + 'GET' + C.reset + '  /api/export/preview     ' + C.green + '200' + C.reset + '  ' + C.dim + '96ms' + C.reset],
      [25, 'info', C.blue + 'POST' + C.reset + ' /api/export/jobs        ' + C.brightGreen + '201' + C.reset + '  ' + C.dim + '142ms' + C.reset],
      [22, 'info', C.dim + '[vite]' + C.reset + ' page reload ' + C.cyan + 'src/styles/export.css' + C.reset],
      [21, 'info', C.green + 'GET' + C.reset + '  /api/export/jobs/j_9f31 ' + C.green + '200' + C.reset + '  ' + C.dim + '12ms' + C.reset],
      [19, 'warn', C.yellow + '[ts]' + C.reset + ' filters.ts(27,3): ' + C.dim + 'prefer optional chaining' + C.reset],
      [18, 'info', C.green + 'GET' + C.reset + '  /api/export/tags        ' + C.green + '200' + C.reset + '  ' + C.dim + '9ms' + C.reset],
      [15, 'info', C.dim + '[vite]' + C.reset + ' hmr update ' + C.cyan + '/src/export/filters.ts' + C.reset],
      [14, 'info', C.green + 'GET' + C.reset + '  /api/export/preview?page=2 ' + C.green + '200' + C.reset + '  ' + C.dim + '74ms' + C.reset],
      [12, 'info', C.dim + '[vite]' + C.reset + ' hmr update ' + C.cyan + '/src/export/ExportPanel.tsx' + C.reset],
      [9, 'info', C.green + 'GET' + C.reset + '  /api/export/jobs/j_9f31 ' + C.green + '200' + C.reset + '  ' + C.dim + '11ms' + C.reset],
      [6, 'info', C.dim + '[vite]' + C.reset + ' hmr update ' + C.cyan + '/src/App.tsx' + C.reset],
      [3, 'info', C.green + 'GET' + C.reset + '  /api/export/tags        ' + C.green + '200' + C.reset + '  ' + C.dim + '8ms' + C.reset],
      [1, 'info', C.dim + '[vite]' + C.reset + ' hmr update ' + C.cyan + '/src/export/ExportPanel.tsx' + C.reset]
    ],
    c_mobile_app: [
      [17, 'info', C.cyan + 'Launching lib/main.dart on iPhone 16 Pro in debug mode...' + C.reset],
      [16, 'info', 'Running Xcode build...'],
      [13, 'info', C.green + '✓' + C.reset + ' Built D:\\workspace\\aurora-mobile\\build\\ios\\Runner.app'],
      [12, 'info', 'Syncing files to device iPhone 16 Pro...'],
      [9, 'info', C.brightCyan + 'Flutter run key commands.' + C.reset],
      [8, 'info', C.dim + 'r Hot reload.  R Hot restart.  q Quit.' + C.reset],
      [6, 'info', C.green + '[GET]' + C.reset + ' /api/messages?group=project ' + C.green + '200' + C.reset],
      [4, 'info', C.dim + 'flutter: message groups loaded: 6' + C.reset],
      [2, 'info', C.dim + 'flutter: unread pinned: 3' + C.reset]
    ],
    c_nimbus_gateway: [
      [131, 'info', C.gray + 'time=' + C.reset + '2026-10-29T09:31:02Z ' + C.gray + 'level=' + C.reset + C.green + 'INFO' + C.reset + ' msg="gateway starting" addr=:8080'],
      [131, 'info', C.gray + 'time=' + C.reset + '2026-10-29T09:31:02Z ' + C.gray + 'level=' + C.reset + C.green + 'INFO' + C.reset + ' msg="routes loaded" count=24'],
      [130, 'info', C.gray + 'time=' + C.reset + '2026-10-29T09:31:03Z ' + C.gray + 'level=' + C.reset + C.green + 'INFO' + C.reset + ' msg="upstream connected" name=billing'],
      [96, 'warn', C.gray + 'time=' + C.reset + '2026-10-29T09:31:37Z ' + C.gray + 'level=' + C.reset + C.yellow + 'WARN' + C.reset + ' msg="rate limit near threshold" route=/v1/export'],
      [60, 'info', C.gray + 'time=' + C.reset + '2026-10-29T09:32:13Z ' + C.gray + 'level=' + C.reset + C.green + 'INFO' + C.reset + ' msg="request" method=GET path=/v1/export status=200 dur=18ms'],
      [34, 'info', C.gray + 'time=' + C.reset + '2026-10-29T09:32:39Z ' + C.gray + 'level=' + C.reset + 'INFO msg="request" method=POST path=/v1/billing status=201 dur=42ms'],
      [11, 'info', C.gray + 'time=' + C.reset + '2026-10-29T09:33:02Z ' + C.gray + 'level=' + C.reset + 'INFO msg="health check ok" upstreams=2']
    ],
    c_atlas_boot: [
      [184, 'info', C.dim + '> Task :compileJava UP-TO-DATE' + C.reset],
      [182, 'info', C.dim + '> Task :processResources UP-TO-DATE' + C.reset],
      [180, 'info', 'Starting BillingApplication using Java 21.0.4'],
      [179, 'info', 'The following 2 profiles are active: "dev", "local"'],
      [177, 'info', 'Tomcat started on port 8081 (http) with context path \'\''],
      [177, 'info', C.green + 'Started BillingApplication in 6.412 seconds' + C.reset],
      [150, 'info', C.brightCyan + 'Hibernate:' + C.reset + ' select count(*) from billing_cycle'],
      [120, 'info', C.green + 'GET /api/billing/summary 200 12ms' + C.reset]
    ]
  };

  function linesOf(cid) {
    const src = logs[cid] || [
      [12, 'info', C.dim + '$ ' + (cmdById.get(cid) ? cmdById.get(cid).text : '') + C.reset],
      [11, 'info', 'Process started'],
      [8, 'info', C.green + 'done' + C.reset + ' in 2.1s']
    ];
    return src.map(([ago, level, text]) => ({ t: clock(ago * MIN), level, text }));
  }

  /* ───────── git ───────── */

  const commits = {
    p_aurora: [
      {
        sha: '9f3c1ab7d2e84c0f5a6b19d7e4c8b2a01f3d5e69',
        shortSha: '9f3c1ab',
        subject: 'feat(export): 导出中心按标签筛选',
        author: '林一舟',
        authorEmail: 'lin@demo-labs.dev',
        committedAt: iso(2 * HOUR + 4 * MIN),
        refs: ['HEAD -> feat/export-filters']
      },
      {
        sha: '4d2b8e1c9a7f3d5b2e0c6a41d8f9b3c7e5a2d104',
        shortSha: '4d2b8e1',
        subject: 'fix(export): 空标签时不再返回 500',
        author: '林一舟',
        authorEmail: 'lin@demo-labs.dev',
        committedAt: iso(26 * HOUR),
        refs: []
      },
      {
        sha: 'c81a0f35e7b2d9c4a1f06e83d5b7c2a9f4e1d608',
        shortSha: 'c81a0f3',
        subject: 'refactor(server): 拆分导出任务队列',
        author: '周子墨',
        authorEmail: 'zhou@demo-labs.dev',
        committedAt: iso(2 * DAY + 3 * HOUR),
        refs: []
      },
      {
        sha: '6e07d924b1c8a3f5d0e7c62a4f9b1d8e3c5a7f20',
        shortSha: '6e07d92',
        subject: 'test(export): 覆盖筛选组合用例',
        author: '周子墨',
        authorEmail: 'zhou@demo-labs.dev',
        committedAt: iso(2 * DAY + 5 * HOUR),
        refs: []
      },
      {
        sha: 'a3f59c47e1d9b6a2f8c03e75d1b4a9c6f2e8d013',
        shortSha: 'a3f59c4',
        subject: 'docs(export): 补充筛选字段说明',
        author: '林一舟',
        authorEmail: 'lin@demo-labs.dev',
        committedAt: iso(3 * DAY + 2 * HOUR),
        refs: []
      },
      {
        sha: '71b0e8d2c5a9f1b7e4d06c83a2f5b8d1e7c0a946',
        shortSha: '71b0e8d',
        subject: 'chore(deps): 升级 vite 到 8.3',
        author: '林一舟',
        authorEmail: 'lin@demo-labs.dev',
        committedAt: iso(4 * DAY + 4 * HOUR),
        refs: ['origin/main']
      },
      {
        sha: '0c7e2a61f4d8b3c9a5e17d20b6f4a8c1e3d5b790',
        shortSha: '0c7e2a6',
        subject: 'feat(overview): 总览增加磁盘占用提示',
        author: '周子墨',
        authorEmail: 'zhou@demo-labs.dev',
        committedAt: iso(5 * DAY + HOUR),
        refs: []
      },
      {
        sha: 'e2d94b7a3c1f5e8d0b6a42c9f7e3d1b5a8c0f264',
        shortSha: 'e2d94b7',
        subject: "merge branch 'main' into feat/export-filters",
        author: '林一舟',
        authorEmail: 'lin@demo-labs.dev',
        committedAt: iso(6 * DAY),
        refs: []
      }
    ]
  };

  const remoteCommits = {
    p_aurora: [
      {
        sha: 'b71c9d0e4a2f6c8b1d5e73a9f0c4b8d2e6a19f35',
        shortSha: 'b71c9d0',
        subject: 'feat(export): 后端分页参数改为游标',
        author: '沈知远',
        authorEmail: 'shen@demo-labs.dev',
        committedAt: iso(8 * HOUR),
        refs: []
      },
      {
        sha: '19fa2c2b8d5e1a7f4c0b63e2a9d7f5b1c8e40a26',
        shortSha: '19fa2c2',
        subject: 'fix(export): 修正文件名编码',
        author: '沈知远',
        authorEmail: 'shen@demo-labs.dev',
        committedAt: iso(2 * DAY + 2 * HOUR),
        refs: []
      }
    ]
  };

  const changes = {
    p_aurora: {
      isRepo: true,
      branch: 'feat/export-filters',
      clean: false,
      counts: { total: 4, staged: 0, unstaged: 3, untracked: 1 },
      files: [
        {
          path: 'web/src/export/ExportPanel.tsx',
          origPath: null,
          status: 'M',
          xy: ' M',
          staged: false,
          unstaged: true,
          untracked: false,
          added: 38,
          removed: 6,
          binary: false
        },
        {
          path: 'web/src/export/filters.ts',
          origPath: null,
          status: '??',
          xy: '??',
          staged: false,
          unstaged: true,
          untracked: true,
          added: 52,
          removed: 0,
          binary: false
        },
        {
          path: 'server/app/exports.py',
          origPath: null,
          status: 'M',
          xy: ' M',
          staged: false,
          unstaged: true,
          untracked: false,
          added: 12,
          removed: 4,
          binary: false
        },
        {
          path: 'docs/export.md',
          origPath: null,
          status: 'A',
          xy: 'A ',
          staged: true,
          unstaged: false,
          untracked: false,
          added: 24,
          removed: 0,
          binary: false
        }
      ]
    },
    p_mobile: {
      isRepo: true,
      branch: 'main',
      clean: false,
      counts: { total: 2, staged: 0, unstaged: 2, untracked: 0 },
      files: [
        {
          path: 'lib/features/messages/message_list.dart',
          origPath: null,
          status: 'M',
          xy: ' M',
          staged: false,
          unstaged: true,
          untracked: false,
          added: 64,
          removed: 18,
          binary: false
        },
        {
          path: 'lib/features/messages/group_header.dart',
          origPath: null,
          status: 'M',
          xy: ' M',
          staged: false,
          unstaged: true,
          untracked: false,
          added: 21,
          removed: 3,
          binary: false
        }
      ]
    },
    p_nimbus: {
      isRepo: true,
      branch: 'release/2.4',
      clean: false,
      counts: { total: 1, staged: 0, unstaged: 1, untracked: 0 },
      files: [
        {
          path: 'internal/ratelimit/prefix.go',
          origPath: null,
          status: 'M',
          xy: ' M',
          staged: false,
          unstaged: true,
          untracked: false,
          added: 17,
          removed: 2,
          binary: false
        }
      ]
    }
  };

  function cleanChanges(p) {
    return {
      isRepo: true,
      branch: branchOf(p.id),
      clean: true,
      counts: { total: 0, staged: 0, unstaged: 0, untracked: 0 },
      files: []
    };
  }

  const remoteBase = {
    isRepo: true,
    hasUpstream: true,
    upstream: 'origin/main',
    remoteName: 'origin',
    ahead: 0,
    behind: 0,
    sha: null,
    commits: [],
    truncated: false,
    fetched: { ok: true, timedOut: false, error: null },
    remotes: [
      {
        name: 'origin',
        url: 'git@github.com:demo-labs/aurora-platform.git',
        web: 'https://github.com/demo-labs/aurora-platform'
      }
    ]
  };

  function remoteOf(id) {
    if (id === 'p_aurora') {
      return Object.assign({}, remoteBase, {
        upstream: 'origin/feat/export-filters',
        ahead: 3,
        behind: 2,
        sha: remoteCommits.p_aurora[0].sha,
        commits: remoteCommits.p_aurora.map((c) => Object.assign({}, c))
      });
    }
    return Object.assign({}, remoteBase);
  }

  function branchOf(id) {
    if (id === 'p_aurora') return 'feat/export-filters';
    if (id === 'p_mobile') return 'main';
    if (id === 'p_beacon') return 'main';
    if (id === 'p_nimbus') return 'release/2.4';
    if (id === 'p_notes') return 'main';
    if (id === 'p_atlas') return 'feat/cost-center';
    return 'main';
  }

  const commitFiles = {
    '9f3c1ab7d2e84c0f5a6b19d7e4c8b2a01f3d5e69': [
      { path: 'web/src/export/ExportPanel.tsx', status: 'M', added: 38, removed: 6, binary: false, untracked: false, origPath: null },
      { path: 'web/src/export/filters.ts', status: 'A', added: 52, removed: 0, binary: false, untracked: false, origPath: null },
      { path: 'docs/export.md', status: 'A', added: 24, removed: 0, binary: false, untracked: false, origPath: null }
    ],
    '4d2b8e1c9a7f3d5b2e0c6a41d8f9b3c7e5a2d104': [
      { path: 'server/app/exports.py', status: 'M', added: 9, removed: 4, binary: false, untracked: false, origPath: null },
      { path: 'server/tests/test_exports.py', status: 'M', added: 16, removed: 0, binary: false, untracked: false, origPath: null }
    ],
    'c81a0f35e7b2d9c4a1f06e83d5b7c2a9f4e1d608': [
      { path: 'server/app/jobs/export_queue.py', status: 'A', added: 88, removed: 0, binary: false, untracked: false, origPath: null },
      { path: 'server/app/exports.py', status: 'M', added: 12, removed: 41, binary: false, untracked: false, origPath: null }
    ]
  };

  /**
   * 提交正文（真实接口里是 `git show -s --format=%b`）：右面板的提交说明按 markdown 渲染。
   * 只给展开后需要展示的几条准备，其余提交没有正文 —— 与真实仓库里「很多提交只有标题」一致。
   */
  const commitBodies = {
    '9f3c1ab7d2e84c0f5a6b19d7e4c8b2a01f3d5e69':
      '- 导出中心支持按**标签**筛选，多选为「或」语义\n' +
      '- 筛选条件写入 URL query，刷新后可还原\n' +
      '- `ExportPanel` 拆出 `filters.ts`，纯函数便于补用例\n\n' +
      '界面说明见 `docs/export.md`。',
    '4d2b8e1c9a7f3d5b2e0c6a41d8f9b3c7e5a2d104':
      '空标签集合不再拼出 `IN ()` 这种非法 SQL：\n\n' +
      '```python\nif not tags:\n    return []\n```\n\n' +
      '回归用例：`server/tests/test_exports.py`。',
    'c81a0f35e7b2d9c4a1f06e83d5b7c2a9f4e1d608':
      '导出任务从同步改成队列：\n\n' +
      '1. `enqueue()` 只写任务表，不再阻塞请求\n' +
      '2. worker 按 `priority` 出队，失败两次后进死信\n' +
      '3. 旧接口保留一个版本，先标记废弃'
  };

  const diffExportPanel = [
    'diff --git a/web/src/export/ExportPanel.tsx b/web/src/export/ExportPanel.tsx',
    'index 3c1f2a9..8b7d4e2 100644',
    '--- a/web/src/export/ExportPanel.tsx',
    '+++ b/web/src/export/ExportPanel.tsx',
    '@@ -1,18 +1,42 @@',
    " import { useState } from 'react';",
    "+import { TagFilter } from './filters';",
    "+import { useRememberedTags } from './useRememberedTags';",
    " import { ExportTable } from './ExportTable';",
    " import { Button } from '../../components/Button';",
    ' ',
    ' export function ExportPanel({ projectId }: { projectId: string }) {',
    '-  const [range, setRange] = useState<Range>(defaultRange);',
    '+  const [range, setRange] = useState<Range>(defaultRange);',
    "+  const { tags, setTags } = useRememberedTags(projectId);",
    "+  const [page, setPage] = useState(1);",
    ' ',
    '   return (',
    '     <section className="export-panel">',
    '       <header className="export-toolbar">',
    '         <RangePicker value={range} onChange={setRange} />',
    '+        <TagFilter value={tags} onChange={setTags} />',
    '+        <span className="export-count">',
    '+          {tags.length ? `已选 ${tags.length} 个标签` : \'全部标签\'}',
    '+        </span>',
    '       </header>',
    ' ',
    '-      <ExportTable projectId={projectId} range={range} />',
    '+      <ExportTable',
    '+        projectId={projectId}',
    '+        range={range}',
    '+        tags={tags}',
    '+        page={page}',
    '+        onPage={setPage}',
    '+      />',
    '     </section>',
    '   );',
    ' }',
    '-',
    '-// TODO: 标签筛选待接入',
    '+',
    '+// 选择持久化在 filters.ts：key = pm.export.tags.<projectId>',
    "+// 不选任何标签等价于全部，接口层不做二次过滤。"
  ].join('\n');

  const diffFilters = [
    "import { useEffect, useState } from 'react';",
    '',
    'const KEY = (projectId: string) => `pm.export.tags.${projectId}`;',
    '',
    'export type Tags = string[];',
    '',
    'function read(projectId: string): Tags {',
    '  try {',
    '    const raw = JSON.parse(localStorage.getItem(KEY(projectId)) || \'[]\');',
    '    return Array.isArray(raw) ? raw.filter((t) => typeof t === \'string\') : [];',
    '  } catch {',
    '    return [];',
    '  }',
    '}',
    '',
    'function write(projectId: string, tags: Tags) {',
    '  try {',
    '    localStorage.setItem(KEY(projectId), JSON.stringify(tags));',
    '  } catch {',
    '    /* 隐私模式下忽略 */',
    '  }',
    '}',
    '',
    'export function useRememberedTags(projectId: string) {',
    '  const [tags, setTags] = useState<Tags>(() => read(projectId));',
    '',
    '  useEffect(() => {',
    '    setTags(read(projectId));',
    '  }, [projectId]);',
    '',
    '  function update(next: Tags) {',
    '    const clean = Array.from(new Set(next)).filter(Boolean);',
    '    setTags(clean);',
    '    write(projectId, clean);',
    '  }',
    '',
    '  return { tags, setTags: update };',
    '}',
    '',
    'export const ALL_TAGS: Tags = [',
    "  '财务',",
    "  '运营',",
    "  '风控',",
    "  '增长',",
    "  '研发'",
    '];'
  ].join('\n');

  /* ───────── 统计（按项目按日聚合，数值为演示数据） ───────── */

  const weights = {
    p_aurora: 4.2,
    p_mobile: 2.4,
    p_beacon: 1.3,
    p_nimbus: 2.0,
    p_notes: 0.5,
    p_atlas: 2.8
  };

  const doneByOffset = {
    p_aurora: { 2: 1, 4: 1, 8: 1 },
    p_mobile: { 1: 1, 5: 1 },
    p_beacon: { 3: 1, 20: 1 },
    p_nimbus: { 0: 1, 2: 1, 6: 1 },
    p_notes: { 10: 1, 15: 1 },
    p_atlas: { 1: 1, 4: 1, 6: 1 }
  };

  const rejectedByOffset = { p_aurora: { 6: 1 } };

  function hash(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i += 1) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function localDate(d) {
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function datesBetween(since, until) {
    const out = [];
    const [y, m, d] = since.split('-').map(Number);
    for (let i = 0; ; i += 1) {
      const cur = new Date(y, m - 1, d + i);
      const key = localDate(cur);
      if (key > until) break;
      out.push({ key, dow: cur.getDay() });
    }
    return out;
  }

  function activity({ since, until }) {
    const dates = datesBetween(since, until);
    const untilTs = new Date(until + 'T00:00:00').getTime();
    const list = projects
      .filter((p) => !p.archived)
      .map((p) => {
        const days = dates.map(({ key, dow }) => {
          const h = hash(p.id + '|' + key);
          const r = (h % 1000) / 1000;
          const weekend = dow === 0 || dow === 6;
          const w = weights[p.id] || 1;
          let n = Math.round(w * (weekend ? 0.3 : 1) * (0.35 + r * 1.25));
          if (r < 0.1) n = 0;
          const added = n ? Math.round(n * (110 + (h % 170))) : 0;
          const removed = n ? Math.round(n * (25 + (h % 80))) : 0;
          const offset = Math.round((untilTs - new Date(key + 'T00:00:00').getTime()) / DAY);
          const done = (doneByOffset[p.id] || {})[offset] || 0;
          const rejected = (rejectedByOffset[p.id] || {})[offset] || 0;
          return { date: key, commits: n, added, removed, done, rejected };
        });
        return {
          id: p.id,
          name: p.name,
          branch: branchOf(p.id),
          isRepo: true,
          error: null,
          truncated: false,
          days
        };
      });
    return { since, until, projects: list };
  }

  /* ───────── 事件 ───────── */

  const ev = (o) => Object.assign({ id: 'e_' + Math.random().toString(36).slice(2, 9), actor: { kind: 'user', name: '我' } }, o);

  const auditEvents = [
    ev({
      at: iso(25 * MIN),
      type: 'requirement.completed',
      projectId: 'p_aurora',
      requirementId: 'r_aurora_12',
      actor: { kind: 'agent', name: 'scout-agent' },
      data: { projectName: '星港数据平台', seq: 12, title: '导出中心支持按标签筛选并记住上次选择', agent: 'scout-agent', note: '筛选栏与本地记忆已完成' }
    }),
    ev({
      at: iso(42 * MIN),
      type: 'command.started',
      projectId: 'p_aurora',
      commandId: 'c_aurora_web',
      data: { projectName: '星港数据平台', name: '前端开发', text: 'pnpm dev' }
    }),
    ev({
      at: iso(2 * HOUR),
      type: 'requirement.claimed',
      projectId: 'p_aurora',
      requirementId: 'r_aurora_12',
      actor: { kind: 'agent', name: 'scout-agent' },
      data: { projectName: '星港数据平台', seq: 12, title: '导出中心支持按标签筛选并记住上次选择', agent: 'scout-agent' }
    }),
    ev({
      at: iso(3 * HOUR + 12 * MIN),
      type: 'requirement.created',
      projectId: 'p_aurora',
      requirementId: 'r_aurora_12',
      actor: { kind: 'agent', name: 'AI 巡检' },
      data: { projectName: '星港数据平台', seq: 12, title: '导出中心支持按标签筛选并记住上次选择', source: 'ai' }
    }),
    ev({
      at: iso(6 * HOUR),
      type: 'requirement.status_changed',
      projectId: 'p_nimbus',
      requirementId: 'r_nimbus_18',
      actor: { kind: 'agent', name: 'scout-agent' },
      data: { projectName: 'Nimbus 网关', seq: 18, title: '网关限流规则支持按路径前缀匹配', from: 'doing', to: 'done', note: '已上线，灰度期间无异常' }
    }),
    ev({
      at: iso(8 * HOUR),
      type: 'command.detached',
      projectId: 'p_nimbus',
      commandId: 'c_nimbus_worker',
      data: { projectName: 'Nimbus 网关', name: '异步任务 Worker', reason: 'quit_detach' }
    }),
    ev({
      at: iso(12 * MIN),
      type: 'requirement.completed',
      projectId: 'p_atlas',
      requirementId: 'r_atlas_9',
      actor: { kind: 'agent', name: 'scout-agent' },
      data: { projectName: 'Atlas 计费', seq: 9, title: '账单明细支持按成本中心汇总', agent: 'scout-agent', note: '汇总视图已上线' }
    }),
    ev({
      at: iso(1 * DAY + 2 * HOUR),
      type: 'requirement.status_changed',
      projectId: 'p_atlas',
      requirementId: 'r_atlas_8',
      data: { projectName: 'Atlas 计费', seq: 8, title: '对账任务失败时自动重试两次', from: 'doing', to: 'done' }
    }),
    ev({
      at: iso(1 * DAY + 3 * HOUR),
      type: 'command.exited',
      projectId: 'p_aurora',
      commandId: 'c_aurora_api',
      data: { projectName: '星港数据平台', name: '接口服务', text: 'uvicorn app.main:app --reload --port 8000', exitCode: 1 }
    }),
    ev({
      at: iso(1 * DAY + 5 * HOUR),
      type: 'requirement.status_changed',
      projectId: 'p_mobile',
      requirementId: 'r_mobile_6',
      actor: { kind: 'agent', name: 'cursor-agent' },
      data: { projectName: '极光移动端', seq: 6, title: '启动页权限弹窗文案统一', from: 'doing', to: 'done' }
    }),
    ev({
      at: iso(2 * DAY + 4 * HOUR),
      type: 'requirement.status_changed',
      projectId: 'p_aurora',
      requirementId: 'r_aurora_11',
      actor: { kind: 'agent', name: 'scout-agent' },
      data: { projectName: '星港数据平台', seq: 11, title: '批量导入失败时提供可下载的错误明细', from: 'doing', to: 'done', note: '失败行可导出 CSV' }
    }),
    ev({
      at: iso(2 * DAY + 7 * HOUR),
      type: 'settings.changed',
      projectId: null,
      actor: { kind: 'system', name: 'system' },
      data: {}
    }),
    ev({
      at: iso(3 * DAY + 2 * HOUR),
      type: 'requirement.created',
      projectId: 'p_beacon',
      requirementId: 'r_beacon_3',
      actor: { kind: 'agent', name: 'AI 巡检' },
      data: { projectName: '灯塔控制台', seq: 3, title: '看板支持拖拽调整卡片顺序', source: 'ai' }
    }),
    ev({
      at: iso(3 * DAY + 6 * HOUR),
      type: 'project.updated',
      projectId: 'p_nimbus',
      data: { projectName: 'Nimbus 网关', changes: ['path'], syncedCommands: 2 }
    }),
    ev({
      at: iso(3 * DAY + 9 * HOUR),
      type: 'command.exited',
      projectId: 'p_beacon',
      commandId: 'c_beacon_web',
      data: { projectName: '灯塔控制台', name: '本地预览', exitCode: 0 }
    }),
    ev({
      at: iso(4 * DAY + 3 * HOUR),
      type: 'requirement.status_changed',
      projectId: 'p_aurora',
      requirementId: 'r_aurora_10',
      data: { projectName: '星港数据平台', seq: 10, title: '接入 OpenTelemetry 上报关键链路耗时', from: 'doing', to: 'done' }
    }),
    ev({
      at: iso(4 * DAY + 8 * HOUR),
      type: 'requirement.status_changed',
      projectId: 'p_atlas',
      requirementId: 'r_atlas_7',
      data: { projectName: 'Atlas 计费', seq: 7, title: '修复金额格式化在负数时的显示', from: 'doing', to: 'done' }
    }),
    ev({
      at: iso(5 * DAY + 2 * HOUR),
      type: 'command.spawn_failed',
      projectId: 'p_mobile',
      commandId: 'c_mobile_app',
      data: { projectName: '极光移动端', name: 'iOS 模拟器', message: 'No connected devices found' }
    }),
    ev({
      at: iso(5 * DAY + 7 * HOUR),
      type: 'requirement.status_changed',
      projectId: 'p_mobile',
      requirementId: 'r_mobile_5',
      data: { projectName: '极光移动端', seq: 5, title: '修复深色模式下输入框边框不可见', from: 'doing', to: 'done' }
    }),
    ev({
      at: iso(6 * DAY + 2 * HOUR),
      type: 'requirement.status_changed',
      projectId: 'p_aurora',
      requirementId: 'r_aurora_9',
      data: { projectName: '星港数据平台', seq: 9, title: '移除已废弃的 v1 导出接口', from: 'todo', to: 'rejected', note: '有外部调用方仍在使用，暂不删除' }
    }),
    ev({
      at: iso(6 * DAY + 9 * HOUR),
      type: 'data.restored',
      projectId: null,
      data: { backupName: 'db-2026-10-22.json' }
    }),
    ev({
      at: iso(7 * DAY + 4 * HOUR),
      type: 'project.archived',
      projectId: 'p_legacy',
      data: { projectName: '旧版官网' }
    })
  ];

  function timelineOf(rid) {
    const list = [
      ev({
        at: iso(25 * MIN),
        type: 'requirement.completed',
        projectId: 'p_aurora',
        requirementId: rid,
        actor: { kind: 'agent', name: 'scout-agent' },
        data: { projectName: '星港数据平台', seq: 12, title: '导出中心支持按标签筛选并记住上次选择', agent: 'scout-agent', note: '筛选栏与本地记忆已完成' }
      }),
      ev({
        at: iso(2 * HOUR),
        type: 'requirement.claimed',
        projectId: 'p_aurora',
        requirementId: rid,
        actor: { kind: 'agent', name: 'scout-agent' },
        data: { projectName: '星港数据平台', seq: 12, title: '导出中心支持按标签筛选并记住上次选择', agent: 'scout-agent' }
      }),
      ev({
        at: iso(3 * HOUR + 12 * MIN),
        type: 'requirement.created',
        projectId: 'p_aurora',
        requirementId: rid,
        actor: { kind: 'agent', name: 'AI 巡检' },
        data: { projectName: '星港数据平台', seq: 12, title: '导出中心支持按标签筛选并记住上次选择', source: 'ai' }
      })
    ];
    if (rid === 'r_atlas_9') {
      return [
        ev({
          at: iso(12 * MIN),
          type: 'requirement.completed',
          projectId: 'p_atlas',
          requirementId: rid,
          actor: { kind: 'agent', name: 'scout-agent' },
          data: { projectName: 'Atlas 计费', seq: 9, title: '账单明细支持按成本中心汇总', agent: 'scout-agent', note: '汇总视图已上线' }
        }),
        ev({
          at: iso(5 * HOUR),
          type: 'requirement.claimed',
          projectId: 'p_atlas',
          requirementId: rid,
          actor: { kind: 'agent', name: 'scout-agent' },
          data: { projectName: 'Atlas 计费', seq: 9, title: '账单明细支持按成本中心汇总', agent: 'scout-agent' }
        }),
        ev({
          at: iso(3 * DAY),
          type: 'requirement.created',
          projectId: 'p_atlas',
          requirementId: rid,
          actor: { kind: 'agent', name: 'AI 巡检' },
          data: { projectName: 'Atlas 计费', seq: 9, title: '账单明细支持按成本中心汇总', source: 'ai' }
        })
      ];
    }
    return list;
  }

  /* ───────── 备份 ───────── */

  const backups = (() => {
    const out = [];
    for (let i = 0; i < 7; i += 1) {
      const d = new Date(NOW - i * DAY);
      out.push({
        name: 'db-' + localDate(d) + '.json',
        kind: 'daily',
        date: localDate(d),
        time: '08:00',
        size: 180000 + i * 2400,
        valid: true,
        projectCount: 7,
        requirementCount: 23,
        commandCount: 12
      });
    }
    out.push({
      name: 'manual-20261028-213015.json',
      kind: 'manual',
      date: '2026-10-28',
      time: '21:30',
      size: 192400,
      valid: true,
      projectCount: 7,
      requirementCount: 22,
      commandCount: 12
    });
    out.push({
      name: 'manual-20261021-090402.json',
      kind: 'manual',
      date: '2026-10-21',
      time: '09:04',
      size: 188100,
      valid: true,
      projectCount: 7,
      requirementCount: 20,
      commandCount: 11
    });
    return out;
  })();

  /* ───────── 视图组装 ───────── */

  function reqsOf(pid) {
    return requirements
      .filter((r) => r.projectId === pid)
      .slice()
      .sort((a, b) => b.seq - a.seq);
  }

  function cmdsOf(pid) {
    return commands.filter((c) => c.projectId === pid);
  }

  /** 演示桥也要还原真实接口的 extras 形状，否则项目设置弹窗看不到示例数据 */
  function projectExtras(p) {
    const ex = (p && p.extras) || {};
    return {
      links: (ex.links || []).map((l) => {
        const t = projects.find((x) => x.id === l.projectId);
        return {
          id: l.id,
          projectId: l.projectId,
          note: l.note || '',
          name: t ? t.name : '',
          path: t ? t.path : '',
          archived: !!(t && t.archived),
          exists: !!t
        };
      }),
      env: (ex.env || []).map((e) => ({ id: e.id, key: e.key, value: e.value })),
      rules: (ex.rules || []).map((r) => ({
        id: r.id,
        title: r.title || '',
        body: r.body || '',
        enabled: r.enabled !== false,
        skills: Array.isArray(r.skills) ? r.skills : []
      }))
    };
  }

  function projectView(p) {
    const reqs = reqsOf(p.id);
    const unfinished = reqs.filter((r) => UNFINISHED.includes(r.status));
    const cmds = cmdsOf(p.id);
    return {
      id: p.id,
      name: p.name,
      path: p.path,
      archived: !!p.archived,
      aiScout: p.aiScout !== false,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt || p.createdAt,
      requirementCount: reqs.length,
      pendingCount: unfinished.length,
      todoCount: reqs.filter((r) => r.status === 'todo').length,
      doingCount: reqs.filter((r) => r.status === 'doing').length,
      reviewCount: reqs.filter((r) => r.status === 'review').length,
      doneCount: reqs.filter((r) => r.status === 'done').length,
      rejectedCount: reqs.filter((r) => r.status === 'rejected').length,
      commandCount: cmds.length,
      runningCount: cmds.filter(isActive).length,
      commands: cmds.map((c) => ({
        id: c.id,
        text: c.text,
        name: c.name || '',
        status: c.runs[0] && c.runs[0].status === 'running' ? 'running' : 'stopped',
        lastRun: c.runs[0] || null
      }))
    };
  }

  /* ───────── 方法实现 ───────── */

  function genericCommits(id) {
    return [
      {
        sha: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
        shortSha: 'a1b2c3d',
        subject: 'feat: 完善「' + (projects.find((p) => p.id === id) || {}).name + '」的核心流程',
        author: '林一舟',
        authorEmail: 'lin@demo-labs.dev',
        committedAt: iso(2 * DAY),
        refs: ['HEAD -> ' + branchOf(id)]
      },
      {
        sha: 'b2c3d4e5f60718293a4b5c6d7e8f901234567890',
        shortSha: 'b2c3d4e',
        subject: 'fix: 修正边界条件与错误提示',
        author: '周子墨',
        authorEmail: 'zhou@demo-labs.dev',
        committedAt: iso(4 * DAY),
        refs: []
      },
      {
        sha: 'c3d4e5f60718293a4b5c6d7e8f90123456789012',
        shortSha: 'c3d4e5f',
        subject: 'chore: 更新依赖与构建配置',
        author: '林一舟',
        authorEmail: 'lin@demo-labs.dev',
        committedAt: iso(7 * DAY),
        refs: []
      }
    ];
  }

  function snippet(path, lines) {
    return {
      path,
      exists: true,
      lines: lines.map((text, i) => ({ n: i + 1, text })),
      totalLines: lines.length,
      truncated: false
    };
  }

  const handlers = {
    projects: () => ({ projects: projects.map(projectView) }),
    project: ({ id }) => {
      const p = projects.find((x) => x.id === id);
      return { project: projectView(p), extras: projectExtras(p) };
    },
    requirements: ({ id }) => ({ requirements: reqsOf(id).map(reqView) }),
    pendingRequirements: ({ id }) => ({
      requirements: reqsOf(id).filter((r) => UNFINISHED.includes(r.status)).map(reqView)
    }),
    createRequirement: ({ id, data }) => {
      const seqs = reqsOf(id).map((r) => r.seq);
      const r = {
        id: 'r_demo_' + Date.now(),
        projectId: id,
        seq: (seqs.length ? Math.max.apply(null, seqs) : 0) + 1,
        title: data.title,
        body: data.body || '',
        note: data.note || '',
        source: 'manual',
        status: 'todo',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      requirements.push(r);
      return { requirement: reqView(r) };
    },
    updateRequirement: ({ rid, patch }) => {
      const r = reqById.get(rid);
      if (r) Object.assign(r, patch, { updatedAt: new Date().toISOString() });
      return { requirement: r ? reqView(r) : null };
    },
    deleteRequirement: ({ rid }) => {
      const i = requirements.findIndex((r) => r.id === rid);
      if (i >= 0) requirements.splice(i, 1);
      return { ok: true };
    },
    setRequirementStatus: ({ rid, status, note }) => {
      const r = reqById.get(rid);
      if (r) {
        r.status = status;
        r.updatedAt = new Date().toISOString();
        if (note !== undefined) r.note = note;
      }
      return { requirement: r ? reqView(r) : null };
    },
    commands: ({ id }) => ({ commands: cmdsOf(id).map(cmdView) }),
    commandStatus: ({ cid }) => ({ command: cmdById.get(cid) ? cmdView(cmdById.get(cid)) : null }),
    commandRuns: ({ cid }) => {
      const c = cmdById.get(cid);
      return { runs: c ? c.runs.slice() : [] };
    },
    startCommand: ({ cid }) => {
      const c = cmdById.get(cid);
      if (c) {
        c.runs.unshift(run(0, { status: 'running', pid: 20000 + Math.floor(Math.random() * 999) }));
      }
      return { command: c ? cmdView(c) : null };
    },
    stopCommand: ({ cid }) => {
      const c = cmdById.get(cid);
      if (c && c.runs[0]) {
        c.runs[0].status = 'stopped';
        c.runs[0].endedAt = new Date().toISOString();
        c.runs[0].alive = false;
      }
      return { command: c ? cmdView(c) : null };
    },
    logs: ({ cid, runId }) => {
      const c = cmdById.get(cid);
      if (!c) return { run: null, lines: [], truncated: false, running: false };
      const chosen = (runId && c.runs.find((r) => r.id === runId)) || c.runs[0];
      return {
        run: chosen || null,
        lines: linesOf(cid),
        truncated: false,
        running: !!(c.runs[0] && c.runs[0].status === 'running')
      };
    },
    gitSummary: () => ({
      projects: projects
        .filter((p) => !p.archived)
        .map((p) => {
          const ch = changes[p.id];
          const files = ch ? ch.counts.total : 0;
          return {
            id: p.id,
            name: p.name,
            isRepo: true,
            dirty: files > 0,
            files,
            sample: ch
              ? ch.files.slice(0, 2).map((f) => ({ path: f.path, code: f.status }))
              : []
          };
        })
    }),
    gitChanges: ({ id }) => changes[id] || cleanChanges(projects.find((p) => p.id === id) || { id }),
    gitCommits: ({ id, limit, skip }) => {
      const all = commits[id] || genericCommits(id);
      const start = Number(skip) || 0;
      return { commits: all.slice(start, start + (Number(limit) || 30)), hasMore: start + (Number(limit) || 30) < all.length };
    },
    gitRemote: ({ id }) => remoteOf(id),
    gitCommitFiles: ({ sha }) => ({ sha, files: commitFiles[sha] || [], body: commitBodies[sha] || '' }),
    gitDiff: ({ path, untracked }) => {
      if (untracked) {
        return { path, untracked: true, binary: false, content: diffFilters, truncated: false };
      }
      return { path, untracked: false, binary: false, diff: diffExportPanel, truncated: false };
    },
    gitCommitDiff: ({ sha, path }) => ({
      sha,
      path,
      binary: false,
      diff: diffExportPanel,
      truncated: false
    }),
    gitActivity: ({ since, until }) => activity({ since, until }),
    gitPull: () => ({ before: { behind: 0, ahead: 0 } }),
    gitPush: () => ({ before: { ahead: 0, behind: 0 } }),
    gitCommit: ({ message }) => {
      const subject = String(message || '').split(/\r?\n/)[0];
      return { ok: true, sha: 'f7e6d5c4b3a29180f7e6d5c4b3a29180f7e6d5c4', shortSha: 'f7e6d5c', subject };
    },
    events: () => ({ events: auditEvents.slice(), hasMore: false, nextBefore: null }),
    requirementTimeline: ({ rid }) => ({ events: timelineOf(rid), hasMore: false, nextBefore: null }),
    notificationSettings: () => ({
      notifications: { enabled: true, reviewReady: true, commandFailed: true, aiRequirement: true }
    }),
    saveNotificationSettings: ({ patch }) => ({
      notifications: Object.assign({ enabled: true, reviewReady: true, commandFailed: true, aiRequirement: true }, patch || {})
    }),
    backups: () => ({ dir: 'C:\\Users\\demo\\AppData\\Roaming\\project-manager\\data\\backups', backups: backups.slice() }),
    restoreBackup: () => ({ ok: true }),
    mcpInfo: () => ({ url: 'http://127.0.0.1:7318/mcp', port: 7318, running: true, tools: 4 }),
    scoutPrompt: () => ({ version: '2026.10.2', stub: '1. GET http://127.0.0.1:7318/prompt/scout.txt 取巡检手册\n2. 按手册执行，用 pm_create_requirement 提交需求（source=ai）' }),
    workerPrompt: () => ({ stub: '你的 AgentID： {{ agent }}\n\n1. GET http://127.0.0.1:7318/prompt/worker.txt 取执行手册\n2. 按手册执行：/next 取一件 → /complete 交付' }),
    agents: () => ({
      agents: [{ id: 'a_demo1', name: 'demo', createdAt: '2026-11-07T08:00:00.000Z' }]
    }),
    createAgent: ({ name }) => ({
      agent: { id: 'a_demo' + Math.random().toString(36).slice(2, 7), name, createdAt: new Date().toISOString() }
    }),
    deleteAgent: () => ({ ok: true }),
    dataStatus: () => ({ corrupted: false }),
    ides: () => ({
      ides: [
        { id: 'cursor', name: 'Cursor' },
        { id: 'vscode', name: 'Visual Studio Code' },
        { id: 'idea', name: 'IntelliJ IDEA' }
      ],
      lastIdeId: 'cursor'
    }),
    openInIde: () => ({ ok: true }),
    openInTerminal: () => ({ ok: true }),
    openUrl: () => ({ ok: true }),
    revealProject: () => ({ ok: true }),
    revealDataDir: () => ({ ok: true }),
    pickFolder: () => ({ path: 'D:\\workspace\\new-project' }),
    pickScript: () => ({ path: 'D:\\workspace\\aurora-platform\\web\\package.json' }),
    createProject: ({ name, path, aiScout }) => {
      const p = {
        id: 'p_demo_' + Date.now(),
        name: name || '新项目',
        path: path || 'D:\\workspace\\demo',
        aiScout: aiScout !== false,
        createdAt: new Date().toISOString()
      };
      projects.push(p);
      return { project: projectView(p) };
    },
    updateProject: ({ id, patch }) => {
      const p = projects.find((x) => x.id === id);
      if (p) {
        const body = { ...(patch || {}) };
        if (body.extras) {
          p.extras = p.extras || { links: [], env: [], rules: [] };
          ['links', 'env', 'rules'].forEach((k) => {
            if (!body.extras[k]) return;
            p.extras[k] = body.extras[k].map((x, i) => ({
              ...x,
              id: x.id || 'pextra_' + k + '_' + Date.now() + '_' + i
            }));
          });
          delete body.extras;
        }
        Object.assign(p, body);
      }
      return {
        project: p ? projectView(p) : null,
        extras: p ? projectExtras(p) : null,
        syncedCommands: 0
      };
    },
    archiveProject: ({ id }) => {
      const p = projects.find((x) => x.id === id);
      if (p) p.archived = true;
      return { ok: true };
    },
    deleteProject: ({ id }) => {
      const i = projects.findIndex((x) => x.id === id);
      if (i >= 0) projects.splice(i, 1);
      return { ok: true, removed: { requirements: 0, commands: 0 } };
    },
    reorderProjects: () => ({ ok: true }),
    createCommand: ({ id, data }) => {
      const c = {
        id: 'c_demo_' + Date.now(),
        projectId: id,
        name: data.name || '',
        text: data.text || '',
        cwd: data.cwd || 'D:\\workspace\\demo',
        runs: []
      };
      commands.push(c);
      return { command: cmdView(c) };
    },
    updateCommand: ({ cid, patch }) => {
      const c = cmdById.get(cid);
      if (c) Object.assign(c, patch || {});
      return { command: c ? cmdView(c) : null };
    },
    deleteCommand: ({ cid }) => {
      const i = commands.findIndex((c) => c.id === cid);
      if (i >= 0) commands.splice(i, 1);
      return { ok: true };
    },
    fileSnippet: ({ path }) => snippet(path, ['// 演示文件内容', 'export const demo = true;'])
  };

  function invoke(method, params) {
    return new Promise((resolve) => {
      setTimeout(() => {
        const fn = handlers[method];
        if (!fn) {
          resolve({ ok: false, status: 404, code: 'demo_not_implemented', message: '演示环境未实现：' + method });
          return;
        }
        try {
          resolve({ ok: true, data: fn(params || {}) || {} });
        } catch (e) {
          resolve({ ok: false, status: 500, code: 'demo_error', message: e.message });
        }
      }, 24);
    });
  }

  let quitAsk = null;
  window.pm = {
    platform: 'win32',
    invoke,
    onNavigate: () => () => {},
    onQuitAsk(cb) {
      quitAsk = cb;
      return () => {
        if (quitAsk === cb) quitAsk = null;
      };
    },
    answerQuit: () => Promise.resolve()
  };

  /** 截图脚本用它触发退出询问弹窗 */
  window.__pmDemo = {
    quit() {
      if (quitAsk) {
        quitAsk({
          items: [
            { name: '前端开发', text: 'pnpm dev' },
            { name: '网关服务', text: 'go run ./cmd/gateway -config ./config/dev.yaml' },
            { name: '异步任务 Worker', text: 'go run ./cmd/worker' }
          ],
          total: 3
        });
      }
    }
  };
})();

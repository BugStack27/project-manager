/**
 * 前端原生通道适配层：把原来的 HTTP 请求换成 IPC 调用。
 * 错误形状保持旧约定（err.status / err.code），调用方无需修改。
 */

async function call(method, params) {
  if (typeof window === 'undefined' || !window.pm) {
    throw new Error('原生通道不可用：请通过桌面应用打开，而不是浏览器');
  }
  const res = await window.pm.invoke(method, params || {});
  if (!res || res.ok !== true) {
    const err = new Error((res && res.message) || '调用失败');
    err.status = res && res.status;
    err.code = res && res.code;
    throw err;
  }
  return res.data;
}

export const api = {
  projects: (includeArchived) => call('projects', { includeArchived: !!includeArchived }),
  project: (id) => call('project', { id }),
  /** Android 项目的启动图标（dataURL）：按需取，不进项目列表轮询 */
  projectIcon: (id) => call('projectIcon', { id }),
  createProject: (data) =>
    call('createProject', {
      name: data.name,
      path: data.path,
      aiScout: data.aiScout !== false,
      /** true / false 为项目自定义，null 表示跟随全局的启动自动拉取设置 */
      autoPull: typeof data.autoPull === 'boolean' ? data.autoPull : null
    }),
  updateProject: (id, patch) => call('updateProject', { id, patch }),
  /** 侧栏拖拽排序：ids 为未归档项目的完整新顺序 */
  reorderProjects: (ids) => call('reorderProjects', { ids }),
  archiveProject: (id) => call('archiveProject', { id }),
  /** 彻底移除登记：只删项目及其需求 / 命令 / 运行日志，不动磁盘上的代码目录；仅限已归档项目 */
  deleteProject: (id) => call('deleteProject', { id }),
  revealProject: (id) => call('revealProject', { id }),
  ides: (refresh) => call('ides', { refresh: !!refresh }),
  openInIde: (id, ideId) => call('openInIde', { id, ideId }),
  openInTerminal: (id) => call('openInTerminal', { id }),
  /** 版本与平台：侧栏品牌区的版本号用（domain 层不引 electron，值由主进程注入） */
  appInfo: () => call('appInfo', {}),

  /** 备份与恢复：列出每日快照与手动安全备份；恢复会覆盖 db.json 并自动重启应用 */
  backups: () => call('backups', {}),
  restoreBackup: (name) => call('restoreBackup', { name }),
  /** 启动自检：数据文件损坏时 corrupted 为 true，界面顶部提示并引导恢复备份 */
  dataStatus: () => call('dataStatus', {}),
  /** 在系统文件管理器中打开数据目录（db.json / backups / runs） */
  revealDataDir: () => call('revealDataDir', {}),

  pickFolder: (initial) => call('pickFolder', { initial: initial || '' }),
  pickScript: (initial) => call('pickScript', { initial: initial || '' }),

  mcpInfo: () => call('mcpInfo', {}),
  /**
   * 重试启动 MCP 服务：返回与 mcpInfo 同形状。
   * url 非空即成功；仍未起来时 error 给 { code, port, message }（端口被占用时 code=EADDRINUSE）。
   */
  mcpRetry: () => call('mcpRetry', {}),
  /** 取接入说明与当前巡检手册版本（对外只暴露版本，不暴露提示词存放位置） */
  scoutPrompt: () => call('scoutPrompt', {}),
  /** 执行 agent 的接入说明（取 worker 手册 → 按手册取单干活） */
  workerPrompt: () => call('workerPrompt', {}),
  /** Agent 注册表：界面按名称展示，复制接入说明时用 AgentID */
  agents: () => call('agents', {}),
  /** client / skillDirs 可选：从「检测到的客户端」一键登记时带上，自定义 Agent 留空 */
  createAgent: (name, client, skillDirs) =>
    call('createAgent', {
      name,
      client: client || null,
      skillDirs: Array.isArray(skillDirs) ? skillDirs : []
    }),
  deleteAgent: (id) => call('deleteAgent', { id }),
  /** 整表替换某个 Agent 的技能目录（只影响扫描范围与展示，不改 AgentID） */
  setAgentSkillDirs: (id, dirs) => call('setAgentSkillDirs', { id, dirs }),
  /** 本机装了哪些客户端（候选列表，不自动建 Agent、不扫技能） */
  clients: () => call('clients', {}),

  /**
   * 手机端通信：设置 + 会话 + 二维码 SVG + PushGo 通道实时状态。
   * 通道连接是进程级资源（与 mcpInfo 同类），不进领域能力表。
   */
  mobileInfo: () => call('mobileInfo', {}),
  /** 开关 / PushGo 网关；只写这两项，会话用 mobileRotate 换 */
  saveMobileSettings: (patch) => call('saveMobileSettings', { patch }),
  /** 换一套频道 + 密码：旧会话立即作废，手机端需重新扫码 */
  mobileRotate: () => call('mobileRotate', {}),

  /**
   * 本机技能清单（只有被添加的 Agent 的目录会被扫）：输入框 `/` 补全与卡片展示用。
   * 每条技能带 `agents`（归哪些 Agent），只回答「技能在哪」，不回答「会不会」。
   */
  skills: () => call('skills', {}),
  /** 重新扫描各客户端 skills 目录（装了新技能后不用重启） */
  rescanSkills: () => call('rescanSkills', {}),
  /** 单条技能：查不到也返回 found:false，界面据此显示失效态 */
  skill: (id) => call('skill', { id }),

  requirements: (id) => call('requirements', { id }),
  pendingRequirements: (id) => call('pendingRequirements', { id }),
  /** 事件日志查询：projectId / deletedOnly / category / type / actorKind / from / to / before / limit */
  events: (params) => call('events', params || {}),
  /** 全局搜索：项目 / 需求 / 运行日志 / 提交，每组默认返回 5 条 */
  globalSearch: (q, limit) => call('globalSearch', { q, limit }),
  requirementTimeline: (rid, before, limit) => call('requirementTimeline', { rid, before, limit }),
  notificationSettings: () => call('notificationSettings', {}),
  saveNotificationSettings: (patch) => call('saveNotificationSettings', { patch }),
  /** 代码同步设置：autoPullOnLaunch（启动时自动拉取的总开关） */
  gitSettings: () => call('gitSettings', {}),
  saveGitSettings: (patch) => call('saveGitSettings', { patch }),
  /**
   * 按当前规则立刻跑一轮自动拉取：设置弹窗里的「一键拉取」用。
   * force=true 表示手点下去就同步全部项目，不受「启动自动拉取」总开关拦截。
   */
  autoPullNow: (force) => call('autoPullNow', { trigger: 'manual', force: !!force }),
  autoPullStatus: () => call('autoPullStatus', {}),
  /**
   * 远程巡检：后台按间隔 fetch 一轮，把「落后上游多少」放进领域层缓存，
   * gitSummary 只读这份缓存（侧栏的灯不因联网而卡住）。
   * force=true 用于「立即检查」：手动点下去就说明此刻想联网，不受总开关拦截。
   */
  remoteCheckNow: () => call('remoteCheckNow', { trigger: 'manual', force: true }),
  remoteCheckStatus: () => call('remoteCheckStatus', {}),
  /** 启动自动拉取结果：主进程在后台拉完后推 pm:auto-pull */
  onAutoPull: (cb) => (window.pm && window.pm.onAutoPull ? window.pm.onAutoPull(cb) : () => {}),
  createRequirement: (id, data) => call('createRequirement', { id, data }),
  updateRequirement: (rid, patch) => call('updateRequirement', { rid, patch }),
  deleteRequirement: (rid) => call('deleteRequirement', { rid }),
  /**
   * 归档已完成的需求：记录写进数据目录的 archive/<项目id>/ 并从 db.json 移除，
   * 之后列表、计数都不再包含它。只有 done 可归档，其余状态返回 409 not_archivable。
   */
  archiveRequirement: (rid) => call('archiveRequirement', { rid }),
  /**
   * note 传了（含空串）就整体替换原备注，不传则保留——完成/拒绝时用来覆盖过时的 AI 备注。
   * feedback 用于打回（待审核 → 进行中）与撤销重开（→ 未开始），存独立字段并随 /claim 与详情返回给 agent。
   */
  setRequirementStatus: (rid, status, note, feedback) =>
    call('setRequirementStatus', { rid, status, note, feedback }),
  /**
   * 解锁项目：给进行中的需求签一张一次性通行证，`/next` 下一轮才会把这条任务还给认领人。
   * 不点解锁，任何 agent（含认领人自己）都派不进这个项目 —— 项目锁就是这么生效的。
   */
  unlockRequirement: (rid) => call('unlockRequirement', { rid }),
  /** 收回还没被取走的通行证（误点 / 想让 agent 先别动这个项目） */
  relockRequirement: (rid) => call('relockRequirement', { rid }),
  /**
   * 回答 agent 的提问：写进往返记录并清掉这一条待回答标记，原 agent 下一轮 /next 会读到。
   * `qid` 指定答哪一条；一条需求只挂一条时可以省略。
   */
  answerRequirement: (rid, text, qid) => call('answerRequirement', { rid, text, qid }),

  commands: (id) => call('commands', { id }),
  /** 新增命令时的推荐：识别项目类型（package.json / pom.xml…）并给出常见命令 */
  commandSuggestions: (id) => call('commandSuggestions', { id }),
  createCommand: (id, data) => call('createCommand', { id, data }),
  updateCommand: (cid, patch) => call('updateCommand', { cid, patch }),
  deleteCommand: (cid) => call('deleteCommand', { cid }),
  startCommand: (cid) => call('startCommand', { cid }),
  stopCommand: (cid) => call('stopCommand', { cid }),
  commandStatus: (cid) => call('commandStatus', { cid }),
  commandRuns: (cid) => call('commandRuns', { cid }),
  logs: (cid, runId) => call('logs', { cid, runId }),

  gitSummary: () => call('gitSummary', {}),
  /** 跨项目统计：since/until 为 YYYY-MM-DD（本地自然日） */
  gitActivity: (since, until) => call('gitActivity', { since, until }),
  gitCommits: (id, limit, skip) => call('gitCommits', { id, limit, skip }),
  gitChanges: (id) => call('gitChanges', { id }),
  /** fetch=true 先静默抓取；force=true 跳过巡检缓存强制联网（刷新按钮用） */
  gitRemote: (id, fetch, force) => call('gitRemote', { id, fetch: !!fetch, force: !!force }),
  gitPull: (id) => call('gitPull', { id }),
  gitPush: (id) => call('gitPush', { id }),
  /** 自动暂存项目目录内的全部改动后提交到本地（不推送） */
  gitCommit: (id, message) => call('gitCommit', { id, message }),
  /** 用系统浏览器打开远程仓库地址（只放行 http/https） */
  openUrl: (url) => call('openUrl', { url }),
  gitDiff: (id, path, untracked) => call('gitDiff', { id, path, untracked: !!untracked }),
  gitCommitFiles: (id, sha) => call('gitCommitFiles', { id, sha }),
  gitCommitDiff: (id, sha, path) => call('gitCommitDiff', { id, sha, path }),

  /**
   * 证据坐标的悬停预览：读项目内某个文件的一段内容。
   * 只读、只在项目根内，路径来自需求备注，越界由主进程拒绝。
   */
  fileSnippet: (id, path, line, end, full) => call('fileSnippet', { id, path, line, end, full: !!full }),

  /**
   * 项目文件清单：需求正文「@ 引用文件」的候选补全用。只读、只在项目根内，
   * 返回 { files:[{path}], truncated, source }；密钥 / 依赖目录不在其中。
   */
  projectFiles: (id) => call('projectFiles', { id }),
  /** 用系统默认程序打开项目内的一个文件（文件引用 chip 点击）；越界 / 密钥由主进程拒绝 */
  revealFile: (id, path) => call('revealFile', { id, path }),

  /**
   * 退出询问不是领域方法，走独立的事件通道而不是 call()：
   * 主进程在 before-quit 时推 pm:quit-ask，界面画完用 answerQuit 回 'detach' | 'stop' | 'cancel'。
   */
  onQuitAsk: (cb) => (window.pm && window.pm.onQuitAsk ? window.pm.onQuitAsk(cb) : () => {}),
  answerQuit: (mode) =>
    window.pm && window.pm.answerQuit ? window.pm.answerQuit(mode) : Promise.resolve(),
  /** 通知/审计点击后的统一跳转；浏览器预览下退化为空订阅 */
  onNavigate: (cb) => (window.pm && window.pm.onNavigate ? window.pm.onNavigate(cb) : () => {})
};

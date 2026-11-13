---
date: 2026-10-25
description: 项目登记后的打开与归档恢复：IDE / 终端只按项目 id 打开，已归档可恢复且仅归档可彻底删除
status: accepted
---

# 项目登记与打开 — 决策记录

> 状态：✅ 已验收（2026-10-25）

## 1. 目标与范围

- **项目打开**：两个「把项目交出去」的入口。IDE 按钮在中区状态栏，用当前 IDE 打开当前项目目录，可切换 IDE 与重新扫描；终端入口在侧栏项目行 `···` 菜单，以项目目录启动系统终端。
- **归档与恢复**：归档必须可逆。侧栏底部「已归档」折叠分组逐项恢复，归档弹窗在操作前说明去哪找回；后续追加仅对已归档项目开放的彻底删除。
- **项目图标**：有专属图标就显示（Android launcher、IntelliJ 插件图标、Electron exe 图标、JavaFX 资源图标），没有就回退首字母 + 身份色头像；项目名后用技术栈图标补充架构信息（Android、Obsidian、Spring、Maven、Gradle、Kotlin、Java、npm、Electron 等）。

**做**：IDE 自动发现与切换、终端按优先级尝试、路径只由主进程解析；归档分组、逐项恢复、归档指引、仅归档删除；Android / Obsidian / IntelliJ / Electron / JavaFX / Spring Boot 类型识别、真实图标提取与统一 `ProjectIcon`。
**不做**：任意路径执行、`pm_open_in_ide` / `pm_open_in_terminal` MCP 工具、终端类型选择、IDE 手动指定路径；批量恢复 / 删除、归档时间与原因展示、跨项目数据迁移。

## 2. 关键决策

### 2.1 项目打开

| 决策点 | 结论 | 理由 |
|---|---|---|
| 路径安全 | 只接受项目 id，主进程 `assertProjectDir` 校验后启动（与 `revealProject` 共用） | 渲染层能传路径等于开放任意进程执行 |
| MCP 暴露 | 不新增打开类 MCP 方法 | 避免 AI 侧能随意拉起本地进程 |
| 入口位置 | IDE 在状态栏（跨页、粒度是「当前项目」）；终端在项目行菜单（粒度是「这一个项目」） | 动作的作用对象不同，入口跟着对象走 |
| IDE 发现来源 | 开始菜单 `.lnk` + `readShortcutLink` 解析目标为主；常见安装路径、JetBrains 目录树（含 Toolbox）与 PATH 白名单 exe 兜底，按 id 跳过已找到的 | PATH 里几乎没有 IDE 命令、注册表覆盖也有限，快捷方式一次能捞出多个；兜底覆盖无快捷方式的安装形态，不做全盘遍历 |
| 识别口径 | exe 文件名 → `{id, name}` 白名单映射，未命中一律忽略；按 `id` 去重，先扫到的优先 | 开始菜单有大量非 IDE 快捷方式，只认已知产品才不会误报 |
| 启动器型 IDE | 目标不是白名单 exe 且名字像 IDE 时，去快捷方式 `cwd` 及其上 3 层找本体 | Qoder 快捷方式指向 Launcher，本体在 `cwd` 指向的安装目录 |
| 默认与切换 | `db.settings.lastIdeId` 全局记住上次使用；选中另一项只切换选中态并关闭菜单，不立即打开 | 每项目单独记需额外字段；拉起外部窗口不能被「切工具」顺带触发 |
| 扫描时机 | 进程内缓存，仅在「重新扫描」时重扫 | 每次点按钮扫盘会明显卡顿 |
| 图标来源 | 自行解析 exe 的 PE 资源（`RT_GROUP_ICON` + `RT_ICON`），转 PNG 后以 dataURL 下发，从 48px 起 | `app.getFileIcon()` 在无窗口进程下全部返回同一张占位图 |
| 终端优先级 | Windows Terminal → PowerShell → cmd；macOS 用 Terminal；Linux 尝试常见模拟器；只用 `spawn` 参数数组（`shell: false`），启动成功后 `unref()`，失败换下一个 | 用系统默认终端无需配置；`wt.exe` 缺失时必须可靠回退 |

### 2.2 归档与恢复

| 决策点 | 结论 | 理由 |
|---|---|---|
| 数据拆分 | `loadProjects` 一次取回后拆成未归档 / 已归档两份，`projects` 只含未归档 | 总览、侧栏、`pid` 兜底等既有消费者语义不变 |
| 分组显隐 | 有归档才显示、默认收起、展开态仅本会话；侧栏收成窄栏时整组隐藏 | 无归档不占位，与其它分组一致 |
| 恢复行为 | `updateProject(id, { archived:false })`；不切当前项目、不切页，只弹 Toast | 恢复是找回动作，不该打断当前工作 |
| 归档入口 | 项目设置弹窗底部，或侧栏 / 总览项目行的「更多操作」菜单；两处共用 `archiveProject`，菜单项就地两步确认（5 秒撤销） | 归档不必先打开设置弹窗，又不降低防误点的门槛 |
| 归档指引 | 项目设置编辑态底部说明「归档后可在侧栏『已归档』恢复；需求、命令与日志会保留」；菜单项 tooltip 同样说明 | 归档前知道退路 |
| 彻底删除 | 仅归档项目；两步确认；只删登记、需求、命令与日志文件，不碰代码目录 | 与「删除项目」区分，绝不误删源码 |
| 删除前置 | 有命令运行中时拒绝删除（409） | 退出会把内存旧库写回 |

### 2.3 项目图标

| 决策点 | 结论 | 理由 |
|---|---|---|
| 图标优先级 | 有专属图标就显示；没有就回退首字母 + 身份色头像，不再用类型图标顶替主图标 | 三个同类项目（如三个 Obsidian 插件）用同一个标志时，侧栏收起后完全分不出来；首字母保留项目区分度 |
| 识别口径 | 只看项目根目录和一级模块：`AndroidManifest.xml` → Android；`manifest.json` 的 `minAppVersion` → Obsidian 插件 / 主题；`.obsidian` 目录 → Obsidian 库；IntelliJ Platform Gradle 插件或 `META-INF/plugin.xml` → IntelliJ 插件；`package.json` 依赖 electron → Electron；Maven / Gradle 使用 JavaFX → JavaFX；使用 Spring Boot → Spring Boot。技术栈另从 `pom.xml` / `build.gradle(.kts)` / `src/main/java|kotlin` / `package.json` 识别 Maven、Gradle、Kotlin、Java、npm | 与启动命令推荐共用「只认根目录特征」的原则，零配置、不误判普通 Node 项目 |
| 识别成本 | `projectView` 返回 `kind` + `stacks`；按路径 + 构建文件 / 源码目录 mtime/size 缓存，列表轮询只做少量 `stat` | 侧栏 5 秒轮询，不能每次都读构建文件 |
| 技术栈图标 | 项目名后紧跟一个 12px 技术栈图标，优先级：平台 / 框架 > Kotlin > 构建工具（Gradle / Maven）> Java > npm；完整技术栈列表写在图标 tooltip 与侧栏行提示里 | 图标在名称的扫读路径上，不遮挡首字母；收起侧栏后随名称隐藏，避免只剩昵称时仍挤一堆类型标志 |
| 收起态 | 只显示主图标（专属图标或首字母），技术栈图标隐藏；悬停行可看完整技术栈 | 收起侧的识别目标是「区分项目」，不承担架构说明；架构信息回到展开态与 tooltip |
| 真实图标 | Android 按 `android:icon` 找 launcher 资源；IntelliJ 取 `META-INF/pluginIcon.svg`；Electron 取 electron-builder 配置 / 常见图标目录 / 已打包 exe；JavaFX 扫 `resources` 下的 `icon.*`；Spring Boot 取 `static/favicon.*`；`projectIcon` 按需取，不进列表轮询 | 图标 dataURL 体积大，不能每 5 秒随项目列表下发 |
| 图标主题 | 纯黑矢量图标在深色界面反色，纯白图标在浅色界面反色；彩色图标保持原样 | Android 矢量图标常是单色，直接放深色底上会看不见 |
| 生效范围 | 侧栏（含已归档）、项目切换面板、总览共用 `ProjectIcon`；技术栈图标跟在项目名后；中区项目信息条只保留主图标 | 同一项目在各处用同一身份；技术栈不压在头像上 |
| 兜底 | 没有专属图标 → 首字母；技术栈图标缺失或类型未知时只显示项目名；识别失败或目录不存在时静默回退，不报错 | 主图标负责区分项目，技术栈图标负责说明架构，两者职责分开 |
| 第二批 | Tauri、Kotlin / JVM、React / Vue、POI / Excel、多模块仓库扫描 | 规则与目标项目见 §2.5 |

### 2.4 项目悬停卡片

- 鼠标在项目行停留 240ms 后出现，替代原生 `title`：显示主图标 / 首字母、完整技术栈、路径、未完成 / 候选 / 运行计数，以及待审核、待回答、未提交、远程落后、AI 巡检停用等提醒。
- `fixed` 定位，优先在行右侧弹出，空间不够时翻到左侧；列表滚动、窗口缩放、打开弹层、开始拖拽或点击项目时收起。
- 卡片能接住鼠标（早期设了 `pointer-events:none`：鼠标一从项目行划向卡片，行就 `mouseleave` 把卡收掉，实测很反直觉）。现在行与卡片离开都留 160ms 过路时间，卡片 `enter` 撤掉收起、`leave` 再安排收起；鼠标停在卡上看多久都不收，可以选文字。项目行只保留 `aria-label` 摘要，不再触发原生 title。
- 需求详情里的「引用项目」（正文 chip 与下方清单）复用同一张卡：由 `components/HoverCardLayer.jsx` 统一持有开关与定位，chip 只把自己解析到的 `projectId` 交进去，项目对象仍按 id 从侧栏那份 5s 轮询的项目视图里现查，两处口径不会分叉。chip 是行内小元素，定位改成优先落在下方、下方不够且上方更宽裕才翻上去；卡片 portal 到 `body`，因为右面板收起态带 `transform` 会让 `fixed` 变成相对面板定位。未提交 / 远程落后两项沿用 `gitSummary`（全项目口径，不只当前项目）。
- chip 一旦能出卡就不再挂原生 `title`：两套提示同时弹很影响观感。路径与计数本来就在卡上，归档另有行内角标，重名靠卡上的路径认；只有解析不到（`projectId` 为空）这类卡给不出来的原因才保留原生提示。
- 同一层后来也接管需求引用（信息卡：编号 / 标题 / 状态 / 正文摘要）与文件引用（内容窗：悬停时按需读文件 + 行号 + 语法高亮），见 `doc/requirements-and-agent.md` §2.11。四类卡统一可接鼠标，关闭改 160ms 延时 + 卡片 enter/leave 接管；文件卡内部代码区滚动不收卡，卡宽高按锚点剩余空间算。
- 卡片能点之后还需把 `App.jsx` 的「点抽屉外收起」判据一并扩到这些 portal 浮层（`PANEL_INSIDE`）：否则点击卡片会被当成点抽屉外，右面板连同卡片一起收掉。证据浮层 `.ev-pop` 同样在判据里；点真正的外部仍照常收起抽屉。

### 2.5 第二批识别规则（待实现）

| 类型 | 判定特征 | 图标计划 |
|---|---|---|
| Tauri | `src-tauri/tauri.conf.json` | `src-tauri/icons/icon.png`，兜底 Tauri 标志 |
| React / Vue 前端 | `package.json` 依赖 React 或 Vue | 对应框架标志；多框架仓库用前端库通用图标 |
| POI / Excel | `pom.xml` 依赖 `poi-ooxml` | Excel 风格图标 |
| 多模块 / 多端仓库 | 根目录无构建标记，构建文件在一级模块 | 扫描一级模块；命中多个类型时显示「多端 / 多模块」图标或固定取桌面客户端图标 |

Kotlin、Java、Maven、Gradle、npm 已作为项目名后的技术栈图标支持，不再属于第二批；剩下的主要是需要专属主图标或更深层扫描的项目类型。多模块仓库需先确定展示策略：同时包含 Tauri、Electron 和 Spring Boot 的仓库显示单个客户端图标会误导，统一用「多端」图标更稳。

## 3. 交付物

| 文件（相对路径） | 职责 |
|---|---|
| `electron/services/{ide,icon,terminal}.js` | `scan` / `open` / `reset` 多来源发现与启动；`get` / `extract` 解析 PE 图标；`open(dir)` / `candidates` 按平台尝试并回退终端 |
| `electron/services/domain/{system,validators,projects}.js` | `ides` / `openInIde` / `openInTerminal` 与 `assertProjectDir`；`deleteProject` 仅归档项目、拒绝运行中、清理需求 / 命令 / 日志 |
| `electron/services/project-detect.js`、`electron/services/domain/views.js` | `detectProfile(path)` 按根目录特征识别 Android / Obsidian / IntelliJ / Electron / JavaFX / Spring Boot 与技术栈并缓存；`projectView` 下发 `kind` + `stacks` |
| `electron/services/android-icon.js`、`electron/services/project-icon.js`、`electron/services/domain/projects.js` | Android launcher 资源解析；IntelliJ 插件图标、Electron 配置 / exe 图标、JavaFX 资源图标、Spring favicon；`projectIcon` 按需下发 |
| `web/src/api.js`、`web/src/ui.jsx` | `projectIcon(id)` 通道；真实图标按项目缓存、懒加载，失败只请求一次 |
| `web/src/ui.jsx`、`web/src/icons.jsx`、`web/src/constants.js` | `ProjectIcon` 选专属图标 / 首字母；`ProjectStackIcon` 在项目名后显示技术栈；Android / Obsidian / Spring / Electron / IntelliJ / JavaFX / Kotlin / Java / Gradle / Maven / npm 图标；`PROJECT_STACK_LABELS` 文案 |
| `web/src/assets/icons/{ui,brand,panel}/*.svg` | 图标源文件：单色界面图标 / 品牌与技术栈图标 / 面板开合图标；`icons.jsx` 通过 Vite raw 导入统一渲染，代码里不再平铺 SVG |
| `web/src/{Sidebar,OverviewPage}.jsx`、`web/src/components/ProjectPalette.jsx` | 项目行、归档分组、总览与切换面板改用 `ProjectIcon` + `ProjectStackIcon`；侧栏行 tooltip 补充技术栈列表 |
| `web/src/components/ProjectHoverCard.jsx`、`web/src/styles/sidebar.css` | 项目行悬停信息卡：身份 / 技术栈 / 路径 / 计数 / 提醒分层展示；定位、延时与收起逻辑 |
| `web/src/components/HoverCardLayer.jsx` + `{RequirementHoverCard,FileHoverCard}.jsx` | 悬停信息卡的唯一实例：延时开 / 收起、锚点跑位与离开文档时收起、按锚点周围空间定坐标并 portal 到 `body`；需求详情的四类引用 chip（项目 / 需求 / 文件 / 技能）都走这里，文件卡额外按需读内容并支持卡内滚动 |
| `web/src/ides.js`、`web/src/ui.jsx` | 模块级 Promise 记忆化共享扫描；`IdeButton`（主键 + 切换菜单 + 重新扫描） |
| `web/src/App.jsx` / `web/src/forms.jsx` | `PageBar` 工具槽渲染 `IdeButton`；`openTerminal` 成功静默、失败走警告；归档拆分、恢复与删除；编辑态的恢复指引 |
| `web/src/Sidebar.jsx` | 终端菜单项；`.parch` 折叠分组、恢复与删除按钮（进行中 id 防重复、`armedId` 两步确认） |
| `web/src/components/ProjectMenu.jsx`、`web/src/styles/sidebar.css` | 侧栏 / 总览共用的项目菜单增加「归档项目」：分隔线隔开、就地两步确认、确认态标红 |
| `web/src/styles/{tokens,sidebar,context,modal}.css` | `--teal`、`.parch*`、`.arch-note` |

## 4. 关键修正与教训

- **只靠 PATH 与注册表会漏掉一大半 IDE，且快捷方式目标不一定是本体** → 以开始菜单为主来源，启动器型产品沿快捷方式 `cwd` 向上找安装目录。
- **不能用 `shell: true` 拼路径** → 安装路径常带空格与中文，必须 `spawn(exe, [path])` 传数组；单实例 IDE spawn 后立刻退出，不能按退出码判成败。
- **`app.getFileIcon()` 与手工拼 ICO 都不可用** → 图标改为自行读 PE 资源并转标准 PNG，且从 48px 起（小图标在高分屏上糊、大图标体积暴涨）。
- **状态栏整体是窗口拖拽区** → 入口外层容器必须显式 `-webkit-app-region:no-drag`，只给 `button` 加不够，否则会拖动窗口、菜单点不动。
- **新增 domain 方法必须重启主进程** → 只刷新页面会得到 `unknown_method`。
- **能归档、不能找回；恢复连点会重复请求，归档分组还会被筛选一并隐藏** → 「隐藏 / 移除」必须与找回入口同时交付，用以进行中 id 禁用该行，归档数据走独立数据源。
- **标签只承担筛选，长期无人使用** → 2026-11-11 移除字段、编辑入口、展示、搜索命中与筛选链路；旧数据里的 `tags` 保留不读，不做迁移，避免为删功能改用户数据。

## 5. 已知边界

- `devenv.exe` 传目录是尽力而为；只识别白名单内 IDE，未收录产品需加白名单，不支持手动指定路径；图标仅支持 Windows PE，8/4/1bpp 调色板不处理。
- macOS / Linux 的 IDE 与终端分支、PowerShell / cmd 回退未在真机复测；IDE 侧与状态栏按钮交互待运行期验收。
- 彻底删除不可撤销且仅归档项目可用，需求与运行日志随登记一并删除；恢复不拦截同名，无归档时间与批量操作。
- 标签功能已整体移除；旧数据中的 `tags` 字段保留但不再读取，也不提供迁移脚本。
- 类型识别目前覆盖 Android、Obsidian、IntelliJ 插件、Electron、JavaFX、Spring Boot；技术栈额外覆盖 Maven、Gradle、Kotlin、Java、npm。新增类型需在 `project-detect.detectProfile`、`project-icon.js`、前端 `ProjectIcon` 各加一处映射。不支持手动指定项目图标或手动指定技术栈。
- Android 图标只认根目录 / 一级模块，模块目录改名后需重启；资源支持 PNG / WebP / JPG / VectorDrawable，自适应图标只取 foreground、不合成背景；图标文件变化在重启后生效。
- Electron / IntelliJ / JavaFX 找不到专属图标、Spring Boot 没有 favicon 时，主图标回退首字母；项目名后仍显示对应技术栈图标。
- 名称后只显示一个主类型，完整列表在 tooltip；侧栏收起后技术栈图标随名称隐藏。根目录没有构建标记的多模块仓库（标记在一级模块）stacks 为空，留到第二批处理。
- 第二批（Tauri、React / Vue、POI、多模块扫描）尚未实现，规划见 §2.5。
- 列表只通过 `kind` 触发一次 `projectIcon` 请求；同一项目切换路径会重新取图，取图失败的请求不自动重试。

## 6. 后续候选

- 每个项目单独记住 IDE；手动添加 / 覆盖扫不到的 IDE 路径；记住或自选终端；批量恢复 / 删除与归档时间展示；更多品牌类型（VS Code 扩展、Chrome 扩展等）与手动覆盖图标。

# 截图流程与选择器

## 准备

1. `npm run build`：把 `web/` 构建到 `electron/renderer/`。
2. 复制 `electron/renderer/` 到临时目录。
3. 运行 `gen-mock.cjs --out <site>/mock.js` 生成虚构数据桥。
4. 在构建后的 `index.html` 里、模块脚本之前注入：
   - `localStorage['pm.ui.theme']` 与 `document.documentElement.dataset.theme`（light / dark）
   - `localStorage['pm.ui.skin'] = 'vivid'`
   - `pm.ui.layout = { leftW: 246, rightW: 470, leftCollapsed: false, rightCollapsed: false }`
   - `<script src="./mock.js">`
5. 起本地 HTTP 服务，Chromium 打开 `http://127.0.0.1:<port>/`。

## 通用选择器

| 元素 | 选择器 |
|---|---|
| 左栏项目 | `.pitem`（按 `textContent` 匹配项目名；行内更多操作是 `.pmenu`） |
| 全局导航 | `.nav-item` |
| 项目视图页签 | `.vtab`（需求中心 / 启动台 / 修改记录） |
| 需求行 | `.req`（标题在 `.req-title`） |
| 视图切换 | `.viewseg [aria-label="看板视图"]` / `.viewseg [aria-label="列表视图"]` |
| 看板列与卡片 | `.board .bcol`、`.board .bcard`（标题在 `.bcard-title`） |
| 需求详情根 | `.rd-title` |
| 关联提交 | `.rd-commits` / `.rd-commit` |
| 正文引用 chip | `.rd-body .ref-chip`（项目 / 需求 / 文件 / 目录；技能是同类的 `.ref-chip.skill`） |
| 引用清单行 | `.rd-ref`（项目 / 需求 / 文件；`.rd-ref.rd-file` 是文件与目录行，行本身也能悬停） |
| 悬停卡 | `.fhover`（文件 / 目录）、`.rqhover`（需求）、`.phover`（项目）、`.skhover`（技能） |
| 目录卡条目 | `.fhover-dir` / `.fhover-dir-row` |
| 提问 / 验收卡片 | `.rd-ask`（提问）、`.rd-ask.rd-review`（待审核） |
| 右面板滚动容器 | `.rpanel-body` |
| 总览行 / 统计图 | `.ov-row` / `.stat-chart` |
| 启动台日志 | `.rlogs .log` |
| 修改记录文件 / diff | `.gtree .gfile` / `.diff-body` |
| 图片与 SVG 预览 | `.diff-image` / `.dimg` |
| 项目「更多操作」菜单 | `.pmenu-pop`；父项 `.pmenu-parent`；二级菜单 `.pmenu-flyout` |
| 设置与数据浮层 | `.side-data-toggle` → `.datapop`；二级菜单 `.theme-sub`（数据）/ `.appearance-sub`（外观） |

## README 场景步骤

1. **overview**：等 `.ov-row` 数量 > 3，确认 `dataset.theme` 已是目标主题，直接截。
2. **statistics**：点 `.nav-item`「统计」→ 等 `.stat-chart`。
3. **requirements-board**：点 `.pitem`「星港数据平台」→ 等 `.req` → 点 `.viewseg [aria-label="看板视图"]` → 等 `.board .bcard` 数量 > 3（右面板此前已打开时先去统计页让它收起，否则中区被挤窄）→ 截完点「列表视图」切回，后续场景仍按列表点击。
4. **requirements**：点 `.pitem`「星港数据平台」→ 等 `.req` → 点标题含「工作台首页支持自定义卡片排序」的需求 → 等 `.rd-title`。
5. **requirement-refs**：仍在「星港数据平台」→ 点标题含「导出任务列表复用消息分组交互」的需求 → 等 `.rd-title` → `rpanel-body.scrollTop = 0` → 用 CDP 发 `Input.dispatchMouseEvent`（`mouseMoved` 先到 (0,0) 再到 chip 中心）悬停「引用文件」行的 `.rd-ref.rd-file`（JobList.tsx）→ 等 `.fhover` 出现后截。悬停正文里的 `.rd-body .ref-chip.file-chip` 也能出同样的卡，但那张卡会盖住下方引用清单，README 用图取前者。
6. **launch**：点 `.vtab`「启动台」→ 等 `.rlogs .log`（默认自动选运行中的命令）。
7. **changes**：点 `.vtab`「修改记录」→ 等 `.gtree .gfile` → 点 `ExportPanel.tsx` → 等 `.diff-body`。
8. **agent-resume**：点 `.vtab`「需求中心」→ 点 `.pitem`「极光移动端」→ 点「消息中心支持按项目分组并置顶未读」（doing + claim）→ 等 `.rd-title` → `rpanel-body.scrollTop = scrollHeight`，截到底部「解锁项目」。
9. **agent-question**：点「灰度开关默认值改为跟随系统」（doing + question）→ 等 `.rd-ask` → **先把 `rpanel-body.scrollTop` 复位为 0**；默认不滚动以保留标题/正文上下文，只有卡片底部超出面板时才按超出量滚动最小距离，等 1100ms 后截。

## 笔记场景步骤

从需求中心进入（脚本会先点「星港数据平台」）：

1. **note-commit-links**：点「工作台首页支持自定义卡片排序」（review + 两条关联提交）→ 等 `.rd-title` 与 `.rd-commits` → `rpanel-body.scrollTop = 300`（让出标题与正文，保留备注上下文）→ 截「验收卡 + 关联提交 + 时间线」。滚动值别调太大，否则验收卡顶到屏幕外。
2. **note-folder-ref**：点「导出任务列表复用消息分组交互」→ `scrollTop = 0` → 悬停**第一个** `.rd-ref.rd-file`（目录 `web/src/views/export`，按 DOM 顺序在 JobList.tsx 前面）→ 等 `.fhover` → 截。
3. **note-stack-hover**：悬停 `.pitem`「空谷文件同步」→ 等 `.phover`（240ms 防抖）→ 截四种技术栈与三个计数。截完 `moveAway()`。
4. **note-copy-path**：点该行 `.pmenu` → 等 `.pmenu-pop` → **点击** `.pmenu-parent`（复制路径）而不是悬停 → 等 `.pmenu-flyout` → 截；`Escape` 收起。
5. **note-sidebar-data**：点 `.side-data-toggle` → 等 `.datapop` → 悬停 `.datapop-item`「数据」→ 等 `.theme-sub` → 截；再点一次开关收起。
6. **note-sidebar-appearance**：重开浮层 → 悬停「外观」→ 等 `.appearance-sub` → 截；收起。
7. **note-svg-preview**：点 `.vtab`「修改记录」→ 等 `.gtree .gfile` → 点 `logo-mark.svg` → 等 `.diff-image` → 等 600ms 让两张图解码完 → 截。

## 数据约束

- `agent-resume` 用的需求必须 `status: 'doing'` 且有 `claim`，否则底部没有「解锁项目」。
- `agent-question` 用的需求必须 `status: 'doing'` 且有 `question`（含 `text`、`at`、可选 `options` / `default` / `expiresAt`）。
- `requirement-refs` 用的 #17 正文必须同时含 `@{项目名}`、`@{#序号}`、`@{file:文件}`、`@{file:目录}`、`{UseSkill:技能名}`，生成器里同步补好 `refs` / `reqRefs` / `fileRefs` / `skills`（形状与 `electron/services/domain/views.js` 的 `reqView` 一致）；文件悬停内容来自 mock 的 `fileSnippet`（路径含 `JobList` 返回演示代码），目录悬停来自 `projectDir`。
- 笔记场景额外依赖：#15 的 `commits`（两条，带 `shortSha` / `subject` / `at`）；#17 的 `fileRefs` 含目录项；「空谷文件同步」的 `stacks` 为 `go / rust / python / docker`；星港的 `changes` 含 `assets/logo-mark.svg`，mock 的 `gitDiff` 对 `.svg` 返回 `image.old / image.new` 与字符串 diff。
- 左栏状态灯：需求灯每行最多一盏（待审核 > 待回答 > 进行中 > 未开始），改动/同步灯与运行灯另算。想让某一行安静下来，就清空该项目的 `changes`（`cleanChanges()`）、去掉 `behindMap` 条目、停掉运行中的命令。
- 认领人显示名来自 `AGENT_NAME` 映射（`cursor-agent → Cursor`、`claude-code → Claude Code`、`workbuddy-agent → Work Buddy`、`copilot-agent → Copilot Agent`、`scout-agent → Qoder`）；新需求直接写 `agentName` 也行。
- 启动台截图的日志来自 mock 的 `logs` 对象，键是命令 id（默认 `c_aurora_web`）。
- 修改记录截图需要星港 `changes` 里有文件条目，并且 `gitDiff` 返回 diff（底座已内置）。
- 时间线由生成器按需求生成；底座的 `timelineOf` 原本固定输出 #12 的事件，切换到别的需求会串台，生成器已改成按当前需求拼装。

## 排障

- **截图里右面板只画了一半**：多半是 sticky 的 `.rd-ask` 在滚动中截的；复位滚动 + 等待后重截。必要时对全页做一次 `void document.body.offsetHeight` 强制重排，或先用 `fromSurface: true` 截一张空转图再截正式图。
- **页面空白 / 脚本报错**：检查控制台是否有 mock 语法错误（`node --check <site>/mock.js`），以及 `index.html` 注入顺序是否在模块脚本之前。界面出现「界面出错了」多半是 mock 字段形状不对（例如 `gitDiff.diff` 给了数组而不是字符串）。
- **目录悬停显示读取失败**：mock 少了 `projectDir`。
- **下一张图带着上一张的悬停卡**：`moveAway()` 没调用，或菜单用悬停而不是点击打开，鼠标路过项目行又触发了项目卡。
- **Chromium 起不来**：确认 `%LOCALAPPDATA%/ms-playwright` 里有 chromium，或设置 `CHROMIUM_PATH`；脚本也支持系统 Chrome / Edge。
- **端口冲突**：HTTP 用随机端口，DevTools 用 `--remote-debugging-port=0`，正常不会冲突。

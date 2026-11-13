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
| 左栏项目 | `.pitem`（按 `textContent` 匹配项目名） |
| 全局导航 | `.nav-item` |
| 项目视图页签 | `.vtab`（需求中心 / 启动台 / 修改记录） |
| 需求行 | `.req`（标题在 `.req-title`） |
| 需求详情根 | `.rd-title` |
| 提问 / 验收卡片 | `.rd-ask`（提问）、`.rd-ask.rd-review`（待审核） |
| 右面板滚动容器 | `.rpanel-body` |
| 总览行 | `.ov-row` |
| 统计图 | `.stat-chart` |
| 启动台日志 | `.rlogs .log` |
| 修改记录文件 | `.gtree .gfile` |
| diff | `.diff-body` |

## 场景步骤

1. **overview**：等 `.ov-row` 数量 > 3，确认 `dataset.theme` 已是目标主题，直接截。
2. **statistics**：点 `.nav-item`「统计」→ 等 `.stat-chart`。
3. **requirements**：点 `.pitem`「星港数据平台」→ 等 `.req` → 点标题含「工作台首页支持自定义卡片排序」的需求 → 等 `.rd-title`。
4. **launch**：点 `.vtab`「启动台」→ 等 `.rlogs .log`（默认自动选运行中的命令）。
5. **changes**：点 `.vtab`「修改记录」→ 等 `.gtree .gfile` → 点 `ExportPanel.tsx` → 等 `.diff-body`。
6. **agent-resume**：点 `.vtab`「需求中心」→ 点 `.pitem`「极光移动端」→ 点「消息中心支持按项目分组并置顶未读」（doing + claim）→ 等 `.rd-title` → `rpanel-body.scrollTop = scrollHeight`，截到底部「解锁项目」。
7. **agent-question**：点「灰度开关默认值改为跟随系统」（doing + question）→ 等 `.rd-ask` → **先把 `rpanel-body.scrollTop` 复位为 0**；默认不滚动以保留标题/正文上下文，只有卡片底部超出面板时才按超出量滚动最小距离，等 1100ms 后截。不要直接 `scrollIntoView('start')`，否则会把顶部信息顶出可视区。

## 数据约束

- `agent-resume` 用的需求必须 `status: 'doing'` 且有 `claim`，否则底部没有「解锁项目」。
- `agent-question` 用的需求必须 `status: 'doing'` 且有 `question`（含 `text`、`at`、可选 `options` / `default` / `expiresAt`），否则同一条也能正常显示。
- 启动台截图的日志来自 mock 的 `logs` 对象，键是命令 id（默认 `c_aurora_web`）。
- 修改记录截图需要 `changes.p_aurora` 里有文件条目，并且 `gitDiff` 返回 diff（底座已内置）。
- 时间线由生成器按需求生成；底座的 `timelineOf` 原本固定输出 #12 的事件，切换到别的需求会串台，生成器已改成按当前需求拼装。

## 排障

- **截图里右面板只画了一半**：多半是 sticky 的 `.rd-ask` 在滚动中截的；复位滚动 + 等待后重截。必要时对全页做一次 `void document.body.offsetHeight` 强制重排，或先用 `fromSurface: true` 截一张空转图再截正式图。
- **页面空白 / 脚本报错**：检查控制台是否有 mock 语法错误（`node --check <site>/mock.js`），以及 `index.html` 注入顺序是否在模块脚本之前。
- **Chromium 起不来**：确认 `%LOCALAPPDATA%/ms-playwright` 里有 chromium，或设置 `CHROMIUM_PATH`；脚本也支持系统 Chrome / Edge。
- **端口冲突**：HTTP 用随机端口，DevTools 用 `--remote-debugging-port=0`，正常不会冲突。

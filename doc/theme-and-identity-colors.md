---
date: 2026-11-04
description: 暗色模式的全部决策（三态切换与偏好存储、token 分层实现、配色与对比度、切换一致性、无障碍）与项目身份色 24 色板按 id 稳定分配
status: accepted
---

# 主题与项目身份色 — 决策记录

> 状态：✅ 已验收（2026-11-04）
> 浅色另有三套可选皮肤（清透 / 暖纸 / 活力，默认活力），只作用浅色、暗色不受影响，见 [light-skins.md](./light-skins.md)。

## 1. 目标与范围

- 在既有浅色界面之上引入暗色主题，覆盖 Web 全部页面、覆盖层与 Electron 壳层；支持「跟随系统 / 浅色 / 深色」三态切换并持久化偏好。
- 浅色渲染结果必须与改造前完全一致（像素基线不变）；暗色通过重定义一整套 token 获得，而不是给每条规则写第二遍。
- 项目身份色由 5 色扩为 24 色板，按项目 id 稳定分配：拖拽排序不换色，且跨主题不换色。

范围内：侧栏（品牌 / 导航 / 项目行 / 状态灯 / 搜索 / 数据下拉）、标题条、三栏布局、右面板、滚动条；总览 / 统计 / 需求中心 / 启动台 / 修改记录及其浮层；全部 modal、命令面板、启动命令面板、Toast、Tooltip、空态、警示条；Electron 主窗口底色、Windows 标题栏覆盖色、启动窗。

范围外（有意不纳入）：

- 项目身份色板不随主题翻色：24 色已是「中深 12 + 同色相浅 12」双明度分布，`avatarInk()` 按底色亮度自适应字色，色块不依赖页底色；强行换色会破坏「项目身份色跨主题稳定」的语义。
- OS 原生绘制物（系统对话框、托盘图标与菜单、窗口控制按钮悬停效果）只覆盖常规态配色。
- ANSI 日志与状态灯只做同色相提亮，颜色与语义的对应关系一个字都不改。

## 2. 关键决策

| 决策点 | 结论 |
|---|---|
| 主题模式 | 三态 `system / light / dark`，单一真源 `lib/theme.js` |
| 偏好存储 | `localStorage['pm.ui.theme']` 裸字符串，不走 `db.settings` |
| 实现分层 | 浅色值留在 `tokens.css`，暗色只在 `theme-dark.css` 重定义 |
| 切换入口 | 侧栏「设置与数据」浮层「界面」分组内一行「外观」+ 向右二级菜单；子菜单里三种皮肤与暗色并排，跟随系统单列下方 |
| 配色原则 | 只调明度不换色相；对比度按用途分级 |
| 切换行为 | 瞬时切换、只换色不动布局 |
| 身份色 | 24 色按 id 排序后的序号取色，跨主题稳定 |
| 文字层级 | 正文与列表标题用 `400` + `--ink-body`；字段标签 / 小节标题用 `500`；只有按钮、状态徽标保留 `600`。弹窗内非交互文字统一按这个口径收敛，不再逐组件写 `600` + 主文本黑 |

### 2.1 主题三态与存储

- `pref ∈ {system, light, dark}` 持久化；`applied = pref === 'system' ? matchMedia('(prefers-color-scheme: dark)').matches : pref`；结果写到 `documentElement.dataset.theme`（`light` / `dark`）。
- 写裸字符串而非 JSON：三态无结构，无需序列化。读取失败、值非法、隐私模式写入抛错均静默回落 `system`，不影响本次使用；只有主窗口用该主题，不需要 `storage` 事件跨窗口广播。
- 首帧无闪靠 `web/index.html` 在 `#root` 之前的**内联 IIFE**：读 `localStorage` + `matchMedia` 直接定色。这一步不可省，否则暗色下每次启动白闪一帧；内联脚本无法 import，故键名与三态规则在 `lib/theme.js` 与内联脚本各写一次。
- 跟随系统的实时性：`useTheme` 挂载时注册 `matchMedia` 的 `change` 监听，仅在 `pref === 'system'` 时改变 `applied`，卸载移除；监听只在 React 侧注册，避免与内联脚本重复。
- 启动窗取舍：`splash.html` 是独立文档，渲染端未运行、读不到 `localStorage`，只能按 `nativeTheme.shouldUseDarkColors` 定色。因此「系统暗 + 用户手选浅色」会有约 300ms 的配色不一致；不为这 300ms 引入偏好落盘到主进程的双写机制，默认项本就是跟随系统，两者天然一致。

### 2.2 双主题实现分层

- 链路：`index.html` 内联定色 → `lib/theme.js` 纯函数 → `useTheme.js`（state / 监听 / 瞬时切换 / 通知主进程）→ `documentElement.dataset.theme` → `tokens.css` / `theme-dark.css` → 各域样式 → Electron `pm:appearance`。组件层不知道主题存在，只消费 token。
- `tokens.css` 的 `:root` 只放浅色值，新增中性 token 的值**严格等于**被替换的字面量；`theme-dark.css` 是一次性重定义全部 token 的唯一处。新增组件只要用 token 就自动获得双主题。
- 中性叠色统一走 RGB 三元组：`rgba(60,60,67,.06)` → `rgb(var(--ink-rgb) / .06)`，暗色 `--ink-rgb: 235 235 245`。alpha 一字不改，明暗感知落差与原值一致，约 32 处一次解决。
- 饱和色相的非中性底/边不参与翻色：`rgba(52,199,89,.10)` 之类半透明彩色在深底仍成立，保留字面值，不制造 `--green-rgb` 等新通道。
- `color-scheme` 必须跟着主题走（`[data-theme="dark"]{color-scheme:dark}`），否则原生 `<select>` 下拉、日期选择、自动填充底色、系统滚动条仍是浅色，是最容易被一眼看出的漏网处。
- `theme-dark.css` 在 `index.css` 中位于 `palette.css` 之后、`responsive.css` 之前：暗色覆盖必须早于响应式规则，后者要能压过基础规则。
- 层级语义不变：`--sh-card < --sh-hover < --sh-sheet` 在暗色重写时仍单调递增；暗底上纯黑阴影几乎不可见，故阴影以黑色加深 + 1px 亮色内环实现。
- 滚动条的暗色补丁写在 `theme-dark.css`，不写进 `scroll.css`，避免同文件混双主题。

### 2.3 配色与对比度

| 用途 | token | 暗色最低要求 |
|---|---|---|
| 正文 / 标题 | `--label` | ≥ 7:1（AAA） |
| 次要文字、路径、计数 | `--label-2` / `--label-3` | ≥ 4.5:1 |
| 提示、占位、禁用、行号 | `--label-4` | ≥ 4.5:1 |
| 语义文字（成功/错误/警告/链接） | `--green-text` / `--red-text` / `--orange-text` / `--teal-text` / `--blue` | ≥ 4.5:1 |
| 图标描边、焦点环、输入框边框 | `--ink-icon` / `--blue` / `--edge` | ≥ 3:1 |

- 强调色换 iOS 暗色版（`#0A84FF` / `#30D158` / `#FF9F0A` / `#FF453A` / `#7D7AFF` / `#40C8E0`），色相 ±5° 内，两个主题下「哪个是成功、哪个是危险」的认知一致。`--indigo` 不能用浅色值：`#5E5CE6` 在 `#1C1C1E` 上只有 3.3:1，必须提亮；`--fill-*` 同一 alpha 在深底感知更弱，按约 +60% 提。
- 浅色侧的已知债本次不动：`--label-4` 在浅色约 3.2:1，对 12px 以下文字不达 AA。因为「浅色像素级不变」是硬约束，只把暗色新建组合补到 5.2:1；不允许暗色改造「顺带」修浅色。
- `--edge` 暗色取 2.5:1 是有意取舍，不是遗漏：推到 3:1 需要 `rgba(255,255,255,.45)` 以上，会让所有按钮描成刺眼亮线。本项目按钮可识别性由「底色差 + 边框 + 阴影环」复合提供，悬停/聚焦用 `--edge-strong`，焦点环单独达标。
- 代码高亮 `--hl-*` 收为单一来源，diff 面板与证据浮层共用（原先是两份手抄的相同字面值）。

### 2.4 切换瞬时一致性

- **只换色不动布局**：改动限于 `color` / `background` / `border-color` / `box-shadow` / `--ansi-*` / `--hl-*`；禁止顺手改尺寸、圆角、间距、字号、字重。切换前后任何元素的 `getBoundingClientRect()` 必须逐值相等。
- **瞬时切换，不做过渡**：切换时给 `<html>` 加 `theme-switching`，该类下 `*, *::before, *::after { transition:none !important }`，两帧后移除。放任逐元素渐变时，`backdrop-filter` 层与半透明叠色区会出现互相错位的中间态。
- 该行为**无条件启用**，不挂 `prefers-reduced-motion`：本机该查询恒为 true，挂上去等于所有用户走另一条分支；且既有教训是给动画加降级会让全站视觉一半动一半不动。
- 不做交叉淡入（叠两层主题截图淡化）：`backdrop-filter` + 半透明表面叠两层会出现第三种颜色。

### 2.5 无障碍

- 外观选项用 `role="menuitemradio"` + `aria-checked`，容器 `role="group" aria-label="外观"`；不用 `role="radio"`，也不塞进按钮组。
- 选中态不只靠颜色：右侧 `IC.check` 图标 + 该项文字加重，颜色仅辅助；灰度截图下仍可分辨。每项是无边框整行菜单项（30px，与同组 `.datapop-item` 一致），不做胶囊——项目约定带边框带底色的胶囊只读信息会被当成「第三个按钮」。
- 键盘可达：`→` 打开子菜单并聚焦第一项；组内 ↑↓/Home/End 移动、Enter/Space 确认；`Esc` / `←` 只收子菜单并回焦到行，用 `stopPropagation` 挡住 window 上「Esc 关整个浮层」的监听。
- 焦点可见：暗色焦点环用 `--blue`（约 4.7:1，满足 1.4.11 的 3:1）；不用 `outline:none` 换浅色描边。
- 语义色不依赖色相单通道：错误/成功状态保留图标或文案；状态灯只提亮，编码与形态对应关系不变。

### 2.6 身份色分配

| 决策点 | 结论 |
|---|---|
| 色板长度 | 5 → 24（`PROJECT_COLORS`），分深浅两圈 |
| 两圈结构 | 第 1–12 中深色（白字），第 13–24 同色相浅色（深字） |
| 色板顺序 | 蓝 / 红 / 绿 / 橙 / 紫 / 青 / 粉 / 橄榄 / 靛 / 品红 / 棕 / 灰，浅色圈同序；不取高亮度黄（白字读不出、深字易与警示色混淆） |
| 分配键 | 按**项目 id 排序后的序号**取色，与列表位置无关 ⇒ 拖拽不换色 |
| 头像字色 | `avatarInk()` 按底色亮度选白/深字（阈值 0.62） |
| 品牌图标 | 有专属图标时显示真实图标，否则回退首字母 + 身份色头像；类型 / 技术栈（Android、Obsidian、IntelliJ、Electron、JavaFX、Spring Boot、Kotlin、Java、Gradle、Maven、npm）改为项目名后的小图标，色板分配规则不变 |
| 单一真源 | `lib/project-color.js` 的 `projectColorMap` 唯一分配处，`format.js` 的 `avatarColor` 只查表 |
| 计算成本 | 单槽缓存（id 列表 join 作 key），一屏多行头像只算一次 |

## 3. 交付物

| 文件（相对路径） | 职责 |
|---|---|
| `web/index.html` | 内联 IIFE：首帧定 `data-theme` |
| `web/src/lib/theme.js` | `THEME_KEY` / `THEMES` / `normalizePref` / `readPref` / `writePref` / `resolveApplied`（无 React 依赖） |
| `web/src/hooks/useTheme.js` | `pref` / `applied` / `setPref`，`matchMedia` 监听、`theme-switching` 类、通知主进程 |
| `web/src/styles/tokens.css` | `:root` 浅色值与新增中性 token（`--ink-rgb` / `--edge` / `--card-hi` / `--bg-sunken` / `--bg-hover*` / `--bg-glass` / `--on-accent-soft` / `--scrim*` / `--hl-*` 等） |
| `web/src/styles/theme-dark.css` / `web/src/styles/index.css` | 暗色唯一定义处（全部 token 重定义、`color-scheme: dark`、滚动条补丁）；`index.css` 保证它在 `responsive.css` 之前引入 |
| `web/src/styles/*.css` | 各域文件（controls / pagebar / sidebar / context / requirements / overview / changes / stats / evidence / palette / launch / modal / warnbar）改用 `var()` 与 RGB 三元组 |
| `web/src/icons.jsx` | `sun` / `moon` / `auto` 三图标 |
| `web/src/Sidebar.jsx` | 「外观」行 + 皮肤 / 暗色并排的二级菜单（`menuitemradio`、键盘导航、延迟收起） |
| `web/src/App.jsx` | 接入 `useTheme()` 并向 Sidebar 透传 `theme` / `onSetTheme` |
| `electron/ipc.js` / `preload.js` / `main.js` | `pm:appearance` 单向通道、`setAppearance`、`applyAppearance` / `syncChromeOnShow`（窗口底色与 Windows `titleBarOverlay` 跟随） |
| `electron/splash.html` | 启动卡片双主题配色 |
| `scripts/theme-audit.js` | 解析 `theme-dark.css` 逐对计算 WCAG 对比度，FAIL 时退出码 1 |
| `web/src/constants.js` | `PROJECT_COLORS`（24 色，原 `AVATAR` 移除） |
| `web/src/lib/project-color.js` | `projectColorMap(projects)`：去重、按 id 排序、取色、单槽缓存 |
| `web/src/format.js` / `web/src/ui.jsx` | `avatarColor` 改为查表（签名不变）、新增 `avatarInk(bg)`；`Avatar` 字色跟随底色 |
| `web/src/components/RunPalette.jsx` / `styles/palette.css` | 命令面板用同源色标 + 加粗项目名做归属标识 |

## 4. 关键修正与教训

- **ANSI 背景不逐条手抄**：暗色 16 个 `--ansi-bg-*` 由 `color-mix(in srgb, var(--ansi-fg-*) 22%, var(--ansi-default-bg))` 从前景派生，改前景时背景自动跟随；`--ansi-bg-white` 例外保留 `#D8D8DC`，因为「白底块」本身是要保留的语义。
- **暗色「按下态」要更亮而不是更暗**：深底上压暗几乎不可见，`--red-press` 取 `#E33B31`，与浅色 `#E5332A` 不是同一条推导。
- **Windows 会忽略对隐藏窗口设置的标题栏覆盖色**：渲染端首屏就报主题，而主窗口要等 `pm:renderer-ready` 才 `show()`，三个系统按钮会停在建窗配色。修法是主进程记住最近一次生效主题（`appearanceDark`），在 `reveal()` 之后与窗口 `show`（托盘恢复）时各刷一次 `syncChromeOnShow()`；建窗仍按 `nativeTheme.shouldUseDarkColors` 给初值，保证首帧不闪。
- **外观选择器最终改为「一行 + 二级菜单」**：三行平铺让菜单多出 4 行、整体过长。子菜单用 `position:fixed`，因为 `.datapop` 是 `overflow:auto`，内部绝对定位会被裁剪；fixed 又会在浮层内滚动或窗口缩放时脱离锚点，故这两种情况直接收起。行与子菜单间有 6px 空隙，鼠标移出用 **140ms 延迟收起**并由子菜单 `mouseenter` 取消——`mouseleave` 判的是布局几何而非 DOM 包含关系，子菜单虽在同一 wrapper 子树内，物理上却在 wrapper 盒子之外。
- **2026-11-23 皮肤并入外观一行**：原来「外观」「皮肤」两行各带二级菜单，用户反馈入口重复；合并后子菜单里三种皮肤与暗色并排成一排（横排四格，`menuitemradio` + 浅底蓝字标记当前项），跟随系统单列在下方，皮肤与暗色共用一个 `openSub` 机制。选皮肤会同时切到浅色，避免深色下点了没反应。
- **「浅色像素基线不变」是硬约束**：任何 token 化都要保证解析值与替换前字面量逐项相等，不用「差不多」。验收以构建通过 + 计算样式逐项比对为准，截图逐像素 diff 留人工复核。
- **审计脚本不进 `npm run check`**：它是验收工具（读 CSS 算对比度），与 `node --check` 的语法检查不是一类，避免每次检查都跑一遍。

## 5. 已知边界

- 对比度已知债：暗色静止边框 `--edge` 约 2.5:1，靠底色差、`--edge-strong` 与阴影环复合保证可识别（有意取舍）；浅色 `--label-4` 对小字号不达 AA，因像素基线约束不修。
- 启动窗在「系统暗 + 用户手选浅色」下约有 300ms 配色不一致，不做偏好落盘主进程的双写。
- 身份色超过 24 个项目后从第一个色复用，不再保证互不相同；浅色圈色块在白底上边界感较弱（靠圆角与字色区分，只在前 12 色用满后出现），属刻意设计。
- 删除项目会让 id 序在其后的项目前移一位并换色；侧栏「已归档」分组用归档项目自己的集合算色，可能与某个活跃项目同色（活跃项目在侧栏 / 顶栏 / 总览 / 命令面板之间始终一致）。
- 不支持手工指定项目颜色。

## 6. 后续候选

- 项目设置里允许手动选色：需给 `projects` 加 `color` 字段并处理旧数据补齐，届时 24 色板退化为「推荐色」。
- 若要支持 24 个以上可加第三圈（中间明度），但可读性与辨识度都会明显下降，暂不做。
- 若启动窗配色错位被视为问题，可把偏好同步落盘给主进程；当前判断为不划算。

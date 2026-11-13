---
date: 2026-11-11
description: 浅色三皮肤（清透/暖纸/活力，默认活力）解决亮色「灰蒙蒙」；皮肤只作用浅色、暗色隔离，外观菜单新增皮肤入口，窗口底色联动
status: accepted
---

# 浅色皮肤 — 决策记录

> 状态：✅ 已验收（2026-11-11）
> 主题三态与暗色实现见 [theme-and-identity-colors.md](./theme-and-identity-colors.md)。

## 1. 目标与范围

- 亮色界面「近白叠近白 + 低饱和 + 大量灰字」显得灰蒙蒙。提供三套可选浅色皮肤让用户按气质挑选，默认「活力」。
- 在「设置与数据 → 外观」处新增「皮肤」入口。**暗色模式不动**。

## 2. 关键决策

- **三皮肤**：清透 `crisp`（略深冷灰底 + 纯白卡片强分层）、暖纸 `warm`（暖纸底 + 暖墨字 + 琥珀强调）、活力 `vivid`（纯白 + 电光蓝 + 最强景深，默认）。方向由真实尺寸并排对比稿拍板。
- **皮肤只作用浅色**：选择器 `html[data-theme="light"][data-skin=…]`，特异性高于 `:root`、与暗色选择器互斥，暗色完全隔离（暗色取值仍只在 `theme-dark.css`）。
- **只覆盖去灰杠杆**（表面 / 文字 / 强调 / 阴影）；语义色（绿/橙/红）、ANSI、代码高亮、commit 类型色共用 `:root`，不随皮肤变。
- **强调走 `--accent-rgb` 通道**：`--blue-tint` / `--selection` 由它派生；少量硬编码蓝（logo / 主按钮 / 激活导航）转为 `rgb(var(--accent-rgb) / …)`，暖纸把强调转琥珀时全局联动。
- **皮肤与主题正交**：`useTheme` 同时管 `data-theme` + `data-skin`，一个 effect 写两者并 `setAppearance(isDark, 皮肤底色)`；切换瞬间加 `theme-switching` 禁过渡（即时换色，非渐变）。
- **窗口/标题栏联动**：`setAppearance` 增加 `lightBg` 参数，主进程校验 hex 后设窗口底色与 Windows 标题栏覆盖色，标题栏与内容同色。
- **首帧防闪**：`index.html` 内联脚本读 `pm.ui.skin`（默认 vivid）写 `data-skin`，与 `lib/skin.js` 同源；`main.jsx` 兜底。
- **菜单**：外观 / 皮肤两行共用一套二级菜单机制（`openSub` 标记当前展开行），保留键盘/焦点/悬停/点外收起；皮肤项带双色色板 + 「仅浅色生效」脚注。

## 3. 交付物

| 文件 | 作用 |
| --- | --- |
| `web/src/styles/skins.css` | 三套浅色皮肤令牌（scoped 到 light），`index.css` 在 tokens 后引入 |
| `web/src/lib/skin.js` | 皮肤偏好：键 / 取值 / 默认 / 读写 / 各皮肤主底色 `SKIN_BG` |
| `web/src/hooks/useTheme.js` | 同管 theme + skin，写 `data-skin`、联动窗口底色，返回 `skin/setSkin` |
| `web/src/Sidebar.jsx` / `icons.jsx` | 统一二级菜单 + 皮肤行 + 调色盘图标 |
| `web/src/styles/{tokens,sidebar,controls}.css` | accent 通道派生、硬编码蓝转换、色板与脚注样式 |
| `web/index.html` / `web/src/main.jsx` | 首帧 `data-skin` + 兜底 |
| `electron/{preload,ipc,main}.js` | `setAppearance` 增加皮肤底色参数（校验 hex） |

验收：构建通过；浏览器核验三皮肤浅色令牌各自正确、暗色任何皮肤下恒为 `#1C1C1E`、默认 vivid、菜单选择即持久化且行尾更新、外观菜单回归正常、切浅色后皮肤底色生效；Electron 三文件 `node --check` 通过；控制台无报错。

## 4. 已知边界

- 皮肤仅浅色：深色模式下选皮肤只持久化、切回浅色才生效（菜单脚注已说明）。
- 暖纸把 `--blue` 家族整体转琥珀（身份色偏暖）；commit 类型色与 ANSI 终端色是固定语义，不受皮肤影响。
- 皮肤切换为即时换色（沿用 `theme-switching` 禁过渡），不做渐变。
---
date: 2026-11-11
description: 滚动条改为全局「滚动时才浮现、停手自动隐去」的 macOS 观感；thumb 默认透明、.scrolling 时显形，保留 11px 轨道槽避免布局跳动
status: accepted
---

# 滚动条自动隐藏 — 决策记录

> 状态：✅ 已验收（2026-11-11）

## 1. 目标与范围

- 侧栏项目列表的灰色滑块常驻显示，在 Windows 上不会自动隐藏，一直杵在右缘显得突兀。改为「滚动时才浮现、停手约 0.8s 后隐去」的 macOS 原生观感。
- 范围：**全局所有滚动区**（侧栏 / 日志 / 需求列表 / 各浮层），浅色与暗色一致。

## 2. 关键决策

- **选 B（滚动浮现）**，而非 A（悬停显形）或 C（自绘滑块淡变）。理由：成本/观感最均衡，最贴现有 Apple 设计语言。落地前用真实尺寸可滚对比稿让用户体验后拍板。
- **全局套用**：一个捕获阶段的 `document` scroll 监听覆盖所有容器（scroll 不冒泡，必须用捕获），给滚动目标挂 `.scrolling`、停手 800ms 摘除；幂等安装避免重复监听。
- **显隐是瞬间切换，不是淡变**：原生 `::-webkit-scrollbar-thumb` 不吃 CSS `transition`。要丝滑淡入淡出只能自绘滑块（方案 C，未采纳）。
- **thumb 默认透明、`.scrolling` 时显形**；保留 11px 透明轨道槽，显隐不改变内容宽度，**无布局跳动**。
- 日志区沿用更淡档（浅 `.26` / 暗 `.34`）；暗色补丁仍只写在 `theme-dark.css`，不与浅色混文件。

## 3. 交付物

| 文件 | 作用 |
| --- | --- |
| `web/src/lib/scroll-reveal.js` | 全局捕获 scroll 监听 + 幂等 `installScrollReveal()`，`.scrolling` 挂/摘（800ms） |
| `web/src/main.jsx` | 入口引入并调用 `installScrollReveal()` |
| `web/src/styles/scroll.css` | thumb 默认透明、`.scrolling` 显形；`.logs.scrolling` 更淡档 |
| `web/src/styles/theme-dark.css` | 暗色同构：默认透明 + `.scrolling` 显形（`.44` / logs `.34`） |

验收：构建通过；浏览器计算样式核验浅/暗 × 静止/滚动/logs 共 8 个色值与 11px 槽均符合预期；真实滚动 `.scrolling` false→true→950ms 后 false；控制台无报错。

## 4. 已知边界

- 静止时滑块不可见，无法直接看到/抓取，需先滚动一下——macOS 同款取舍。
- 显隐无淡入淡出（原生滚动条限制）。
- 日志持续输出时滚动事件不断，滑块会持续显示，停输出后隐去，属预期。
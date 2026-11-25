---
date: 2026-11-25
description: 截图工具化：项目级 skill 注入虚构数据，用无头 Chromium 按真实前端逐页截取亮/暗色高清图；数据刻意收敛，左栏只给真正要处理的项目亮灯
status: accepted
---

# 应用截图（app-screenshots）

## 结论

- 截图流程收进项目级 skill `.agent/skills/app-screenshots/`，入口 `SKILL.md`；下次说“截一套图”即可。
- 两套场景：`--suite readme`（默认）出 `doc/screenshots/` 九张整窗图；`--suite note` 出 `.screenshots/note/` 七张局部特写，供公众号 / 知识库的 1.4.0 文章。
- 数据全部虚构（星港数据平台、极光移动端等），规模刻意收敛：10 个可见项目、约 39 条需求、16 条命令、2 个有改动项目。左栏状态灯按“谁真的需要你动手”点亮，橙点只留给有未提交改动或未拉取提交的项目，候选池角标与「AI 停」各只出现一两次。不读取本机 `db.json`，避免截图泄露真实项目。
- 认领人只用主流 Agent 名字（Cursor / Claude Code / Work Buddy / Copilot Agent），只剩 id 的旧记录由生成器映射成 Qoder，避免截图里出现认不出的名字。
- 驱动方式：真实前端构建 + 注入 `window.pm` 演示桥，Playwright 缓存里的 Chromium 经 CDP 操作与截图；不新增 npm 依赖。
- 默认亮色、应用默认窗口 1280×860、2x 导出（2560×1720）；`--theme dark` 出暗色；需要大图时用 `--width/--height` 覆盖。

## 关键修正

- 左侧项目栏是截图里最先被看到的区域：项目数压到 10 个，需求灯每行最多一盏，改动/同步灯只留在星港与灯塔，运行灯只留给真的在跑的项目。想要某行安静下来就清空该项目的 `changes`、去掉 `behindMap` 条目。
- 提问卡片是 sticky，切换需求后必须先复位 `rpanel-body.scrollTop` 再定位，否则截到半张卡片。
- 时间线必须按当前需求生成；演示底座原来固定输出 #12 的事件，切需求会串台。
- 目录悬停走 `projectDir`（不是 `fileSnippet`），mock 需要补 `{ entries, total, truncated }`。
- SVG 预览的 `gitDiff.diff` 必须是字符串；给数组会让 DiffText 直接抛 `split is not a function`，界面整屏报错。
- 菜单用点击展开（`.pmenu-parent`、`.datapop-item`），别用悬停：鼠标路过项目行会弹出项目悬停卡，把截图弄花。
- 构建产物是 ES module，`file://` 打不开，必须本地 HTTP。
- 数据日期按运行时刻生成，隔几天重截仍是“今天/昨天”。

## 资源

- 使用与参数：`.agent/skills/app-screenshots/SKILL.md`
- 场景步骤与选择器：`.agent/skills/app-screenshots/references/shot-plan.md`
- 脚本：`scripts/capture.cjs`（构建/服务/CDP/截图，两套场景）、`scripts/gen-mock.cjs`（虚构数据合成）
- 演示桥底座：`assets/mock-base.js`

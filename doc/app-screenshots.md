---
date: 2026-11-12
description: 截图工具化：项目级 skill 注入虚构数据，用无头 Chromium 按真实前端逐页截取亮/暗色高清图
status: accepted
---

# 应用截图（app-screenshots）

## 结论

- 截图流程收进项目级 skill `.agent/skills/app-screenshots/`，入口 `SKILL.md`；下次直接 `/app-screenshots` 或说“截一套图”。
- 数据全部虚构（星港数据平台、极光移动端等），规模参考真实使用：约 20 个项目、60 条需求、30+ 条命令、8 个有改动项目。不读取本机 `db.json`，避免截图泄露真实项目。
- 驱动方式：真实前端构建 + 注入 `window.pm` 演示桥，Playwright 缓存里的 Chromium 经 CDP 操作与截图；不新增 npm 依赖。
- 默认亮色、应用默认窗口 1280×860、2x 导出（2560×1720），输出 `doc/screenshots/`；`--theme dark` 出暗色；需要大图时用 `--width/--height` 覆盖。
- 固定七个场景：总览 / 统计 / 需求中心 / 启动台 / 修改记录 / Agent 恢复（解锁项目）/ Agent 询问（待回答卡片）。

## 关键修正

- 提问卡片是 sticky，切换需求后必须先复位 `rpanel-body.scrollTop` 再定位，否则截到半张卡片。
- 时间线必须按当前需求生成；演示底座原来固定输出 #12 的事件，切需求会串台。
- 构建产物是 ES module，`file://` 打不开，必须本地 HTTP。
- 数据日期按运行时刻生成，隔几天重截仍是“今天/昨天”。

## 资源

- 使用与参数：`.agent/skills/app-screenshots/SKILL.md`
- 场景步骤与选择器：`.agent/skills/app-screenshots/references/shot-plan.md`
- 脚本：`scripts/capture.cjs`（构建/服务/CDP/截图）、`scripts/gen-mock.cjs`（虚构数据合成）
- 演示桥底座：`assets/mock-base.js`

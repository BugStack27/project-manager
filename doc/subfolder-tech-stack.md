---
date: 2026-11-23
description: 技术栈识别兜底扫一级子目录，并把 Go / Rust / Python / Docker 纳入技术栈
---

# 识别子文件夹的技术栈 - 任务规划

## 1. 需求概述

需求 #65「识别技术栈的时候支持识别子文件夹，最多识别一层，防止过度分析」。

现状：`electron/services/project-detect.js#detectProfile` 只看项目根目录的构建文件，`doc/projects.md` §5 也把「根目录没有构建标记、标记在一级模块」的多模块仓库列为已知缺口（`stacks` 为空）。本次目标：

1. 根目录一个技术栈都认不出来时，兜底扫一级子目录，最多一层；
2. 技术栈集合补上 Go / Rust / Python / Docker（此前只在启动命令推荐的 `detect` 里出现）。

不做：`kind`（主图标）与启动命令推荐（`detect`）的子目录扫描；不递归到第二层；不读子目录里构建文件的内容。

## 2. 需求澄清记录

| 问题 | 结论 |
|---|---|
| 子目录识别是兜底还是与根目录合并 | 兜底：只在根目录认不出任何技术栈时扫一级子目录；根目录命中后不再往下看 |
| 命令推荐是否也扫子目录 | 不扫，只扩技术栈角标 / tooltip |
| 子目录参与识别的技术栈范围 | 在现有集合上新增 Go / Rust / Python / Docker |
| 规划文档与实现的关系 | 由需求派发即视为开工确认，写完规划文档后本轮直接实现并交付 |

补充假设（实现时按此落下，交付说明里点明）：

1. 子目录只做「特征文件 / 源码目录是否存在」的判断，不读 package.json / pom.xml 内容：`electron`、`spring-boot`、`javafx`、`intellij` 这类要读内容或根上下文的类型仍只在根目录判定。这既是「防止过度分析」的落地，也让缓存只需看目录 mtime。
2. 跳过依赖 / 产物 / 版本库目录（`node_modules`、`dist`、`build`、`target`、`out`、`bin`、`obj`、`vendor`、`coverage`、`venv`、`__pycache__`，以及所有 `.` 开头的目录），最多看 30 个一级目录。
3. 新增四个图标为自绘的简化标记（品牌色 + 简单几何），不复制官方 logo 路径。

## 3. 现状与缺口

| 环节 | 现状 | 缺口 |
|---|---|---|
| 技术栈识别 | `detectProfile` 只读根目录：`package.json` / `pom.xml` / `build.gradle(.kts)` / `src/main/{java,kotlin}`，另由内容判定 electron / spring / javafx / intellij | 标记在一级模块的多模块仓库 `stacks` 为空 |
| 技术栈集合 | 只有 Android、Obsidian、IntelliJ、Electron、JavaFX、Spring Boot、Kotlin、Java、Gradle、Maven、npm | 有 Go / Rust / Python / Docker 文件的项目技术栈为空 |
| 缓存 | `PROFILE_CACHE` 按根目录特征文件 mtime/size 签名，5 秒轮询只 stat | 子目录结果需要独立的失效条件 |
| 前端 | `PROJECT_STACK_LABELS`、`STACK_ICONS`、`STACK_ORDER` 三处白名单 | 新类型无文案、无图标、无优先级 |

## 4. 任务列表

### 任务 1：抽取「看目录得技术栈」的判定（服务端）

| 属性 | 值 |
|---|---|
| **描述** | 在 `project-detect.js` 抽出 `buildStackIds(dir)`（npm / maven / gradle / rust / go / python / docker）与 `languageIdsIn(dir)`（java / kotlin）；根目录与新逻辑共用 |
| **依赖关系** | 无 |
| **验收标准** | 根目录识别结果与改动前一致，仅多出 Go / Rust / Python / Docker |

### 任务 2：根目录认不出时兜底扫一级子目录（服务端）

| 属性 | 值 |
|---|---|
| **描述** | 新增跳过清单与 30 个目录上限；`stacks` 为空时扫描一级子目录合并结果；缓存增加 `subSig`（候选目录名 + 目录 mtime），只有根目录空栈的项目才在轮询时多一次 `readdir` |
| **依赖关系** | 依赖任务 1 |
| **验收标准** | 根目录为空、`web/package.json` 存在时 `stacks` 含 `npm`；根目录已有 `go.mod` 时不再看子目录；`node_modules` 内的标记不算；第二层不扫；新增 / 改名一级目录后重新识别 |

### 任务 3：前端技术栈白名单补齐（四个新类型）

| 属性 | 值 |
|---|---|
| **描述** | `constants.js` 补文案；`assets/icons/brand` 新增四个 SVG；`icons.jsx` 导出；`ui.jsx` 的 `STACK_ICONS` / `STACK_ORDER` 注册（语言排在 npm 前，Docker 排最后） |
| **依赖关系** | 无（可与任务 1、2 并行） |
| **验收标准** | 侧栏行 tooltip、悬停卡片技术栈清单能显示四项；主图标按优先级取到其中一个；12px 下可辨认 |

### 任务 4：文档与验证

| 属性 | 值 |
|---|---|
| **描述** | 更新 `doc/projects.md` 的识别口径与已知边界；本规划文档入库；`npm run check` + 子目录夹具脚本 + `npm run build` 验证 |
| **依赖关系** | 依赖任务 1–3 |
| **验收标准** | `npm run check` 通过；夹具脚本各断言通过；web 构建通过 |

## 5. 执行顺序

任务 3 与任务 1、2 互不依赖，可先后落地；任务 4 最后收口。服务端改动需要重启主进程才生效（沿用 `doc/projects.md` §4 的教训）。

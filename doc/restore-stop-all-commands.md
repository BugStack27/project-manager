---
date: 2026-11-25
description: 恢复备份被运行中命令拦截时，在弹窗里一键停止全部项目命令并重试恢复
---

# 恢复备份时一键停止全部命令 - 任务规划

## 需求概述

有命令在运行时恢复备份会被 409 拒绝，提示用户去启动台逐条停止；启动台只列当前项目的命令，多项目都有进程时需要来回切换。本次在恢复失败的提示处增加「全部停止并重试」：复用退出应用时的全停逻辑，一次停掉所有项目里仍在运行的命令（含已分离但宿主存活的），确认停干净后自动重试恢复。

不做：把全停暴露到 MCP；改变恢复的安全守卫；调整启动台交互。

## Requirements

### 1. 全停逻辑下沉并复用退出清理

| 属性 | 值 |
|------|-----|
| **目标** | 在 runner 提供 `stopAll(waitMs)`：遍历所有 `isActive` 的命令逐条停止，单条失败不打断其余命令并回报；分离命令按 `hostPid` 轮询确认真正退出后返回 `survivors`；`main.js` 的退出清理改调它，保持原有行为 |
| **涉及文件** | `electron/services/runner.js`、`electron/main.js` |
| **验收标准** | `npm run check` 通过；退出（stop 模式）仍会停掉全部运行中命令且不额外拖慢；stopAll 返回总数、失败明细与未退出宿主 |
| **依赖** | 无 |

### 2. 恢复弹窗增加「全部停止并重试」

| 属性 | 值 |
|------|-----|
| **目标** | 领域层新增 `stopAllCommands`：调用 `runner.stopAll` 后等托管进程收敛、分离宿主确认退出（均有上限），返回 stopped / remaining / failed；前端 `commands_running` 错误时就地显示「全部停止并重试」，remaining 为 0 才自动重试恢复 |
| **涉及文件** | `electron/services/domain/commands.js`、`web/src/api.js`、`web/src/components/BackupModal.jsx`、`web/src/styles/modal.css` |
| **验收标准** | `npm run build` 通过；恢复被拦时按钮出现；点击后跨项目停止全部命令（含分离进程）并自动重新恢复；仍有残留时保留按钮并明确提示，不恢复 |
| **依赖** | 1 |

## Complements

### 1. 全停逻辑下沉并复用退出清理
- **状态**：✅ 已完成
- **变更文件**：`electron/services/runner.js`（新增 `stopAll`，分离命令按 hostPid 确认退出）、`electron/main.js`（shutdown 复用）
- **审查结果**：通过（证据：`npm run check` exit=0；隔离数据目录实测 live/detached 两条命令均停止且宿主 pid 已消失）
- **完成时间**：2026-11-25 16:35

### 2. 恢复弹窗增加「全部停止并重试」
- **状态**：✅ 已完成
- **变更文件**：`electron/services/domain/commands.js`（新增 `stopAllCommands`）、`web/src/api.js`（通道）、`web/src/components/BackupModal.jsx`（按钮与状态机）、`web/src/styles/modal.css`（错误条布局）
- **审查结果**：通过（证据：`npm run build` exit=0；复审确认 detached 残留不会绕过恢复守卫）
- **完成时间**：2026-11-25 16:35

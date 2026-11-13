import ChangeDiff from '../ChangeDiff.jsx';
import LogDrawer from '../LogDrawer.jsx';
import RequirementDetail from '../RequirementDetail.jsx';
import { PanelClose } from '../ui.jsx';

/** 引导态（这一页还没有可看的内容）：提示文字 + 关闭按钮同一行，抽屉任何时候都有关闭入口 */
function Hint({ onClose, children }) {
  return (
    <div className="rp-hintrow">
      <div className="rpanel-hint">{children}</div>
      {onClose ? <PanelClose onClick={onClose} /> : null}
    </div>
  );
}

/**
 * 右面板 = 覆盖式抽屉：页面 → 内容的一处映射。
 *
 * 布局语义：
 * - 绝对定位在 .app 里，top 44px 让开页栏与 Windows 系统按钮区，只盖中区内容；
 * - 关闭时移出视口（.closed → translateX(100%)）而不是卸载，所以各内容的内部状态
 *   （日志的 runId / 搜索态 / 滚动位置、详情页的编辑草稿）不会因收展被重置；
 * - 没有标题栏，关闭按钮由各内容挂在自己第一行的末尾（onClosePanel 一路传下去）。
 *
 * 选中对象的 key 必须保留：切换需求 / 命令时重建组件，否则 LogDrawer 的 runId、
 * 详情面板的编辑态会串台。
 */
export default function RightPanel({
  page,
  project,
  projects,
  collapsed,
  width,
  sel,
  content,
  diffUnavailable,
  commitFiles,
  logCommand,
  logNonce,
  logRunId,
  logFind,
  selReq,
  onOpenProject,
  onOpenRequirement,
  onDragStart,
  onClosePanel,
  onCloseLog,
  onStart,
  onStop,
  onSaveRequirement,
  onDeleteRequirement,
  onArchiveRequirement,
  onStatusRequirement,
  onAnswerRequirement,
  onApproveRequirement,
  onReplyRequirement,
  onUnlockRequirement,
  onRelockRequirement,
  onOpenAudit,
  onViewChanges,
  notify
}) {
  return (
    <aside
      className={'rpanel' + (collapsed ? ' closed' : '')}
      style={{ '--rp-w': width + 'px' }}
      aria-hidden={collapsed}
    >
      {/* 左缘拖动把手：跟手调宽，命中区左右各 4px */}
      <div className="rz" onPointerDown={onDragStart} />

      <div className="rpanel-body">
        {page === 'statistics' ? (
          <Hint onClose={onClosePanel}>统计页不展示详情</Hint>
        ) : page === 'overview' ? (
          <Hint onClose={onClosePanel}>总览页不展示详情，点项目进入对应页面</Hint>
        ) : !project ? (
          <Hint onClose={onClosePanel}>还没有选中项目</Hint>
        ) : page === 'changes' ? (
          <ChangeDiff
            sel={sel}
            content={content}
            unavailable={diffUnavailable}
            commitFiles={commitFiles}
            projectId={project.id}
            onClose={onClosePanel}
          />
        ) : page === 'launch' ? (
          logCommand ? (
            <LogDrawer
              key={logCommand.id}
              resetToken={logNonce}
              initialRunId={logRunId}
              initialFind={logFind}
              command={logCommand}
              onClose={onCloseLog}
              onStart={onStart}
              onStop={onStop}
            />
          ) : (
            <Hint onClose={onClosePanel}>点左侧任意启动项即可查看它的运行日志</Hint>
          )
        ) : selReq ? (
          <RequirementDetail
            key={selReq.id}
            requirement={selReq}
            project={project}
            projects={projects}
            onOpenProject={onOpenProject}
            onOpenRequirement={onOpenRequirement}
            onSave={(patch) => onSaveRequirement(selReq, patch)}
            onDelete={() => onDeleteRequirement(selReq)}
            onArchive={() => onArchiveRequirement(selReq)}
            onStatus={onStatusRequirement}
            onAnswer={(text, qid) => onAnswerRequirement(selReq, text, qid)}
            onApprove={(autoPush) => onApproveRequirement(selReq, autoPush)}
            onReply={(text) => onReplyRequirement(selReq, text)}
            onUnlock={() => onUnlockRequirement(selReq)}
            onRelock={() => onRelockRequirement(selReq)}
            onOpenAudit={onOpenAudit}
            onViewChanges={onViewChanges}
            onClose={onClosePanel}
            notify={notify}
          />
        ) : (
          <Hint onClose={onClosePanel}>点击左侧需求查看详情</Hint>
        )}
      </div>
    </aside>
  );
}

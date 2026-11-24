import { CommandForm, ProjectForm, RequirementForm, RequirementStatusForm } from '../forms.jsx';
import ArchiveModal from './ArchiveModal.jsx';
import AuditModal from './AuditModal.jsx';
import BackupModal from './BackupModal.jsx';
import CommitModal from './CommitModal.jsx';
import GitSettingsModal from './GitSettingsModal.jsx';
import AiAccessModal from './AiAccessModal.jsx';
import MobileLinkModal from './MobileLinkModal.jsx';
import NotificationModal from './NotificationModal.jsx';
import ProjectSettingsModal from './ProjectSettingsModal.jsx';
import ShortcutSettingsModal from './ShortcutSettingsModal.jsx';
import UpdateModal from './UpdateModal.jsx';

/**
 * 弹窗装配：modal 是单一 state（{type, ...载荷}），同一时刻最多一个。
 * 各弹窗自己管表单状态与错误展示，这里只负责把载荷与回调接上去。
 */
export default function AppModals({
  modal,
  project,
  projects,
  archivedProjects,
  onClose,
  onNavigate,
  onRestoredRequirements,
  onSaveProject,
  onArchiveProject,
  onRevealProject,
  onSaveRequirement,
  onConfirmStatusNote,
  onSaveCommand,
  onDeleteCommand,
  onCommit,
  update,
  onUpdateAction,
  onExportDiag,
  onRetryMcp,
  mcpBusy,
  shortcuts,
  notify
}) {
  if (!modal) return null;
  return (
    <>
      {modal.type === 'project' &&
        (modal.mode === 'edit' ? (
          <ProjectSettingsModal
            project={modal.project}
            projects={projects}
            onClose={onClose}
            onSave={onSaveProject}
            onArchive={onArchiveProject}
            onReveal={onRevealProject}
            notify={notify}
          />
        ) : (
          <ProjectForm
            mode={modal.mode}
            project={modal.project}
            initialPath={modal.initialPath}
            onClose={onClose}
            onSave={onSaveProject}
            onArchive={onArchiveProject}
          />
        ))}

      {modal.type === 'requirement' && (
        <RequirementForm
          project={project}
          projects={projects}
          onClose={onClose}
          onSave={onSaveRequirement}
        />
      )}

      {modal.type === 'status' && (
        <RequirementStatusForm
          requirement={modal.requirement}
          status={modal.status}
          onClose={onClose}
          onConfirm={onConfirmStatusNote}
          onNavigate={onNavigate}
        />
      )}

      {modal.type === 'archive' && (
        <ArchiveModal onClose={onClose} onRestored={onRestoredRequirements} notify={notify} />
      )}

      {modal.type === 'command' && (
        <CommandForm
          mode={modal.mode}
          project={project}
          command={modal.command}
          onClose={onClose}
          onSave={onSaveCommand}
          onDelete={onDeleteCommand}
        />
      )}

      {modal.type === 'commit' && (
        <CommitModal
          project={project}
          requirement={modal.requirement}
          changeCount={modal.changeCount || 0}
          onClose={onClose}
          onSubmit={onCommit}
        />
      )}

      {modal.type === 'mcp' && (
        <AiAccessModal
          info={modal.info}
          prompt={modal.prompt}
          workerPrompt={modal.workerPrompt}
          agents={modal.agents}
          busy={mcpBusy}
          onRetry={onRetryMcp}
          onClose={onClose}
          notify={notify}
        />
      )}

      {modal.type === 'backup' && <BackupModal onClose={onClose} notify={notify} />}

      {modal.type === 'audit' && (
        <AuditModal
          key={(modal.projectId || '') + ':' + (modal.requirementId || '')}
          projects={projects}
          archivedProjects={archivedProjects}
          initialProjectId={modal.projectId}
          initialRequirementId={modal.requirementId}
          requirementLabel={modal.requirementLabel}
          onNavigate={onNavigate}
          onClose={onClose}
        />
      )}

      {modal.type === 'notifications' && <NotificationModal onClose={onClose} notify={notify} />}

      {modal.type === 'mobile' && <MobileLinkModal onClose={onClose} notify={notify} />}

      {modal.type === 'git' && <GitSettingsModal onClose={onClose} notify={notify} />}

      {modal.type === 'shortcuts' && (
        <ShortcutSettingsModal
          bindings={shortcuts.bindings}
          setBinding={shortcuts.setBinding}
          resetOne={shortcuts.resetOne}
          resetAll={shortcuts.resetAll}
          onClose={onClose}
          notify={notify}
        />
      )}

      {modal.type === 'update' && (
        <UpdateModal
          state={update}
          onAction={onUpdateAction}
          onExport={onExportDiag}
          onClose={onClose}
          notify={notify}
        />
      )}
    </>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { samePath } from '../lib/paths.js';

/**
 * 项目集合与当前项目：启动加载、侧栏轮询、pid 有效性兜底、项目写操作。
 * 写操作统一走 reloadProjects：先让外部派生数据（统计缓存）失效，再拉全量。
 */
export function useProjects({ notify, setModal, onProjectsChanged }) {
  const [projects, setProjects] = useState([]);
  /** 已归档项目：只出现在侧栏「已归档」分组，不参与总览 / 需求 / 启动台 */
  const [archivedProjects, setArchivedProjects] = useState([]);
  const [booted, setBooted] = useState(false);
  const [pid, setPid] = useState(null);

  /** 当前项目 id 的镜面：拉取是长任务，回来时函数闭包里的 pid 可能已经过期 */
  const pidRef = useRef(null);
  /** 系统文件夹选择器打开期间挡住重复点击 */
  const pickingFolder = useRef(false);

  useEffect(() => {
    pidRef.current = pid;
  }, [pid]);

  const loadProjects = useCallback(async () => {
    try {
      // 一次取全量再拆开：归档项目只给侧栏用，其余页面继续拿未归档列表
      const { projects: all } = await api.projects(true);
      const active = all.filter((p) => !p.archived);
      setProjects(active);
      setArchivedProjects(all.filter((p) => p.archived));
      setPid((prev) => (prev && active.some((p) => p.id === prev) ? prev : active[0] ? active[0].id : null));
    } catch (e) {
      notify(e.message, 'warn');
    } finally {
      // 失败也要结束首屏 loading，否则界面永远停在「正在连接本地服务」
      setBooted(true);
    }
  }, [notify]);

  /** 项目集合被写操作改动后：外部派生数据失效 + 重新拉全量 */
  const reloadProjects = useCallback(async () => {
    onProjectsChanged?.();
    await loadProjects();
  }, [loadProjects, onProjectsChanged]);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  // 侧栏角标常驻刷新（也用于发现外部 AI 新增的需求）
  useEffect(() => {
    const t = setInterval(loadProjects, 5000);
    return () => clearInterval(t);
  }, [loadProjects]);

  /** 侧栏拖拽排序：先本地落位让列表立即跟手，落库失败再拉回真实顺序 */
  const reorderProjects = useCallback(
    async (ids) => {
      setProjects((cur) => {
        const byId = new Map(cur.map((p) => [p.id, p]));
        const next = ids.map((id) => byId.get(id)).filter(Boolean);
        return next.length === cur.length ? next : cur;
      });
      try {
        await api.reorderProjects(ids);
      } catch (e) {
        notify(e.message, 'warn');
        loadProjects();
      }
    },
    [notify, loadProjects]
  );

  /**
   * 添加项目：先弹系统文件夹选择器，选完并确认路径未被登记后才打开新建弹窗。
   * 路径在弹窗里只读——目录已由选择器确定，避免二次修改绕过查重。
   */
  const openCreateProject = useCallback(async () => {
    if (pickingFolder.current) return;
    pickingFolder.current = true;
    try {
      const res = await api.pickFolder('');
      if (!res || !res.path) return;
      const dup = projects.find((p) => samePath(p.path, res.path));
      if (dup) {
        notify('该文件夹已登记为项目「' + dup.name + '」，不能重复添加', 'warn');
        return;
      }
      setModal({ type: 'project', mode: 'create', initialPath: res.path });
    } catch (e) {
      notify(e.message || '无法打开文件夹选择器', 'warn');
    } finally {
      pickingFolder.current = false;
    }
  }, [projects, notify, setModal]);

  /** 归档：只改归档标记，需求 / 命令 / 运行日志原地保留；失败原样抛给表单展示 */
  const archiveProject = useCallback(
    async (p) => {
      await api.archiveProject(p.id);
      await reloadProjects();
      notify('已归档项目 ' + p.name + '，可在侧栏「已归档」分组恢复或彻底删除');
    },
    [notify, reloadProjects]
  );

  /** 彻底移除登记（仅限已归档项目）：只删数据记录与运行日志，磁盘上的代码目录原样保留 */
  const deleteProject = useCallback(
    async (p) => {
      try {
        const res = await api.deleteProject(p.id);
        await reloadProjects();
        const r = (res && res.removed) || {};
        notify(
          '已删除项目 ' + p.name + '（需求 ' + (r.requirements || 0) + ' 条 / 命令 ' + (r.commands || 0) + ' 条）'
        );
      } catch (e) {
        notify(e.message, 'warn');
      }
    },
    [notify, reloadProjects]
  );

  /** 从「已归档」分组恢复：只改归档标记，需求 / 命令 / 运行日志原地保留 */
  const restoreProject = useCallback(
    async (p) => {
      try {
        await api.updateProject(p.id, { archived: false });
        await reloadProjects();
        notify('已恢复项目 ' + p.name);
      } catch (e) {
        notify(e.message, 'warn');
      }
    },
    [notify, reloadProjects]
  );

  /** 在系统文件管理器中打开项目目录 */
  const revealProject = useCallback(
    async (p) => {
      try {
        await api.revealProject(p.id);
      } catch (e) {
        notify(e.message, 'warn');
      }
    },
    [notify]
  );

  /** 侧栏「数据文件」：在系统文件管理器中打开数据目录 */
  const openDataDir = useCallback(async () => {
    try {
      await api.revealDataDir();
    } catch (e) {
      notify(e.message, 'warn');
    }
  }, [notify]);

  /** 在系统默认终端中打开项目目录 */
  const openTerminal = useCallback(
    async (p) => {
      try {
        await api.openInTerminal(p.id);
      } catch (e) {
        notify(e.message, 'warn');
      }
    },
    [notify]
  );

  const project = projects.find((p) => p.id === pid) || null;

  return {
    projects,
    archivedProjects,
    project,
    booted,
    pid,
    setPid,
    pidRef,
    loadProjects,
    reorderProjects,
    openCreateProject,
    archiveProject,
    deleteProject,
    restoreProject,
    revealProject,
    openTerminal,
    openDataDir
  };
}

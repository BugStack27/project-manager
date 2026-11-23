import { Fragment, useEffect, useRef, useState } from 'react';
import { IC } from '../icons.jsx';

const MENU_W = 178;
const SUB_W = 132;
const MENU_PAD = 8;
const ITEM_H = 30;
const GAP = 1;
const SEP_H = 7; // 分隔线占高：1px 线 + 上下各 3px 留白
const SUB_CLOSE_MS = 140; // 鼠标从父项划向二级菜单要跨过几像素缝隙，留一点过路时间

/** 相对路径取项目所在父目录的视角：只留文件夹名（D:\job\demo → demo） */
function parentRelativePath(p) {
  const s = String(p || '').replace(/[\\/]+$/, '');
  const i = Math.max(s.lastIndexOf('\\'), s.lastIndexOf('/'));
  return i < 0 ? s : s.slice(i + 1);
}

/** 项目「更多操作」菜单：侧栏与总览共用，保证两边行为一致 */
export default function ProjectMenu({
  project,
  buttonClassName,
  onEdit,
  onOpenTerminal,
  onReveal,
  onArchive,
  onNotify
}) {
  const [menu, setMenu] = useState(null); // { left, top }
  /** 二级菜单（复制路径）：key 是父项标签，位置在展开时按父项实测矩形算 */
  const [sub, setSub] = useState(null); // { key, left, top }
  /** 归档项的就地两步确认：与设置弹窗的 DangerButton 同一口径，5 秒自动撤销 */
  const [armed, setArmed] = useState(false);
  const btnRef = useRef(null);
  const menuRef = useRef(null);
  const subTimer = useRef(null);

  useEffect(() => {
    if (!menu) return undefined;
    // 菜单一收起就复位确认态，下次打开仍是「归档项目」而不是「确认归档」
    const close = () => {
      setMenu(null);
      setSub(null);
      setArmed(false);
    };
    const onDown = (e) => {
      if (btnRef.current?.contains(e.target)) return;
      if (menuRef.current?.contains(e.target)) return;
      close();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [menu]);

  useEffect(() => {
    if (!armed) return undefined;
    const t = setTimeout(() => setArmed(false), 5000);
    return () => clearTimeout(t);
  }, [armed]);

  useEffect(() => () => clearTimeout(subTimer.current), []);

  function copyText(text, label) {
    const done = () => onNotify?.('已复制' + label);
    const fail = () => onNotify?.('复制失败，请手动选择文本复制', 'warn');
    if (!navigator.clipboard?.writeText) {
      fail();
      return;
    }
    navigator.clipboard.writeText(text).then(done, fail);
  }

  const copyPathItem = {
    label: '复制路径',
    icon: IC.copy,
    submenu: [
      { label: '绝对路径', run: () => copyText(project.path, '绝对路径') },
      { label: '相对路径', run: () => copyText(parentRelativePath(project.path), '相对路径') }
    ]
  };
  const items = [
    { label: '设置', icon: IC.gear, run: onEdit },
    { label: '在控制台中打开', icon: IC.term, tone: 'term', run: onOpenTerminal },
    { label: '在系统管理器中显示', icon: IC.folder, tone: 'folder', run: onReveal },
    copyPathItem
  ];
  // 归档与「打开类」操作性质不同：用分隔线隔开，并保留两步确认
  if (onArchive) {
    items.push({
      label: '归档项目',
      confirmLabel: '确认归档',
      icon: IC.archive,
      tone: 'archive',
      sep: true,
      confirm: true,
      run: onArchive
    });
  }

  /** 在触发按钮下方弹出菜单；靠近视口底部时上翻 */
  function toggleMenu(e) {
    e.stopPropagation();
    if (menu) {
      setMenu(null);
      setSub(null);
      setArmed(false);
      return;
    }
    const r = e.currentTarget.getBoundingClientRect();
    const height =
      MENU_PAD * 2 +
      items.length * ITEM_H +
      (items.length - 1) * GAP +
      (items.some((i) => i.sep) ? SEP_H + GAP : 0);
    const left = Math.max(8, Math.min(r.right - MENU_W, window.innerWidth - MENU_W - 8));
    const below = r.bottom + 4;
    const top = below + height > window.innerHeight - 8 ? Math.max(8, r.top - height - 4) : below;
    setMenu({ left, top });
  }

  /** 二级菜单贴父项右侧弹出；右边放不下就翻到左侧，纵向与父项对齐并夹在视口内 */
  function openSub(item, el) {
    clearTimeout(subTimer.current);
    const r = el.getBoundingClientRect();
    const h = MENU_PAD * 2 + item.submenu.length * ITEM_H + (item.submenu.length - 1) * GAP;
    const left =
      r.right + 4 + SUB_W <= window.innerWidth - 8
        ? r.right + 4
        : Math.max(8, r.left - SUB_W - 4);
    const top = Math.min(Math.max(8, r.top - MENU_PAD), window.innerHeight - h - 8);
    setSub({ key: item.label, left, top });
  }

  function scheduleSubClose() {
    clearTimeout(subTimer.current);
    subTimer.current = setTimeout(() => setSub(null), SUB_CLOSE_MS);
  }

  function closeAll() {
    clearTimeout(subTimer.current);
    setSub(null);
    setMenu(null);
    setArmed(false);
  }

  return (
    <>
      <button
        ref={btnRef}
        className={buttonClassName}
        onClick={toggleMenu}
        title="更多操作"
        aria-label="更多操作"
        aria-haspopup="menu"
        aria-expanded={!!menu}
      >
        {IC.dots}
      </button>
      {menu ? (
        <div
          className="pmenu-pop"
          ref={menuRef}
          style={{ left: menu.left, top: menu.top, width: MENU_W }}
          role="menu"
          onClick={(e) => e.stopPropagation()}
        >
          {items.map((item) => {
            if (item.submenu) {
              const open = sub?.key === item.label;
              return (
                <div
                  className="pmenu-subwrap"
                  key={item.label}
                  onMouseEnter={(e) => openSub(item, e.currentTarget)}
                  onMouseLeave={scheduleSubClose}
                >
                  <button
                    className="pmenu-item pmenu-parent"
                    role="menuitem"
                    aria-haspopup="menu"
                    aria-expanded={open}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (open) {
                        setSub(null);
                        return;
                      }
                      openSub(item, e.currentTarget.parentElement);
                    }}
                  >
                    <span className="ico">{item.icon}</span>
                    {item.label}
                    <span className="pmenu-chev">{IC.chev}</span>
                  </button>
                  {open ? (
                    <div
                      className="pmenu-pop pmenu-flyout"
                      role="menu"
                      style={{ left: sub.left, top: sub.top, width: SUB_W }}
                      onMouseEnter={() => clearTimeout(subTimer.current)}
                      onMouseLeave={scheduleSubClose}
                    >
                      {item.submenu.map((it) => (
                        <button
                          key={it.label}
                          className="pmenu-item"
                          role="menuitem"
                          onClick={(e) => {
                            e.stopPropagation();
                            closeAll();
                            it.run();
                          }}
                        >
                          {it.label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            }
            return (
              <Fragment key={item.label}>
                {item.sep ? <div className="pmenu-sep" /> : null}
                <button
                  className={
                    'pmenu-item' +
                    (item.tone ? ' pmenu-' + item.tone : '') +
                    (item.confirm && armed ? ' armed' : '')
                  }
                  role="menuitem"
                  title={
                    item.confirm
                      ? armed
                        ? '再点一次立即归档'
                        : '归档后可在侧栏「已归档」分组恢复；需求、命令与日志会保留'
                      : undefined
                  }
                  onClick={() => {
                    if (item.confirm && !armed) {
                      setArmed(true);
                      return;
                    }
                    closeAll();
                    item.run(project);
                  }}
                >
                  <span className="ico">{item.icon}</span>
                  {item.confirm && armed ? item.confirmLabel : item.label}
                </button>
              </Fragment>
            );
          })}
        </div>
      ) : null}
    </>
  );
}

import { Fragment, useEffect, useRef, useState } from 'react';
import { IC } from '../icons.jsx';

const MENU_W = 178;
const MENU_PAD = 8;
const ITEM_H = 30;
const GAP = 1;
const SEP_H = 7; // 分隔线占高：1px 线 + 上下各 3px 留白

/** 项目「更多操作」菜单：侧栏与总览共用，保证两边行为一致 */
export default function ProjectMenu({
  project,
  buttonClassName,
  onEdit,
  onOpenTerminal,
  onReveal,
  onArchive
}) {
  const [menu, setMenu] = useState(null); // { left, top }
  /** 归档项的就地两步确认：与设置弹窗的 DangerButton 同一口径，5 秒自动撤销 */
  const [armed, setArmed] = useState(false);
  const btnRef = useRef(null);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menu) return undefined;
    // 菜单一收起就复位确认态，下次打开仍是「归档项目」而不是「确认归档」
    const close = () => {
      setMenu(null);
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

  const items = [
    { label: '设置', icon: IC.gear, run: onEdit },
    { label: '在控制台中打开', icon: IC.term, tone: 'term', run: onOpenTerminal },
    { label: '在系统管理器中显示', icon: IC.folder, tone: 'folder', run: onReveal }
  ];
  // 归档与三项「打开类」操作性质不同：用分隔线隔开，并保留两步确认
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
          {items.map((item) => (
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
                  setMenu(null);
                  setArmed(false);
                  item.run(project);
                }}
              >
                <span className="ico">{item.icon}</span>
                {item.confirm && armed ? item.confirmLabel : item.label}
              </button>
            </Fragment>
          ))}
        </div>
      ) : null}
    </>
  );
}

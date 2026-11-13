import { useEffect, useRef, useState } from 'react';
import { IC } from '../icons.jsx';

const MENU_W = 178;
const MENU_PAD = 8;
const ITEM_H = 30;
const GAP = 1;

/** 项目「更多操作」菜单：侧栏与总览共用，保证两边行为一致 */
export default function ProjectMenu({
  project,
  buttonClassName,
  onEdit,
  onOpenTerminal,
  onReveal
}) {
  const [menu, setMenu] = useState(null); // { left, top }
  const btnRef = useRef(null);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menu) return undefined;
    const onDown = (e) => {
      if (btnRef.current?.contains(e.target)) return;
      if (menuRef.current?.contains(e.target)) return;
      setMenu(null);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setMenu(null);
    };
    const onMove = () => setMenu(null);
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
  }, [menu]);

  const items = [
    { label: '设置', icon: IC.gear, run: onEdit },
    { label: '在控制台中打开', icon: IC.term, tone: 'term', run: onOpenTerminal },
    { label: '在系统管理器中显示', icon: IC.folder, tone: 'folder', run: onReveal }
  ];

  /** 在触发按钮下方弹出菜单；靠近视口底部时上翻 */
  function toggleMenu(e) {
    e.stopPropagation();
    if (menu) {
      setMenu(null);
      return;
    }
    const r = e.currentTarget.getBoundingClientRect();
    const height = MENU_PAD * 2 + items.length * ITEM_H + (items.length - 1) * GAP;
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
            <button
              key={item.label}
              className={'pmenu-item' + (item.tone ? ' pmenu-' + item.tone : '')}
              role="menuitem"
              onClick={() => {
                setMenu(null);
                item.run(project);
              }}
            >
              <span className="ico">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
}

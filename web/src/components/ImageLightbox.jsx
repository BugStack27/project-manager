import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const MIN_SCALE = 0.1;
const MAX_SCALE = 10;
/** 滚轮每 100 像素约缩放 1.16 倍：精细缩放手感，一下滚到底也不会跳变 */
const WHEEL_RATE = 0.0015;
const ZOOM_STEP = 1.25;

function clampScale(n) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, n));
}

/**
 * 图片灯箱：按光标位置滚轮缩放、按住鼠标拖动平移。
 * 100% 是「适应窗口」的倍数——初始状态即完整看图，放大后再拖到要看的位置。
 * Esc / 点背景 / 关闭按钮退出；Esc 在捕获阶段拦下，避免同时触发「关右抽屉」。
 */
export default function ImageLightbox({ src, alt, title, caption, onClose }) {
  const [view, setView] = useState({ s: 1, x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const stageRef = useRef(null);
  const dragRef = useRef(null);
  const movedRef = useRef(false);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  // 滚轮缩放要阻止页面滚动，只能挂非 passive 的原生监听
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      // 光标相对舞台中心的位置；尺度以这里为不动点，缩小时不会把目标甩出视野
      const px = e.clientX - (rect.left + rect.width / 2);
      const py = e.clientY - (rect.top + rect.height / 2);
      const factor = Math.exp(-e.deltaY * WHEEL_RATE);
      setView((v) => {
        const s = clampScale(v.s * factor);
        const k = s / v.s;
        return { s, x: px - (px - v.x) * k, y: py - (py - v.y) * k };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const zoomAtCenter = (factor) => {
    setView((v) => {
      const s = clampScale(v.s * factor);
      const k = s / v.s;
      return { s, x: v.x * k, y: v.y * k };
    });
  };

  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { px: e.clientX, py: e.clientY, x: view.x, y: view.y };
    movedRef.current = false;
    setDragging(true);
  };

  const onPointerMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.px;
    const dy = e.clientY - d.py;
    if (Math.abs(dx) + Math.abs(dy) > 3) movedRef.current = true;
    setView((v) => ({ ...v, x: d.x + dx, y: d.y + dy }));
  };

  const endDrag = (e) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setDragging(false);
    if (e && e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  return createPortal(
    <div
      className={'imgview' + (dragging ? ' dragging' : '')}
      role="dialog"
      aria-modal="true"
      aria-label={alt || '图片预览'}
    >
      <div className="imgview-bar">
        <span className="imgview-name" title={title ? title + (caption ? ' · ' + caption : '') : alt}>
          {title || alt}
          {caption ? <span className="imgview-side"> · {caption}</span> : null}
        </span>
        <span className="imgview-hint">滚轮缩放 · 拖动查看</span>
        <span className="imgview-tools">
          <button type="button" className="btn sm" onClick={() => zoomAtCenter(1 / ZOOM_STEP)} title="缩小">
            −
          </button>
          <button
            type="button"
            className="btn sm imgview-pct"
            onClick={() => setView({ s: 1, x: 0, y: 0 })}
            title="恢复适应窗口"
          >
            {Math.round(view.s * 100)}%
          </button>
          <button type="button" className="btn sm" onClick={() => zoomAtCenter(ZOOM_STEP)} title="放大">
            +
          </button>
          <button type="button" className="btn sm" onClick={onClose} title="关闭（Esc）">
            关闭
          </button>
        </span>
      </div>
      <div
        className="imgview-stage"
        ref={stageRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClick={(e) => {
          if (!movedRef.current && e.target === stageRef.current) onClose();
        }}
      >
        <img
          className="imgview-img"
          src={src}
          alt={alt}
          draggable={false}
          style={{ transform: 'translate(' + view.x + 'px, ' + view.y + 'px) scale(' + view.s + ')' }}
        />
      </div>
    </div>,
    document.body
  );
}

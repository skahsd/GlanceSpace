import { useLayoutEffect, useRef } from 'react';
import type { FsNode } from './model.ts';

export interface MenuTarget { node: FsNode; scanId: number; x: number; y: number }
export default function ContextMenu({ target, onClose, onAction }: {
  target: MenuTarget; onClose: () => void; onAction: (action: 'open_with' | 'show_in_explorer', target: MenuTarget) => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = menu.current;
    if (element) {
      element.style.left = Math.max(4, Math.min(target.x, window.innerWidth - element.offsetWidth - 4)) + 'px';
      element.style.top = Math.max(4, Math.min(target.y, window.innerHeight - element.offsetHeight - 4)) + 'px';
    }
    menu.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const outside = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node)) onClose(); };
    window.addEventListener('pointerdown', outside);
    window.addEventListener('resize', onClose);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('pointerdown', outside); window.removeEventListener('resize', onClose); window.removeEventListener('blur', onClose);
      if (previous?.isConnected && (element?.contains(document.activeElement) || document.activeElement === document.body)) previous.focus();
    };
  }, [onClose, target]);
  return <div ref={menu} className="context-menu" role="menu" aria-label={`${target.node.name} 的操作`}
    style={{ left: target.x, top: target.y }}
    onContextMenu={e => e.preventDefault()} onKeyDown={e => {
      e.stopPropagation();
      const buttons = Array.from(menu.current?.querySelectorAll('button') ?? []);
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); onClose(); }
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
        e.preventDefault();
        const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }
    }}>
    {!target.node.isDir && <button role="menuitem" onClick={() => onAction('open_with', target)}>打开方式…</button>}
    <button role="menuitem" onClick={() => onAction('show_in_explorer', target)}>{target.node.isDir ? '在资源管理器中打开' : '在资源管理器中显示'}</button>
  </div>;
}

import { useEffect, useRef, useState } from 'react';
import { formatBytes, metricValue } from './model.ts';
import type { FsNode, Metric } from './model.ts';
import { hitTest, interpolateRects, layout } from './treemap.ts';
import type { Rect } from './treemap.ts';
import type { Translate } from './i18n.ts';

const colors = ['#367fa4', '#398b79', '#7762aa', '#a47a47', '#5578b4', '#9a5e79', '#4a9396'];
function color(node: FsNode): string {
  if (node.id < 0) return '#394655';
  let hash = 0;
  const key = node.isDir ? node.name : node.name.split('.').pop() ?? '';
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return colors[Math.abs(hash) % colors.length];
}

export default function Treemap({ items, branches, t, metric, fontSize, selected, onActivate, onSelect, onContext, onCollapse }: {
  items: FsNode[]; branches: Map<number, FsNode[]>; t: Translate; metric: Metric; fontSize: number; selected: number | undefined;
  onActivate: (rect: Rect) => void; onSelect: (node: FsNode) => void;
  onContext: (node: FsNode, x: number, y: number) => void; onCollapse: (ids: number[]) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const rects = useRef<Rect[]>([]);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const collapseRef = useRef(onCollapse);
  collapseRef.current = onCollapse;
  const drawRef = useRef<() => void>(() => {});
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [ratio, setRatio] = useState(() => window.devicePixelRatio || 1);
  useEffect(() => {
    const resolution = window.matchMedia('(resolution: ' + ratio + 'dppx)');
    const update = () => setRatio(window.devicePixelRatio || 1);
    resolution.addEventListener('change', update);
    return () => resolution.removeEventListener('change', update);
  }, [ratio]);
  const [hover, setHover] = useState<{ node: FsNode; x: number; y: number } | null>(null);
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => setReduced(media.matches);
    media.addEventListener('change', change);
    const observer = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      setSize({ width, height });
    });
    if (container.current) observer.observe(container.current);
    return () => { observer.disconnect(); media.removeEventListener('change', change); };
  }, []);
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    element.width = Math.round(size.width * ratio);
    element.height = Math.round(size.height * ratio);
    const ctx = element.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(element.width / (size.width || 1), 0, 0, element.height / (size.height || 1), 0, 0);
    const target = layout(items, size.width, size.height, metric, branches);
    if (size.width > 0 && size.height > 0) {
      const small = target.filter(r => branches.has(r.node.id) && (r.width < 160 || r.height < 100)).map(r => r.node.id);
      if (small.length) collapseRef.current(small);
    }
    const from = rects.current;
    setHover(null);
    function draw() {
      if (!ctx) return;
      ctx.clearRect(0, 0, size.width, size.height);
      ctx.textBaseline = 'top';
      for (const rect of rects.current) {
        const { node, x, y, width, height } = rect;
        if (width < 3 || height < 3) continue;
        ctx.save(); ctx.globalAlpha = rect.alpha ?? 1;
        ctx.beginPath(); ctx.rect(x, y, width, height); ctx.clip();
        ctx.fillStyle = rect.expanded ? '#24394b' : color(node);
        ctx.fillRect(x + 1, y + 1, Math.max(0, width - 2), Math.max(0, height - 2));
        if (node.unknown > 0 && !rect.expanded) {
          ctx.fillStyle = '#ffffff12';
          for (let stripe = y + 5; stripe < y + height; stripe += 12) ctx.fillRect(x + 2, stripe, Math.max(0, width - 4), 2);
        }
        if (node.id === selectedRef.current) {
          ctx.strokeStyle = '#c3f5de'; ctx.lineWidth = 3;
          ctx.strokeRect(x + 2, y + 2, Math.max(0, width - 4), Math.max(0, height - 4));
        }
        if (width > fontSize * 5 && height >= fontSize + (rect.expanded ? 6 : 14)) {
          ctx.beginPath(); ctx.rect(x + 6, y + 4, Math.max(0, width - 12), rect.expanded ? 20 : height - 8); ctx.clip();
          ctx.fillStyle = '#fff'; ctx.font = '500 ' + fontSize + 'px "Segoe UI", "Microsoft YaHei", sans-serif';
          ctx.fillText(`${rect.expanded ? '⊟ ' : node.isDir ? '▣ ' : ''}${node.id < 0 ? t('otherItems') : node.name}`, x + 8, y + (rect.expanded ? 5 : 9));
          if (height > 50 && !rect.expanded) {
            ctx.fillStyle = '#ffffffb8'; ctx.font = Math.max(12, fontSize - 1) + 'px "Segoe UI", sans-serif';
            ctx.fillText(`${node.unknown ? '≥ ' : ''}${formatBytes(metricValue(node, metric), t('unknown'))}`, x + 8, y + 30);
          }
        }
        ctx.restore();
      }
    }
    drawRef.current = draw;
    const started = performance.now();
    let frame = 0;
    function animate(now: number) {
      const t = reduced ? 1 : Math.min(1, (now - started) / 300);
      rects.current = interpolateRects(from, target, 1 - (1 - t) ** 3);
      draw();
      if (t < 1) frame = requestAnimationFrame(animate);
    }
    frame = requestAnimationFrame(animate);
    return () => { cancelAnimationFrame(frame); drawRef.current = () => {}; };
  }, [items, branches, size, ratio, metric, fontSize, reduced, t]);
  useEffect(() => { drawRef.current(); }, [selected]);
  const target = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return hitTest(rects.current, event.clientX - bounds.left, event.clientY - bounds.top);
  };
  return <div className="map-canvas" ref={container}>
    <canvas ref={canvas} style={{ width: size.width, height: size.height }} tabIndex={0} role="img"
      aria-label={t('mapA11y')}
      onMouseMove={event => {
        const found = target(event);
        const bounds = event.currentTarget.getBoundingClientRect();
        setHover(found ? { node: found.node, x: event.clientX - bounds.left, y: event.clientY - bounds.top } : null);
      }} onMouseLeave={() => setHover(null)}
      onClick={event => { if (event.detail > 1) return; const rect = target(event); if (rect && rect.node.id >= 0) onActivate(rect); }}
      onContextMenu={event => { event.preventDefault(); setHover(null); const rect = target(event); if (rect && rect.node.id >= 0) onContext(rect.node, event.clientX, event.clientY); }}
      onKeyDown={event => {
        const visible = rects.current.filter(r => r.node.id >= 0 && r.width >= 3 && r.height >= 3);
        const index = visible.findIndex(r => r.node.id === selectedRef.current);
        const current = visible[index >= 0 ? index : 0];
        if (!current) return;
        if (event.key === 'ContextMenu' || event.key === 'F10' && event.shiftKey) {
          event.preventDefault(); const bounds = event.currentTarget.getBoundingClientRect();
          onContext(current.node, bounds.left + current.x + 10, bounds.top + current.y + 20);
        } else if (event.key === 'Enter') { event.preventDefault(); onActivate(current); }
        else if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(event.key)) {
          event.preventDefault();
          const step = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
          const next = visible[(index + step + visible.length) % visible.length];
          onSelect(next.node); setHover({ node: next.node, x: next.x, y: next.y });
        }
      }} />
    {!items.some(n => metricValue(n, metric) > 0) && <div className="map-empty"><span>▦</span><strong>{t('mapEmpty')}</strong><p>{t('mapHint')}</p></div>}
    {hover && <div className="map-tooltip" style={{ left: Math.max(4, Math.min(hover.x + 14, size.width - 290)), top: Math.max(4, Math.min(hover.y + 14, size.height - 100)) }}>
      <strong>{hover.node.id < 0 ? t('otherItems') : hover.node.name}</strong><span>{hover.node.unknown ? `${t('knownPart')} ≥ ` : ''}{formatBytes(metricValue(hover.node, metric), t('unknown'))}</span><small>{hover.node.path}</small>
    </div>}
  </div>;
}

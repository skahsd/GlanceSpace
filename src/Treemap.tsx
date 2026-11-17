import { useEffect, useRef, useState } from 'react';
import { formatBytes, metricValue } from './model.ts';
import type { FsNode, Metric } from './model.ts';
import { hitTest, layout } from './treemap.ts';
import type { Rect } from './treemap.ts';

const colors = ['#367fa4', '#398b79', '#7762aa', '#a47a47', '#5578b4', '#9a5e79', '#4a9396'];
function color(node: FsNode): string {
  if (node.id < 0) return '#394655';
  let hash = 0;
  const key = node.isDir ? node.name : node.name.split('.').pop() ?? '';
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return colors[Math.abs(hash) % colors.length];
}

export default function Treemap({ items, metric, selected, onSelect, onOpen }: {
  items: FsNode[]; metric: Metric; selected: number | undefined;
  onSelect: (node: FsNode) => void; onOpen: (node: FsNode) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const rects = useRef<Rect[]>([]);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [hover, setHover] = useState<{ node: FsNode; x: number; y: number } | null>(null);
  useEffect(() => {
    const observer = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      setSize({ width, height });
    });
    if (container.current) observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const pixelRatio = window.devicePixelRatio || 1;
    element.width = Math.floor(size.width * pixelRatio);
    element.height = Math.floor(size.height * pixelRatio);
    const ctx = element.getContext('2d');
    if (!ctx) return;
    ctx.scale(pixelRatio, pixelRatio);
    ctx.clearRect(0, 0, size.width, size.height);
    rects.current = layout(items, size.width, size.height, metric);
    ctx.textBaseline = 'top';
    for (const rect of rects.current) {
      const { node, x, y, width, height } = rect;
      if (width < 3 || height < 3) continue;
      ctx.fillStyle = color(node);
      ctx.fillRect(x + 1, y + 1, Math.max(0, width - 2), Math.max(0, height - 2));
      if (node.unknown > 0) {
        ctx.fillStyle = '#ffffff12';
        for (let stripe = y + 5; stripe < y + height; stripe += 12) ctx.fillRect(x + 2, stripe, Math.max(0, width - 4), 2);
      }
      if (node.id === selected) {
        ctx.strokeStyle = '#c3f5de'; ctx.lineWidth = 3;
        ctx.strokeRect(x + 2, y + 2, Math.max(0, width - 4), Math.max(0, height - 4));
      }
      if (width > 68 && height > 29) {
        ctx.save(); ctx.beginPath(); ctx.rect(x + 8, y + 6, Math.max(0, width - 16), height - 12); ctx.clip();
        ctx.fillStyle = '#fff'; ctx.font = '500 12px "Segoe UI", "Microsoft YaHei", sans-serif';
        ctx.fillText(`${node.isDir ? '▣ ' : ''}${node.name}`, x + 10, y + 10);
        if (height > 50) { ctx.fillStyle = '#ffffffb8'; ctx.font = '11px "Segoe UI", sans-serif'; ctx.fillText(`${node.unknown ? '≥ ' : ''}${formatBytes(metricValue(node, metric))}`, x + 10, y + 30); }
        ctx.restore();
      }
    }
  }, [items, size, metric, selected]);
  const target = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return hitTest(rects.current, event.clientX - bounds.left, event.clientY - bounds.top);
  };
  return <div className="map-canvas" ref={container}>
    <canvas ref={canvas} style={{ width: size.width, height: size.height }} role="img" aria-label="磁盘空间矩形图。每块面积表示当前大小口径；也可使用下方列表键盘导航。"
      onMouseMove={event => {
        const found = target(event);
        const bounds = event.currentTarget.getBoundingClientRect();
        setHover(found ? { node: found.node, x: event.clientX - bounds.left, y: event.clientY - bounds.top } : null);
      }} onMouseLeave={() => setHover(null)}
      onClick={event => { const rect = target(event); if (rect && rect.node.id >= 0) onSelect(rect.node); }}
      onDoubleClick={event => { const rect = target(event); if (rect && rect.node.id >= 0) onOpen(rect.node); }} />
    {!rects.current.length && !items.some(n => metricValue(n, metric) > 0) && <div className="map-empty"><span>▦</span><strong>空间分布将在这里展开</strong><p>选择目录并开始扫描；零字节和未知大小条目可在列表中查看。</p></div>}
    {hover && <div className="map-tooltip" style={{ left: Math.max(4, Math.min(hover.x + 14, size.width - 290)), top: Math.max(4, Math.min(hover.y + 14, size.height - 100)) }}>
      <strong>{hover.node.name}</strong><span>{hover.node.unknown ? '已知部分 ≥ ' : ''}{formatBytes(metricValue(hover.node, metric))}</span><small>{hover.node.path}</small>
    </div>}
  </div>;
}

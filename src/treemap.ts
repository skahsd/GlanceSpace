import type { FsNode, Metric } from './model.ts';
import { metricValue } from './model.ts';
import { hierarchy, treemap, treemapSquarify } from 'd3-hierarchy';
export interface Rect { node: FsNode; x: number; y: number; width: number; height: number; depth: number; parentId?: number; expanded?: boolean; alpha?: number }
interface LayoutNode { node?: FsNode; children?: LayoutNode[] }
export function layout(items: FsNode[], width: number, height: number, metric: Metric, branches: Map<number, FsNode[]> = new Map()): Rect[] {
  if (!Number.isFinite(width * height) || width <= 0 || height <= 0) return [];
  const children = items.filter(n => metricValue(n, metric) > 0).map(node => ({ node }));
  if (!children.length) return [];
  const root = hierarchy<LayoutNode>({ children }).sum(d => d.node ? metricValue(d.node, metric) : 0)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0) || (a.data.node?.id ?? 0) - (b.data.node?.id ?? 0));
  const tree = treemap<LayoutNode>().tile(treemapSquarify).size([width, height]).round(false)(root);
  const rects: Rect[] = tree.leaves().filter(d => d.data.node && d.x1 > d.x0 && d.y1 > d.y0).map(d => ({
    node: d.data.node!, x: d.x0, y: d.y0, width: d.x1 - d.x0, height: d.y1 - d.y0, depth: d.depth,
  }));
  const result: Rect[] = [];
  for (const rect of rects) {
    const children = branches.get(rect.node.id);
    rect.expanded = Boolean(children?.length && rect.width >= 160 && rect.height >= 100);
    result.push(rect);
    if (rect.expanded && children) {
      for (const child of layout(children, rect.width - 8, rect.height - 28, metric, branches)) {
        result.push({ ...child, x: child.x + rect.x + 4, y: child.y + rect.y + 24,
          depth: child.depth + rect.depth, parentId: child.parentId ?? rect.node.id });
      }
    }
  }
  return result;
}

export function interpolateRects(from: Rect[], to: Rect[], progress: number): Rect[] {
  const old = new Map(from.map(r => [r.node.id, r]));
  const current = new Map<number, Rect>();
  const t = Math.max(0, Math.min(1, progress));
  return to.map(target => {
    const start = old.get(target.node.id);
    const rect = { ...target, alpha: start ? (start.alpha ?? 1) + (1 - (start.alpha ?? 1)) * t : t };
    for (const key of ['x', 'y', 'width', 'height'] as const) rect[key] = start ? start[key] + (target[key] - start[key]) * t : target[key];
    const parent = rect.parentId === undefined ? undefined : current.get(rect.parentId);
    if (parent) {
      rect.x = Math.max(parent.x + 4, Math.min(rect.x, parent.x + parent.width - 4));
      rect.y = Math.max(parent.y + 24, Math.min(rect.y, parent.y + parent.height - 4));
      rect.width = Math.max(0, Math.min(rect.width, parent.x + parent.width - 4 - rect.x));
      rect.height = Math.max(0, Math.min(rect.height, parent.y + parent.height - 4 - rect.y));
    }
    current.set(rect.node.id, rect);
    return rect;
  });
}
export function hitTest(rects: Rect[], x: number, y: number): Rect | undefined {
  for (let index = rects.length - 1; index >= 0; index--) {
    const r = rects[index];
    if (r.width < 3 || r.height < 3 || (r.alpha ?? 1) < .15) continue;
    if (x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height) return r;
  }
  return undefined;
}

import type { FsNode, Metric } from './model.ts';
import { metricValue } from './model.ts';
import { hierarchy, treemap, treemapSquarify } from 'd3-hierarchy';
export interface Rect { node: FsNode; x: number; y: number; width: number; height: number; depth: number }
interface LayoutNode { node?: FsNode; children?: LayoutNode[] }
export function layout(items: FsNode[], width: number, height: number, metric: Metric): Rect[] {
  if (!Number.isFinite(width * height) || width <= 0 || height <= 0) return [];
  const children = items.filter(n => metricValue(n, metric) > 0).map(node => ({ node }));
  if (!children.length) return [];
  const root = hierarchy<LayoutNode>({ children }).sum(d => d.node ? metricValue(d.node, metric) : 0)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0) || (a.data.node?.id ?? 0) - (b.data.node?.id ?? 0));
  const tree = treemap<LayoutNode>().tile(treemapSquarify).size([width, height]).round(false)(root);
  return tree.leaves().filter(d => d.data.node && d.x1 > d.x0 && d.y1 > d.y0).map(d => ({
    node: d.data.node!, x: d.x0, y: d.y0, width: d.x1 - d.x0, height: d.y1 - d.y0, depth: d.depth,
  }));
}
export function hitTest(rects: Rect[], x: number, y: number): Rect | undefined {
  for (let index = rects.length - 1; index >= 0; index--) {
    const r = rects[index];
    if (x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height) return r;
  }
  return undefined;
}

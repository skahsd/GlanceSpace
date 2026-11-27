export type Metric = 'disk' | 'logical';
export interface FsNode {
  id: number; parent: number | null; name: string; path: string; isDir: boolean;
  logicalSize: number; diskSize: number; unknown: number; errors: number; skipped: number;
  modified: number | null; state: string; message: string | null; complete: boolean; childCount: number;
}
export interface Progress {
  phase: string; files: number; directories: number; logicalSize: number; diskSize: number;
  errors: number; skipped: number; unknown: number; revision: number; elapsedMs: number; message: string | null;
}
export interface Page { directory: FsNode; breadcrumbs: FsNode[]; items: FsNode[]; total: number; revision: number }
export interface TreeBranch { directory: FsNode; items: FsNode[]; truncated: boolean; omittedLogicalSize: number; omittedDiskSize: number }
export interface TreeView extends TreeBranch { revision: number; branches: TreeBranch[] }
export type MapMode = 'expand' | 'navigate';

export function branchItems(branch: TreeBranch): FsNode[] {
  return branch.truncated ? [...branch.items, { ...branch.directory, id: -branch.directory.id - 1,
    parent: branch.directory.id, name: '其他项目（在列表查看）', isDir: false,
    logicalSize: branch.omittedLogicalSize, diskSize: branch.omittedDiskSize, childCount: 0 }] : branch.items;
}

export function collapseExpanded(expanded: number[], id: number, nodes: FsNode[]): number[] {
  const parents = new Map(nodes.map(n => [n.id, n.parent]));
  return expanded.filter(entry => {
    let current: number | null | undefined = entry;
    const seen = new Set<number>();
    while (current !== null && current !== undefined && !seen.has(current)) {
      if (current === id) return false;
      seen.add(current); current = parents.get(current);
    }
    return true;
  });
}
export interface History { ids: number[]; index: number }
export const emptyProgress: Progress = { phase: 'idle', files: 0, directories: 0, logicalSize: 0, diskSize: 0, errors: 0, skipped: 0, unknown: 0, revision: 0, elapsedMs: 0, message: null };
export function formatBytes(value: number | null, unknown = '未知'): string {
  if (value === null || !Number.isFinite(value) || value < 0) return unknown;
  if (value === 0) return '0 B';
  const unit = Math.min(Math.floor(Math.log(value) / Math.log(1024)), 5);
  return `${Number((value / 1024 ** unit).toFixed(1))} ${['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'][unit]}`;
}
export function navigate(history: History, id: number): History {
  if (history.ids[history.index] === id) return history;
  return { ids: [...history.ids.slice(0, history.index + 1), id], index: history.index + 1 };
}
export function metricValue(node: FsNode, metric: Metric): number { return metric === 'disk' ? node.diskSize : node.logicalSize; }

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
export interface TreeView { items: FsNode[]; truncated: boolean; omittedLogicalSize: number; omittedDiskSize: number }
export interface History { ids: number[]; index: number }
export const emptyProgress: Progress = { phase: 'idle', files: 0, directories: 0, logicalSize: 0, diskSize: 0, errors: 0, skipped: 0, unknown: 0, revision: 0, elapsedMs: 0, message: null };
export function formatBytes(value: number | null): string {
  if (value === null || !Number.isFinite(value) || value < 0) return '未知';
  if (value === 0) return '0 B';
  const unit = Math.min(Math.floor(Math.log(value) / Math.log(1024)), 5);
  return `${Number((value / 1024 ** unit).toFixed(1))} ${['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'][unit]}`;
}
export function navigate(history: History, id: number): History {
  if (history.ids[history.index] === id) return history;
  return { ids: [...history.ids.slice(0, history.index + 1), id], index: history.index + 1 };
}
export function metricValue(node: FsNode, metric: Metric): number { return metric === 'disk' ? node.diskSize : node.logicalSize; }

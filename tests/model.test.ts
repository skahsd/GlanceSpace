import assert from 'node:assert/strict';
import { test } from 'node:test';
import { branchItems, collapseExpanded, formatBytes, navigate } from '../src/model.ts';
import type { FsNode } from '../src/model.ts';

test('sizes distinguish unknown from empty and use binary units', () => {
  assert.equal(formatBytes(null), '未知');
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(1536), '1.5 KiB');
  assert.equal(formatBytes(1024 ** 3), '1 GiB');
});
test('a new drilldown after back replaces forward history', () => {
  assert.deepEqual(navigate({ ids: [0, 4, 8], index: 1 }, 12), { ids: [0, 4, 12], index: 2 });
  assert.deepEqual(navigate({ ids: [0, 4], index: 1 }, 4), { ids: [0, 4], index: 1 });
});

test('collapsing a branch removes its descendants but preserves other branches', () => {
  const nodes = [{ id: 1, parent: 0 }, { id: 2, parent: 1 }, { id: 3, parent: 2 }, { id: 4, parent: 0 }] as FsNode[];
  assert.deepEqual(collapseExpanded([1, 2, 3, 4], 1, nodes), [4]);
  assert.deepEqual(collapseExpanded([1, 2, 3, 4], 2, nodes), [1, 4]);
});

test('each truncated directory has a distinct summary retaining its omitted size', () => {
  const a = branchItems({ directory: { id: 1 } as FsNode, items: [], truncated: true, omittedDiskSize: 20, omittedLogicalSize: 10 })[0];
  const b = branchItems({ directory: { id: 2 } as FsNode, items: [], truncated: true, omittedDiskSize: 30, omittedLogicalSize: 15 })[0];
  assert.notEqual(a.id, b.id);
  assert.equal(a.diskSize, 20); assert.equal(a.logicalSize, 10);
  assert.ok(a.id < 0 && b.id < 0);
});

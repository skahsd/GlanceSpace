import assert from 'node:assert/strict';
import { test } from 'node:test';
import { layout, hitTest } from '../src/treemap.ts';
import type { FsNode } from '../src/model.ts';

function node(id: number, size: number): FsNode {
  return { id, parent: 0, name: `file-${id}`, path: `D:\\file-${id}`, isDir: false,
    logicalSize: size, diskSize: size, unknown: 0, errors: 0, skipped: 0,
    modified: null, state: 'ok', message: null, complete: true, childCount: 0 };
}
test('rectangles preserve a 3:1 area ratio without overlapping', () => {
  const rects = layout([node(1, 3), node(2, 1)], 400, 200, 'disk');
  assert.equal(rects.length, 2);
  const a = rects.find(r => r.node.id === 1)!;
  const b = rects.find(r => r.node.id === 2)!;
  assert.ok(Math.abs(a.width * a.height / (b.width * b.height) - 3) < 0.001);
  for (const r of rects) {
    assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.width <= 400 && r.y + r.height <= 200);
  }
  const overlap = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
    * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  assert.equal(overlap, 0);
  assert.equal(hitTest(rects, a.x + a.width / 2, a.y + a.height / 2)?.node.id, 1);
  assert.equal(hitTest(rects, 401, 201), undefined);
});
test('zero and unknown nodes do not claim fictitious area', () => {
  const unknown = { ...node(2, 0), unknown: 1, complete: false };
  assert.deepEqual(layout([node(1, 0), unknown], 200, 100, 'disk'), []);
  assert.equal(layout([node(3, 20), unknown], 200, 100, 'disk').length, 1);
  assert.deepEqual(layout([node(3, 20)], 0, 100, 'logical'), []);
  assert.deepEqual(layout([node(3, 20)], 100, Number.NaN, 'logical'), []);
});
test('thin viewports keep finite coordinates and hit-test excludes outer edges', () => {
  const rects = layout([node(1, 1), node(2, 1)], 1, 1000, 'logical');
  assert.ok(rects.length > 0);
  for (const rect of rects) assert.ok(Number.isFinite(rect.width * rect.height));
  assert.equal(hitTest(rects, 1, 500), undefined);
});

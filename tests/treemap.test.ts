import assert from 'node:assert/strict';
import { test } from 'node:test';
import { layout, hitTest, interpolateRects } from '../src/treemap.ts';
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

test('expanded directories retain their area and contain children below their header', () => {
  const folder = { ...node(1, 6), isDir: true };
  const children = new Map([[1, [node(3, 4), node(4, 2)]]]);
  const rects = layout([folder, node(2, 2)], 800, 400, 'logical', children);
  const parent = rects.find(r => r.node.id === 1)!;
  const sibling = rects.find(r => r.node.id === 2)!;
  assert.ok(Math.abs(parent.width * parent.height / (sibling.width * sibling.height) - 3) < 0.001);
  const child = rects.find(r => r.node.id === 3);
  assert.ok(child, 'expanded child must be rendered');
  assert.ok(child.x >= parent.x && child.y >= parent.y + 24);
  assert.ok(child.x + child.width <= parent.x + parent.width);
  assert.ok(child.y + child.height <= parent.y + parent.height);
  assert.equal(hitTest(rects, child.x + child.width / 2, child.y + child.height / 2)?.node.id, 3);
  assert.equal(hitTest(rects, parent.x + 10, parent.y + 10)?.node.id, 1);
});

test('small directories remain leaves even when children are available', () => {
  const folder = { ...node(1, 1), isDir: true };
  assert.equal(layout([folder], 159, 99, 'disk', new Map([[1, [node(3, 1)]]])).length, 1);
});

test('animation continues from the painted frame and clips children inside moving parents', () => {
  const folder = { ...node(1, 6), isDir: true };
  const initial = layout([folder, node(2, 2)], 800, 400, 'logical', new Map([[1, [node(3, 6)]]]));
  const target = layout([{ ...folder, logicalSize: 2 }, node(2, 6)], 800, 400, 'logical', new Map([[1, [node(3, 2)]]]));
  const mid = interpolateRects(initial, target, .5);
  const parent = mid.find(r => r.node.id === 1)!;
  const child = mid.find(r => r.node.id === 3)!;
  assert.ok(child.x >= parent.x && child.y >= parent.y + 24);
  assert.ok(child.x + child.width <= parent.x + parent.width);
  assert.ok(child.y + child.height <= parent.y + parent.height);
  assert.equal(hitTest(mid, child.x + child.width / 2, child.y + child.height / 2)?.node.id, 3);
  const continued = interpolateRects(mid, initial, 0);
  assert.equal(continued[0].width, mid[0].width);
  const newItem = interpolateRects([], target, .25)[0];
  assert.equal(newItem.alpha, .25);
  assert.deepEqual(interpolateRects(initial, target, 1).map(r => r.width), target.map(r => r.width));
});

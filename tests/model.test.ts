import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatBytes, navigate } from '../src/model.ts';

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

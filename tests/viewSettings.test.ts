import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultView, readView, toggleModule } from '../src/viewSettings.ts';

test('standard font, light theme and Chinese are the defaults', () => {
  assert.equal(defaultView.font, 14);
  assert.equal(readView(null).theme, 'light');
  assert.equal(readView('{}').theme, 'light');
  assert.equal(readView('{}').language, 'zh-CN');
  assert.equal(readView('{"language":"unexpected"}').language, 'zh-CN');
});

test('saved language, theme, font size and module choices restore together', () => {
  const value = { ...toggleModule(defaultView, 'details'), font: 13, theme: 'dark' as const, language: 'en' as const };
  assert.deepEqual(readView(JSON.stringify(value)), value);
  assert.deepEqual(readView('{'), defaultView);
});

test('saved sizes from the previous menu map to the remaining sizes', () => {
  for (const [previous, current] of [[14, 14], [15, 14], [16, 16], [17, 16]]) {
    assert.equal(readView(JSON.stringify({ font: previous })).font, current);
  }
});

test('the matrix stays visible while list and details remain configurable', () => {
  assert.deepEqual(toggleModule(defaultView, 'map'), defaultView);
  const withoutList = toggleModule(defaultView, 'list');
  assert.deepEqual(withoutList.modules, { map: true, list: false, details: true });
  assert.deepEqual(toggleModule(withoutList, 'details').modules, { map: true, list: false, details: false });
  assert.deepEqual(readView('{"font":99,"modules":{"map":false,"list":false}}').modules, { map: true, list: false, details: true });
  assert.equal(readView('{"theme":"neon"}').theme, 'light');
});

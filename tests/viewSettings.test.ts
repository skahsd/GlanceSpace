import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultView, readView, toggleModule } from '../src/viewSettings.ts';

test('standard font, dark theme and Chinese are the defaults', () => {
  assert.equal(defaultView.font, 15);
  assert.equal(defaultView.theme, 'dark');
  assert.equal(readView('{}').language, 'zh-CN');
  assert.equal(readView('{"language":"unexpected"}').language, 'zh-CN');
});

test('saved language, theme, font size and module choices restore together', () => {
  const value = { ...toggleModule(defaultView, 'details'), font: 17, theme: 'light' as const, language: 'en' as const };
  assert.deepEqual(readView(JSON.stringify(value)), value);
  assert.deepEqual(readView('{'), defaultView);
});

test('the matrix stays visible while list and details remain configurable', () => {
  assert.deepEqual(toggleModule(defaultView, 'map'), defaultView);
  const withoutList = toggleModule(defaultView, 'list');
  assert.deepEqual(withoutList.modules, { map: true, list: false, details: true });
  assert.deepEqual(toggleModule(withoutList, 'details').modules, { map: true, list: false, details: false });
  assert.deepEqual(readView('{"font":99,"modules":{"map":false,"list":false}}').modules, { map: true, list: false, details: true });
  assert.equal(readView('{"theme":"neon"}').theme, 'dark');
});

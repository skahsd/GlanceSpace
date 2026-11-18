import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultView, readView, toggleModule } from '../src/viewSettings.ts';

test('saved module choices and valid size restore even after reload', () => {
  const value = { ...toggleModule(defaultView, 'details'), font: 17 };
  assert.deepEqual(readView(JSON.stringify(value)), value);
  assert.deepEqual(readView('{'), defaultView);
});

test('at least one disk browser stays visible after a toggle or invalid stored config', () => {
  const withoutMap = toggleModule(defaultView, 'map');
  assert.equal(toggleModule(withoutMap, 'list'), withoutMap);
  assert.deepEqual(readView('{"font":99,"modules":{"map":false,"list":false}}').modules, { ...defaultView.modules, list: false });
});

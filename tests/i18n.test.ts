import assert from 'node:assert/strict';
import test from 'node:test';
import { localizeDiagnostic, translator } from '../src/i18n.ts';

test('changing the interface language keeps real paths and replaces only message placeholders', () => {
  const path = 'D:\\项目\\{count}.zip';
  const english = translator('en');
  const chinese = translator('zh-CN');
  assert.equal(english('copyPath', { path }), `${path} (click to copy)`);
  assert.equal(chinese('copyPath', { path }), `${path}（点击复制）`);
  assert.equal(english('unknownDisk', { count: 120 }), 'Unknown size on disk for 120 entries');
});

test('Windows diagnostics can change languages without losing raw details', () => {
  const message = '打开方式调用失败：0x80004005；已在资源管理器中定位';
  assert.equal(localizeDiagnostic(message, 'en'), 'Open with failed: 0x80004005 · Located the item in File Explorer');
  assert.equal(localizeDiagnostic(message, 'zh-CN'), message);
  assert.equal(localizeDiagnostic('无法访问：拒绝访问。 (os error 5)', 'en'), 'Access failed: 拒绝访问。 (os error 5)');
  assert.equal(localizeDiagnostic('Raw details；value', 'en'), 'Raw details；value');
});

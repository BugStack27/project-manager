import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_BINDINGS,
  acceleratorOf,
  bindingOf,
  eventKey,
  isPunctuationKey,
  matchBinding,
  normKey
} from './shortcuts.js';

/** 造一个 keydown 事件对象：只带匹配逻辑用到的字段 */
function ev(props) {
  return { ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, isComposing: false, key: '', code: '', ...props };
}

test('默认 Ctrl+, 命中普通逗号', () => {
  assert.equal(matchBinding(ev({ key: ',', code: 'Comma', ctrlKey: true }), DEFAULT_BINDINGS.projectSettings), true);
});

test('输入法把主键报成 Process 时按物理键位命中', () => {
  const e = ev({ key: 'Process', code: 'Comma', ctrlKey: true });
  assert.equal(eventKey(e), ',');
  assert.equal(matchBinding(e, DEFAULT_BINDINGS.projectSettings), true);
});

test('全角逗号折回半角后命中', () => {
  assert.equal(normKey('，'), ',');
  assert.equal(matchBinding(ev({ key: '，', code: 'Comma', ctrlKey: true }), DEFAULT_BINDINGS.projectSettings), true);
});

test('修饰键状态不一致不命中', () => {
  assert.equal(matchBinding(ev({ key: ',', code: 'Comma', ctrlKey: true, shiftKey: true }), DEFAULT_BINDINGS.projectSettings), false);
  assert.equal(matchBinding(ev({ key: ',', code: 'Comma' }), DEFAULT_BINDINGS.projectSettings), false);
});

test('字母键仍按 e.key 比较，不被物理键位兜底带偏', () => {
  assert.equal(matchBinding(ev({ key: 'k', code: 'KeyK', ctrlKey: true }), DEFAULT_BINDINGS.search), true);
  assert.equal(matchBinding(ev({ key: 'т', code: 'KeyK', ctrlKey: true }), DEFAULT_BINDINGS.search), false);
});

test('录制时占位主键按物理键位还原', () => {
  assert.deepEqual(bindingOf(ev({ key: 'Process', code: 'Comma', ctrlKey: true })), { mod: true, alt: false, shift: false, key: ',' });
});

test('只有单个标点主键才需要主进程热键兜底', () => {
  assert.equal(isPunctuationKey(','), true);
  assert.equal(isPunctuationKey('/'), true);
  assert.equal(isPunctuationKey('k'), false);
  assert.equal(isPunctuationKey('1'), false);
  assert.equal(isPunctuationKey('ArrowLeft'), false);
  assert.equal(isPunctuationKey(''), false);
});

test('绑定转 Electron accelerator', () => {
  assert.equal(acceleratorOf({ mod: true, alt: false, shift: false, key: ',' }), 'CommandOrControl+,');
  assert.equal(acceleratorOf({ mod: false, alt: true, shift: false, key: 'ArrowLeft' }), 'Alt+ArrowLeft');
  assert.equal(acceleratorOf({ mod: true, alt: false, shift: true, key: '/' }), 'CommandOrControl+Shift+/');
  assert.equal(acceleratorOf(null), '');
});
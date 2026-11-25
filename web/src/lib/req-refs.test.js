import test from 'node:test';
import assert from 'node:assert/strict';
import { fileRefInvalid } from './req-refs.js';

test('文件引用失效：三种原因各给一句人话', () => {
  const miss = fileRefInvalid({ exists: false, reason: 'not_found' });
  assert.equal(miss.tag, '不存在');
  assert.match(miss.tip, /可能已改名或删除/);
  assert.match(miss.tip, /@/);

  const bad = fileRefInvalid({ exists: false, reason: 'bad_path' });
  assert.equal(bad.tag, '路径不合法');

  const noRoot = fileRefInvalid({ exists: false, reason: 'path_missing' });
  assert.equal(noRoot.tag, '无项目目录');
});

test('文件引用失效：缺省 reason 按「可能已改名或删除」处理', () => {
  assert.deepEqual(fileRefInvalid(null), fileRefInvalid({ exists: false }));
  assert.equal(fileRefInvalid({ exists: false }).tag, '不存在');
});

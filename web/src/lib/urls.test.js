import test from 'node:test';
import assert from 'node:assert/strict';
import { findUrls } from './urls.js';

const urls = (text) => findUrls(text).map((u) => u.url);

test('识别本地与网络地址，保留端口、路径、查询和锚点', () => {
  const line =
    '  ➜  Local:   http://localhost:5173/\n  ➜  Network: http://192.168.1.5:5173/app?a=1&b=2#top';
  assert.deepEqual(urls(line), [
    'http://localhost:5173/',
    'http://192.168.1.5:5173/app?a=1&b=2#top'
  ]);
  for (const u of findUrls(line)) {
    assert.equal(line.slice(u.at, u.at + u.len), u.url);
  }
});

test('裁掉地址末尾的句读与不成对的括号', () => {
  assert.deepEqual(urls('见 http://localhost:3000，或 (https://example.com/x).'), [
    'http://localhost:3000',
    'https://example.com/x'
  ]);
  assert.deepEqual(urls('维基 https://example.com/wiki/Foo_(bar) 很好'), [
    'https://example.com/wiki/Foo_(bar)'
  ]);
});

test('只认 http/https，裸协议不算', () => {
  assert.deepEqual(urls('ftp://example.com file:///c:/x smb://host http:// https://'), []);
});

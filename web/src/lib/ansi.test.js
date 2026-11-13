import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAnsi } from './ansi.js';

test('基础 16 色与重置', () => {
  const r = parseAnsi('\x1b[31mred\x1b[0m plain');
  assert.equal(r.text, 'red plain');
  assert.equal(r.segments[0].text, 'red');
  assert.equal(r.segments[0].fg, 'var(--ansi-fg-red)');
  assert.equal(r.segments[1].fg, null);
});

test('256 色、真彩色与冒号写法', () => {
  assert.equal(parseAnsi('\x1b[38;5;196mx').segments[0].fg, 'rgb(255,0,0)');
  assert.equal(parseAnsi('\x1b[38;2;1;2;3mx').segments[0].fg, 'rgb(1,2,3)');
  assert.equal(parseAnsi('\x1b[38:2::255:0:0mx').segments[0].fg, 'rgb(255,0,0)');
  assert.equal(parseAnsi('\x1b[38:2:0:255:0:0mx').segments[0].fg, 'rgb(255,0,0)');
  assert.equal(parseAnsi('\x1b[48;5;232mx').segments[0].bg, 'rgb(8,8,8)');
});

test('样式属性与反色', () => {
  const s = parseAnsi('\x1b[1;4;7mx').segments[0];
  assert.equal(s.bold, true);
  assert.equal(s.underline, true);
  assert.equal(s.fg, 'var(--ansi-default-bg)');
  assert.equal(s.bg, 'var(--ansi-default-fg)');
});

test('非 SGR 序列与控制字符被剥离', () => {
  const r = parseAnsi('\x1b[2K\x1b]0;title\x07ok\r');
  assert.equal(r.text, 'ok');
  assert.equal(r.segments.length, 1);
  assert.equal(parseAnsi('\x1bP1;2|payload\x1b\\ok').text, 'ok');
  assert.equal(parseAnsi('\x1b[999mok').text, 'ok');
  assert.equal(parseAnsi('\x1b[38;5mok').text, 'ok');
  assert.equal(parseAnsi('\x1b[38;5mok').segments[0].fg, null);
  assert.equal(parseAnsi('\x1b[38;2mok').segments[0].fg, null);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { langOf, highlightLines } from './hlighter.js';

test('启动台能挑到的脚本后缀都有语言映射', () => {
  const cases = {
    'a.sh': 'bash',
    'a.bash': 'bash',
    'a.zsh': 'bash',
    'a.fish': 'bash',
    'a.bat': 'dos',
    'a.cmd': 'dos',
    'a.ps1': 'powershell',
    'a.psm1': 'powershell',
    'a.py': 'python',
    'a.js': 'javascript',
    'a.mjs': 'javascript',
    'a.rb': 'ruby',
    'a.pl': 'perl',
    'a.php': 'php',
    'a.lua': 'lua'
  };
  for (const [p, lang] of Object.entries(cases)) assert.equal(langOf(p), lang, p);
});

test('认不出扩展名时按 shebang 上色', async () => {
  const rows = await highlightLines('#!/usr/bin/env bash\necho "hi"', 'deploy');
  assert.ok(Array.isArray(rows));
  assert.match(rows.join(''), /hljs-/);
});

test('powershell / batch 脚本出着色片段', async () => {
  const ps = await highlightLines('Write-Host "hello"', 'tools/deploy.ps1');
  assert.match(ps.join(''), /hljs-/);
  const bat = await highlightLines('@echo off\necho hello', 'tools/build.cmd');
  assert.match(bat.join(''), /hljs-/);
});

test('完全认不出语言时保持纯文本', async () => {
  assert.equal(await highlightLines('just some notes', 'notes.log'), null);
});

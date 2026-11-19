import test from 'node:test';
import assert from 'node:assert/strict';
import { scriptRef } from './script-ref.js';

const win = { path: 'D:\\workspace\\aurora\\studio' };
const winCmd = (text, cwd) => scriptRef({ text, cwd: cwd === undefined ? win.path : cwd }, win, 'win32');

const posix = { path: '/home/u/aurora' };
const posixCmd = (text, cwd) => scriptRef({ text, cwd: cwd === undefined ? posix.path : cwd }, posix, 'linux');

test('段首就是脚本文件', () => {
  assert.equal(winCmd('./deploy.ps1'), 'deploy.ps1');
  assert.equal(winCmd('start.bat -wait'), 'start.bat');
  assert.equal(posixCmd('./scripts/seed.sh --fast'), 'scripts/seed.sh');
});

test('解释器后面的脚本，跳过解释器参数', () => {
  assert.equal(winCmd('node scripts/seed.js --reset'), 'scripts/seed.js');
  assert.equal(
    winCmd('powershell -NoProfile -ExecutionPolicy Bypass -File "tools\\release.ps1"'),
    'tools/release.ps1'
  );
  assert.equal(posixCmd('bash -eu scripts/build.sh'), 'scripts/build.sh');
  assert.equal(winCmd('cmd /c tools\\clean.cmd'), 'tools/clean.cmd');
});

test('按工作目录解析相对路径', () => {
  assert.equal(winCmd('./run.sh', 'D:\\workspace\\aurora\\studio\\scripts'), 'scripts/run.sh');
  assert.equal(winCmd('node ..\\tools\\x.js', 'D:\\workspace\\aurora\\studio\\web'), 'tools/x.js');
});

test('cd 影响后续段的相对路径', () => {
  assert.equal(winCmd('cd scripts && ./build.sh'), 'scripts/build.sh');
  assert.equal(posixCmd('cd web; node tools/gen.js'), 'web/tools/gen.js');
});

test('参数里的脚本名不算引用', () => {
  assert.equal(winCmd('curl -o install.sh https://example.com/install.sh'), null);
  assert.equal(posixCmd('echo notes.md > log.txt'), null);
  assert.equal(winCmd('node -e "console.log(1)"'), null);
});

test('不是脚本的命令不弹卡', () => {
  assert.equal(winCmd('pnpm build'), null);
  assert.equal(winCmd('pnpm dev'), null);
  assert.equal(winCmd('go run ./cmd/gateway -config ./config/dev.yaml'), null);
  assert.equal(winCmd('./gradlew :app:assembleDebug'), null);
  assert.equal(winCmd(''), null);
});

test('项目根外的脚本不弹卡', () => {
  assert.equal(winCmd('D:\\workspace\\other\\deploy.ps1'), null);
  assert.equal(winCmd('cd .. && ./deploy.ps1'), null);
  assert.equal(posixCmd('/opt/scripts/x.sh'), null);
  assert.equal(scriptRef({ text: './x.sh', cwd: win.path }, null, 'win32'), null);
});

test('Windows 盘符与大小写不敏感', () => {
  assert.equal(scriptRef({ text: 'C:\\Work\\APP\\run.bat', cwd: 'c:\\work\\app' }, { path: 'C:\\Work\\App' }, 'win32'), 'run.bat');
});

test('裸文件名按工作目录解析，不再向上找', () => {
  assert.equal(winCmd('deploy.sh'), 'deploy.sh');
  assert.equal(winCmd('工具.bat'), '工具.bat');
});

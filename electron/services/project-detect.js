'use strict';

/**
 * 项目类型识别与启动命令推荐。
 * 类型与启动命令只认项目根目录的特征文件（package.json / pom.xml / build.gradle …）；
 * 技术栈在根目录一个都认不出时，兜底看一级子目录（构建文件在一级模块的多模块仓库）。
 * 不读子目录里的文件内容、不执行任何命令，识别不出来就返回空结果，不影响手动添加。
 */

const fs = require('fs');
const path = require('path');
const { findAndroidModule } = require('./android-icon');

/** 单个特征文件最多读头部这么多字节：只用来判断关键字与取脚本名，不整份载入 */
const HEAD_BYTES = 64 * 1024;

/** 一次最多给这么多条推荐，多了表单撑爆，反而不好挑 */
const MAX_SUGGESTIONS = 12;

const WIN = process.platform === 'win32';

function isFile(dir, name) {
  try {
    return fs.statSync(path.join(dir, name)).isFile();
  } catch (_) {
    return false;
  }
}

function isDir(dir, name) {
  try {
    return fs.statSync(path.join(dir, name)).isDirectory();
  } catch (_) {
    return false;
  }
}

function readHead(dir, name) {
  try {
    const fd = fs.openSync(path.join(dir, name), 'r');
    try {
      const buf = Buffer.alloc(HEAD_BYTES);
      const n = fs.readSync(fd, buf, 0, HEAD_BYTES, 0);
      return buf.slice(0, n).toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  } catch (_) {
    return '';
  }
}

function readJson(dir, name) {
  const text = readHead(dir, name);
  if (!text) return null;
  try {
    const data = JSON.parse(text);
    return data && typeof data === 'object' ? data : null;
  } catch (_) {
    return null;
  }
}

/** 目录里匹配后缀的第一个文件名（.csproj 这类没法写死名字） */
function firstWithExt(dir, ext) {
  try {
    const name = fs.readdirSync(dir).find((n) => n.toLowerCase().endsWith(ext));
    return name || null;
  } catch (_) {
    return null;
  }
}

/** 兜底扫子目录时跳过：依赖、产物、虚拟环境目录，扫了只会把别人的技术栈算进来 */
const SUBDIR_SKIP = new Set([
  'node_modules',
  'dist',
  'build',
  'out',
  'target',
  'bin',
  'obj',
  'vendor',
  'coverage',
  'venv',
  '__pycache__'
]);

/** 兜底扫描最多看这么多一级子目录：大仓里每个包都数一遍既慢也没有展示价值 */
const MAX_SUBDIRS = 30;

const COMPOSE_FILES = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'];

function hasPython(dir) {
  return (
    isFile(dir, 'manage.py') ||
    isFile(dir, 'pyproject.toml') ||
    isFile(dir, 'requirements.txt') ||
    (isFile(dir, 'main.py') && isFile(dir, 'app.py'))
  );
}

/** 构建 / 包管理 / 运行环境类技术栈：看特征文件是否存在，不读内容 */
function buildStackIds(dir) {
  const ids = [];
  if (isFile(dir, 'package.json')) ids.push('npm');
  if (isFile(dir, 'pom.xml')) ids.push('maven');
  if (isFile(dir, 'build.gradle') || isFile(dir, 'build.gradle.kts')) ids.push('gradle');
  if (isFile(dir, 'Cargo.toml')) ids.push('rust');
  if (isFile(dir, 'go.mod')) ids.push('go');
  if (hasPython(dir)) ids.push('python');
  if (COMPOSE_FILES.some((n) => isFile(dir, n))) ids.push('docker');
  return ids;
}

/** 源码目录能看出的语言：与根目录同一套结构，子目录按一级模块算 */
function languageIdsIn(dir) {
  const ids = [];
  if (isDir(dir, 'src/main/java') || isDir(dir, 'app/src/main/java')) ids.push('java');
  if (isDir(dir, 'src/main/kotlin') || isDir(dir, 'app/src/main/kotlin')) ids.push('kotlin');
  return ids;
}

/** 一级子目录候选：跳过隐藏目录与依赖 / 产物目录，按名字排序取前 MAX_SUBDIRS 个 */
function candidateSubdirs(dir) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !SUBDIR_SKIP.has(e.name))
    .map((e) => ({ name: e.name, dir: path.join(dir, e.name) }))
    .sort((a, b) => (a.name < b.name ? -1 : 1))
    .slice(0, MAX_SUBDIRS);
}

/** 一级子目录的新增 / 删除 / 改名会改目录 mtime：兜底结果只在这些时候需要重算 */
function subdirSig(dir) {
  return (
    'sub:' +
    candidateSubdirs(dir)
      .map((s) => s.name + ':' + fileSig(s.dir))
      .join('|')
  );
}

/** 根目录一个技术栈都认不出时，才往一级子目录找；只看到这一层 */
function subdirStacks(dir) {
  const stacks = [];
  for (const sub of candidateSubdirs(dir)) {
    for (const id of [...buildStackIds(sub.dir), ...languageIdsIn(sub.dir)]) {
      if (!stacks.includes(id)) stacks.push(id);
    }
  }
  return stacks;
}

/** 命令前缀按锁文件判定包管理器，没锁文件按 npm */
function packageManager(dir) {
  if (isFile(dir, 'pnpm-lock.yaml')) return 'pnpm';
  if (isFile(dir, 'yarn.lock')) return 'yarn';
  if (isFile(dir, 'bun.lockb') || isFile(dir, 'bun.lock')) return 'bun';
  return 'npm';
}

function wrapper(dir, winName, posixName) {
  return isFile(dir, winName) || isFile(dir, posixName) ? (WIN ? winName.replace(/\.bat$/, '') : './' + posixName) : null;
}

/** scripts 里常见脚本的人话备注，其余脚本直接用脚本名 */
const SCRIPT_NAMES = {
  dev: '开发服务器',
  start: '启动应用',
  serve: '本地服务',
  build: '构建产物',
  preview: '预览产物',
  test: '跑测试',
  lint: '代码检查',
  format: '格式化',
  typecheck: '类型检查'
};

/** 优先推荐的脚本顺序：先开发态，再构建与检查 */
const SCRIPT_ORDER = ['dev', 'start', 'serve', 'preview', 'build', 'test', 'lint', 'typecheck', 'format'];

function detectNode(dir, add, types) {
  const pkg = readJson(dir, 'package.json');
  if (!pkg) return;
  const pm = packageManager(dir);
  const lock = ['pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'bun.lock', 'package-lock.json'].find((n) => isFile(dir, n));
  types.push({ id: 'node', label: 'Node.js', evidence: lock ? ['package.json', lock] : ['package.json'] });

  const scripts = pkg.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {};
  const names = Object.keys(scripts);
  const ordered = [...SCRIPT_ORDER.filter((n) => names.includes(n)), ...names.filter((n) => !SCRIPT_ORDER.includes(n))];
  ordered.forEach((name) => {
    add({
      type: 'node',
      text: pm + ' run ' + name,
      name: SCRIPT_NAMES[name] || name,
      reason: 'package.json 的 scripts.' + name
    });
  });
}

function detectMaven(dir, add, types) {
  if (!isFile(dir, 'pom.xml')) return;
  const pom = readHead(dir, 'pom.xml');
  const mvn = wrapper(dir, 'mvnw.cmd', 'mvnw') || 'mvn';
  types.push({ id: 'maven', label: 'Maven', evidence: ['pom.xml'] });
  if (/spring-boot-maven-plugin/.test(pom)) {
    add({ type: 'maven', text: mvn + ' spring-boot:run', name: '启动应用', reason: 'pom.xml 引入了 Spring Boot 插件' });
  }
  add({ type: 'maven', text: mvn + ' clean package', name: '打包', reason: 'Maven 标准打包' });
  add({ type: 'maven', text: mvn + ' test', name: '跑测试', reason: 'Maven 标准测试' });
}

function detectGradle(dir, add, types) {
  if (!isFile(dir, 'build.gradle') && !isFile(dir, 'build.gradle.kts')) return;
  const gradleFile = isFile(dir, 'build.gradle') ? 'build.gradle' : 'build.gradle.kts';
  const text = readHead(dir, gradleFile);
  const g = wrapper(dir, 'gradlew.bat', 'gradlew') || 'gradle';
  types.push({ id: 'gradle', label: 'Gradle', evidence: [gradleFile] });
  if (/org\.springframework\.boot/.test(text)) {
    add({ type: 'gradle', text: g + ' bootRun', name: '启动应用', reason: gradleFile + ' 使用了 Spring Boot 插件' });
  }
  add({ type: 'gradle', text: g + ' build', name: '构建', reason: 'Gradle 标准构建' });
  add({ type: 'gradle', text: g + ' test', name: '跑测试', reason: 'Gradle 标准测试' });
}

function detectPython(dir, add, types) {
  const hasManage = isFile(dir, 'manage.py');
  const hasPyProject = isFile(dir, 'pyproject.toml');
  const hasReq = isFile(dir, 'requirements.txt');
  const hasMain = isFile(dir, 'main.py');
  const hasApp = isFile(dir, 'app.py');
  if (!hasManage && !hasPyProject && !hasReq && !(hasMain && hasApp)) return;

  const evidence = [
    hasManage ? 'manage.py' : null,
    hasPyProject ? 'pyproject.toml' : null,
    hasReq ? 'requirements.txt' : null
  ].filter(Boolean);
  types.push({ id: 'python', label: 'Python', evidence: evidence.length ? evidence : ['main.py'] });

  if (hasManage) {
    add({ type: 'python', text: 'python manage.py runserver', name: 'Django 开发服务器', reason: '根目录有 manage.py' });
  }
  if (hasMain) add({ type: 'python', text: 'python main.py', name: '启动脚本', reason: '根目录有 main.py' });
  if (hasApp) add({ type: 'python', text: 'python app.py', name: '启动脚本', reason: '根目录有 app.py' });
}

function detectRust(dir, add, types) {
  if (!isFile(dir, 'Cargo.toml')) return;
  types.push({ id: 'rust', label: 'Rust', evidence: ['Cargo.toml'] });
  add({ type: 'rust', text: 'cargo run', name: '运行', reason: 'Cargo 标准运行' });
  add({ type: 'rust', text: 'cargo test', name: '跑测试', reason: 'Cargo 标准测试' });
  add({ type: 'rust', text: 'cargo build', name: '构建', reason: 'Cargo 标准构建' });
}

function detectGo(dir, add, types) {
  if (!isFile(dir, 'go.mod')) return;
  types.push({ id: 'go', label: 'Go', evidence: ['go.mod'] });
  add({ type: 'go', text: 'go run .', name: '运行', reason: 'go.mod 标记的 Go 模块' });
  add({ type: 'go', text: 'go test ./...', name: '跑测试', reason: 'Go 标准测试' });
  add({ type: 'go', text: 'go build ./...', name: '构建', reason: 'Go 标准构建' });
}

function detectDotnet(dir, add, types) {
  const proj = firstWithExt(dir, '.csproj');
  const sln = firstWithExt(dir, '.sln');
  if (!proj && !sln) return;
  types.push({ id: 'dotnet', label: '.NET', evidence: [proj || sln] });
  add({ type: 'dotnet', text: 'dotnet run', name: '运行', reason: '项目根目录有 .NET 工程文件' });
  add({ type: 'dotnet', text: 'dotnet build', name: '构建', reason: '.NET 标准构建' });
}

function detectDocker(dir, add, types) {
  const file = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'].find((n) => isFile(dir, n));
  if (!file) return;
  types.push({ id: 'docker', label: 'Docker Compose', evidence: [file] });
  add({ type: 'docker', text: 'docker compose up', name: '启动容器', reason: file + ' 定义了多容器编排' });
}

function detectPhp(dir, add, types) {
  if (!isFile(dir, 'composer.json')) return;
  if (!isFile(dir, 'artisan')) return;
  types.push({ id: 'php', label: 'PHP / Laravel', evidence: ['composer.json', 'artisan'] });
  add({ type: 'php', text: 'php artisan serve', name: 'Laravel 开发服务器', reason: '根目录有 artisan' });
}

function detectMake(dir, add, types) {
  if (!isFile(dir, 'Makefile')) return;
  types.push({ id: 'make', label: 'Makefile', evidence: ['Makefile'] });
  add({ type: 'make', text: 'make', name: '执行默认目标', reason: '根目录有 Makefile' });
}

/** 项目类型 / 技术栈缓存：path → { sig, profile }。列表轮询会反复问，只 stat 特征文件，不重复读清单 */
const PROFILE_CACHE = new Map();

function fileSig(file) {
  try {
    const s = fs.statSync(file);
    return (s.isDirectory() ? 'd' : 'f') + s.mtimeMs + ':' + s.size;
  } catch (_) {
    return '';
  }
}

/**
 * 识别项目类型（kind）与技术栈（stacks）。
 *
 * kind 决定主图标怎么取：有专属图标的项目才显示图标，其余回退首字母。
 * stacks 是右下角角标与行 tooltip 的技术栈列表，允许一个项目同时命中多个。
 *
 * 只认根目录 / 一级模块特征，不递归：
 *   - AndroidManifest.xml → Android；
 *   - manifest.json 的 minAppVersion → Obsidian 插件 / 主题；.obsidian → Obsidian 库；
 *   - IntelliJ Platform Gradle 插件或 META-INF/plugin.xml → IntelliJ 插件；
 *   - package.json 依赖 electron → Electron；任何 package.json → npm；
 *   - Maven / Gradle 使用 JavaFX / Spring Boot / Kotlin；
 *   - src/main/java、src/main/kotlin → Java / Kotlin；
 *   - pom.xml / build.gradle(.kts) → Maven / Gradle；
 *   - Cargo.toml / go.mod / Python 工程文件 / compose 文件 → Rust / Go / Python / Docker。
 * 根目录一个技术栈都认不出时，兜底扫一级子目录的构建标记（构建文件在一级模块的多模块仓库）；
 * 子目录只看文件与源码目录是否存在，不读内容，因此 electron / spring / obsidian 这类仍只认根目录。
 * 普通 Node 项目的 package.json 不会带 minAppVersion，因此不会误判。
 */
function detectProfile(root) {
  const empty = { kind: null, stacks: [] };
  const dir = String(root || '').trim();
  if (!dir) return empty;

  const manifestPath = path.join(dir, 'manifest.json');
  const vaultPath = path.join(dir, '.obsidian');
  // 常见 Android 模块路径进签名：模块改名/新增后重新识别；非常规模块名需重启生效
  const androidSig = [
    path.join(dir, 'AndroidManifest.xml'),
    path.join(dir, 'src', 'main', 'AndroidManifest.xml'),
    path.join(dir, 'app', 'src', 'main', 'AndroidManifest.xml')
  ]
    .map(fileSig)
    .join('|');
  // 类型判定依赖的构建文件 / 源码目录变化时重新识别
  const buildSig = [
    'package.json',
    'pom.xml',
    'build.gradle',
    'build.gradle.kts',
    'Cargo.toml',
    'go.mod',
    'manage.py',
    'pyproject.toml',
    'requirements.txt',
    'main.py',
    'app.py',
    'docker-compose.yml',
    'docker-compose.yaml',
    'compose.yml',
    'compose.yaml',
    'src/main/resources/META-INF/plugin.xml',
    'src/main/java',
    'src/main/kotlin',
    'app/src/main/java',
    'app/src/main/kotlin'
  ]
    .map((name) => fileSig(path.join(dir, name)))
    .join('|');
  const sig = fileSig(manifestPath) + '|' + fileSig(vaultPath) + '|' + androidSig + '|' + buildSig;
  const cached = PROFILE_CACHE.get(dir);
  // 兜底扫过子目录的项目（subSig 非空）才在轮询里多看一次目录 mtime，其余照旧只 stat 根目录
  if (cached && cached.sig === sig && (cached.subSig === null || cached.subSig === subdirSig(dir))) {
    return cached.profile;
  }

  const manifest = readJson(dir, 'manifest.json');
  const pkg = readJson(dir, 'package.json');
  const pom = readHead(dir, 'pom.xml');
  const gradle = readHead(dir, 'build.gradle') + readHead(dir, 'build.gradle.kts');
  const deps = (pkg && { ...pkg.dependencies, ...pkg.devDependencies }) || {};
  const pluginXml = isFile(dir, 'src/main/resources/META-INF/plugin.xml');
  const android = findAndroidModule(dir);

  let obsidianKind = null;
  if (manifest && typeof manifest.minAppVersion === 'string') {
    obsidianKind = typeof manifest.id === 'string' && manifest.id ? 'obsidian-plugin' : 'obsidian-theme';
  } else if (isDir(dir, '.obsidian')) {
    obsidianKind = 'obsidian-vault';
  }

  const intellij = pluginXml || /org\.jetbrains\.intellij/.test(gradle);
  const spring = /spring-boot/.test(pom + gradle);
  const javafx = /javafx/i.test(pom + gradle);
  const electron = !!deps.electron;

  let kind = null;
  if (android) kind = 'android';
  else if (obsidianKind) kind = obsidianKind;
  else if (intellij) kind = 'intellij-plugin';
  else if (electron) kind = 'electron';
  else if (javafx) kind = 'javafx';
  else if (spring) kind = 'spring-boot';

  // Android 的源码在 app 模块里，语言判定要把模块目录一起算上
  const sourceRoots = [dir, android && android.moduleDir].filter(Boolean);
  const kotlin = sourceRoots.some((d) => isDir(d, 'src/main/kotlin')) || /kotlin/i.test(pom + gradle);
  const java = sourceRoots.some((d) => isDir(d, 'src/main/java'));

  const stacks = [];
  const add = (id) => {
    if (id && !stacks.includes(id)) stacks.push(id);
  };
  if (kind) add(kind === 'intellij-plugin' ? 'intellij' : kind);
  if (intellij) add('intellij');
  if (electron) add('electron');
  if (javafx) add('javafx');
  if (spring) add('spring-boot');
  if (kotlin) add('kotlin');
  if (java) add('java');
  buildStackIds(dir).forEach(add);

  // 根目录一个技术栈都没有，才看一级子目录；有结果时 subSig 记录候选目录状态，供下次失效判定
  let subSig = null;
  if (!stacks.length) {
    subdirStacks(dir).forEach(add);
    subSig = subdirSig(dir);
  }

  const profile = { kind, stacks };
  PROFILE_CACHE.set(dir, { sig, subSig, profile });
  return profile;
}

/** 只取类型：兼容原有调用方 */
function detectKind(root) {
  return detectProfile(root).kind;
}

/** 只取技术栈：侧栏角标与 tooltip 用 */
function detectStacks(root) {
  return detectProfile(root).stacks;
}

/**
 * @param {string} root 项目根目录
 * @returns {{ types: Array<{id: string, label: string, evidence: string[]}>, suggestions: Array<{type: string, text: string, name: string, reason: string}> }}
 */
function detect(root) {
  const dir = String(root || '').trim();
  if (!dir) return { types: [], suggestions: [] };
  try {
    if (!fs.statSync(dir).isDirectory()) return { types: [], suggestions: [] };
  } catch (_) {
    return { types: [], suggestions: [] };
  }

  const types = [];
  const suggestions = [];
  const seen = new Set();

  function add(s) {
    if (suggestions.length >= MAX_SUGGESTIONS) return;
    if (seen.has(s.text)) return;
    seen.add(s.text);
    suggestions.push(s);
  }

  detectNode(dir, add, types);
  detectMaven(dir, add, types);
  detectGradle(dir, add, types);
  detectPython(dir, add, types);
  detectRust(dir, add, types);
  detectGo(dir, add, types);
  detectDotnet(dir, add, types);
  detectDocker(dir, add, types);
  detectPhp(dir, add, types);
  detectMake(dir, add, types);

  return { types, suggestions };
}

module.exports = { detect, detectKind, detectStacks, detectProfile };

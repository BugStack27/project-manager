/* ── 图标库 ─────────────────────────────────────
   SVG 源文件统一放在 assets/icons：
     ui/    界面单色图标（跟随 currentColor）
     brand/ 项目类型 / 技术栈图标（自带颜色）
     panel/ 面板开合图标
   本文件只做注册、尺寸替换与渲染，不再平铺 SVG 代码。 */

const uiFiles = import.meta.glob('./assets/icons/ui/*.svg', { query: '?raw', import: 'default', eager: true });
const brandFiles = import.meta.glob('./assets/icons/brand/*.svg', { query: '?raw', import: 'default', eager: true });
const panelFiles = import.meta.glob('./assets/icons/panel/*.svg', { query: '?raw', import: 'default', eager: true });

function basename(file) {
  return file.slice(file.lastIndexOf('/') + 1, -4);
}

function byName(files) {
  return Object.fromEntries(Object.entries(files).map(([file, source]) => [basename(file), source]));
}

const UI = byName(uiFiles);
const BRAND = byName(brandFiles);
const PANEL = byName(panelFiles);

/** 只改外层 svg 的宽高，保留 viewBox 与内部图形 */
function sized(source, size) {
  if (!size) return source;
  return source.replace(/<svg\b([^>]*)>/, (_, attrs) => {
    const rest = attrs.replace(/\swidth="[^"]*"/, '').replace(/\sheight="[^"]*"/, '');
    return '<svg' + rest + ' width="' + size + '" height="' + size + '">';
  });
}

/**
 * 注入本地静态 SVG。
 * span 用 display:contents，不生成盒子，等价于 SVG 直接挂在父节点下，
 * 因此各处的 `.xxx svg` 尺寸与颜色规则仍然生效。
 */
function SvgIcon({ source, size }) {
  return <span style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: sized(source, size) }} />;
}

function brand(name, size) {
  return <SvgIcon source={BRAND[name]} size={size} />;
}

/** Obsidian 标志：插件 / 主题 / 库共用 */
export function ObsidianIcon({ size = 16 }) {
  return brand('obsidian', size);
}

/** Android 机器人：识别为 Android 项目但还没取到应用图标时占位 */
export function AndroidIcon({ size = 16 }) {
  return brand('android', size);
}

/** Spring Boot：绿色叶片 */
export function SpringIcon({ size = 16 }) {
  return brand('spring', size);
}

/** Electron：原子轨道 */
export function ElectronIcon({ size = 16 }) {
  return brand('electron', size);
}

/** IntelliJ 插件：JetBrains 渐变底 + IJ */
export function IntellijPluginIcon({ size = 16 }) {
  return brand('intellij', size);
}

/** JavaFX：桌面窗口 + 播放三角 */
export function JavaFxIcon({ size = 16 }) {
  return brand('javafx', size);
}

/** Kotlin */
export function KotlinIcon({ size = 16 }) {
  return brand('kotlin', size);
}

/** Java */
export function JavaIcon({ size = 16 }) {
  return brand('java', size);
}

/** Gradle */
export function GradleIcon({ size = 16 }) {
  return brand('gradle', size);
}

/** Maven */
export function MavenIcon({ size = 16 }) {
  return brand('maven', size);
}

/** npm */
export function NpmIcon({ size = 16 }) {
  return brand('npm', size);
}

/** Go */
export function GoIcon({ size = 16 }) {
  return brand('go', size);
}

/** Rust */
export function RustIcon({ size = 16 }) {
  return brand('rust', size);
}

/** Python */
export function PythonIcon({ size = 16 }) {
  return brand('python', size);
}

/** Docker */
export function DockerIcon({ size = 16 }) {
  return brand('docker', size);
}

/** 界面单色图标：文件名即 IC 的 key，例如 ui/chevDown.svg → IC.chevDown */
export const IC = Object.fromEntries(
  Object.entries(UI).map(([name, source]) => [name, <SvgIcon key={name} source={source} />])
);

/** 面板开合图标：[| ] / [ |]，open 时面板侧半透明填充 */
export function PanelIcon({ side = 'left', open = true, size = 16 }) {
  return <SvgIcon source={PANEL['panel-' + side + (open ? '-open' : '-closed')]} size={size} />;
}

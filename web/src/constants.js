/* 领域常量：状态文案、页签顺序、配额口径、git 状态码映射。 */

export const STATUS = {
  candidate: { label: '候选池', cls: 'st-candidate' },
  todo: { label: '未开始', cls: 'st-todo' },
  doing: { label: '进行中', cls: 'st-doing' },
  review: { label: '待审核', cls: 'st-review' },
  done: { label: '已完成', cls: 'st-done' },
  rejected: { label: '已拒绝', cls: 'st-reject' }
};

/** 筛选页签：todo 与 doing 合并为「未完成」一个页签，行内徽标仍用 STATUS 区分；
    候选池单列（还没确认的想法，不算未完成） */
export const STATUS_ORDER = ['candidate', 'unfinished', 'done', 'rejected'];
export const TAB_LABEL = {
  candidate: '候选池',
  unfinished: '未完成',
  done: '已完成',
  rejected: '已拒绝'
};
/** 未完成状态：agent 交付后进入待审核，验收前同样算没做完 */
export const UNFINISHED = ['todo', 'doing', 'review'];
/**
 * 项目色板（头像底色）。顺序即分配顺序，所以前 6 个必须差异最大 ——
 * 绝大多数人只会同时开着几条项目，撞色要先撞在后面。
 *
 * 分两圈：第 1–12 个是中深色（配白字），第 13–24 个是同一色相的浅色（配深字，见 `avatarInk`）。
 * 只靠色相加不了多少 —— 15° 一档眼睛就分不开了；明度这一圈把可用的身份色翻了一倍，
 * 而且第 13 个和第 1 个是「同色相不同明度」，并排仍然认得出。
 * 全部避开高亮度黄：黄底无论配白字还是深字都容易和警示色/选中态混淆。
 */
export const PROJECT_COLORS = [
  '#007AFF', // 蓝
  '#D70015', // 红
  '#248A3D', // 绿
  '#C2410C', // 橙
  '#7C3AED', // 紫
  '#0E7490', // 青
  '#DB2777', // 粉
  '#6B7F00', // 橄榄
  '#4F46E5', // 靛
  '#C026D3', // 品红
  '#92400E', // 棕
  '#6E6E73', // 灰
  '#A5C8FF', // 浅蓝
  '#FBA9A5', // 浅红
  '#9DDCAF', // 浅绿
  '#F8C295', // 浅橙
  '#CDB9F9', // 浅紫
  '#95D8E3', // 浅青
  '#F8AAC9', // 浅粉
  '#CCD992', // 浅橄榄
  '#AFB2F6', // 浅靛
  '#EDB3EA', // 浅品红
  '#DCB99B', // 浅棕
  '#D0D0D5' // 浅灰
];

/** 项目品牌类型（后端 project.kind）→ 文案；stacks 缺失时的兜底 */
export const PROJECT_KIND_LABELS = {
  'obsidian-plugin': 'Obsidian 插件',
  'obsidian-theme': 'Obsidian 主题',
  'obsidian-vault': 'Obsidian 仓库',
  android: 'Android 应用',
  'intellij-plugin': 'IntelliJ 插件',
  electron: 'Electron 桌面应用',
  javafx: 'JavaFX 桌面应用',
  'spring-boot': 'Spring Boot 后端'
};

/** 技术栈（后端 project.stacks）→ 右下角角标 tooltip 文案 */
export const PROJECT_STACK_LABELS = {
  android: 'Android',
  'obsidian-plugin': 'Obsidian 插件',
  'obsidian-theme': 'Obsidian 主题',
  'obsidian-vault': 'Obsidian 仓库',
  intellij: 'IntelliJ 插件',
  electron: 'Electron',
  javafx: 'JavaFX',
  'spring-boot': 'Spring Boot',
  kotlin: 'Kotlin',
  java: 'Java',
  gradle: 'Gradle',
  maven: 'Maven',
  npm: 'npm'
};

/** git 文件状态码（status --porcelain / name-status）→ 徽标文案与配色 */
export const CHG = {
  '??': { label: '未跟踪', cls: 'st-untracked' },
  M: { label: '已修改', cls: 'st-mod' },
  A: { label: '新增', cls: 'st-add' },
  D: { label: '已删除', cls: 'st-del' },
  R: { label: '重命名', cls: 'st-ren' },
  C: { label: '复制', cls: 'st-ren' },
  T: { label: '类型变更', cls: 'st-ren' },
  U: { label: '冲突', cls: 'st-conf' }
};

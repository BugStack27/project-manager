/* 页面元信息：标题、标题图标、视图清单、git 分页大小。 */
import { IC } from '../icons.jsx';

export const GIT_PAGE = 30;

export const PAGE_TITLE = { overview: '总览', statistics: '统计', req: '需求中心', launch: '启动台', changes: '修改记录' };

/** 状态栏标题前的图标：与左栏导航同一套，避免两个入口看起来是两件事 */
export const PAGE_ICON = { overview: IC.grid, statistics: IC.chart, req: IC.req, launch: IC.launch, changes: IC.git };

/**
 * 中区标题下拉里的三项视图：都属于「当前选中的项目」，是项目的下级视图。
 * 「总览」不在这里——它表示「不选某个具体项目」，属于项目维度的入口，留在左栏。
 * tone 是下拉项右侧那盏状态灯的颜色，与侧栏项目行的灯同一套语义：
 * 需求＝蓝、运行＝绿、未提交＝橙。
 */
export const VIEWS = [
  { key: 'req', label: PAGE_TITLE.req, icon: IC.req, tone: 'plight-req' },
  { key: 'launch', label: PAGE_TITLE.launch, icon: IC.launch, tone: 'plight-run' },
  { key: 'changes', label: PAGE_TITLE.changes, icon: IC.git, tone: 'plight-dirty' }
];

import { IC } from '../icons.jsx';

/**
 * 顶部提示条骨架（数据文件损坏 / MCP 未启动）：只排布「图标 + 标题 + 说明 + 右侧动作」，
 * 文案与动作由调用方给。多条同时出现时由外层 .warnstack 统一贴住页栏，不要各自写 sticky。
 *
 * 说明与动作用 children 传，是因为两条提示的动作形态不同（一个两枚带字按钮、一个重试 + 关闭），
 * 强行统一成数组反而让调用处更难读。
 */
export default function TopWarn({ icon, title, desc, tip, children }) {
  return (
    <div className="warnbar" role="alert" title={tip}>
      <span className="wb-ico">{icon || IC.alert}</span>
      <div className="wb-main">
        <div className="wb-title">{title}</div>
        <div className="wb-desc">{desc}</div>
      </div>
      <div className="wb-actions">{children}</div>
    </div>
  );
}

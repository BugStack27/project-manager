import { IC } from '../icons.jsx';
import { Empty } from '../ui.jsx';

/** 一个项目都没登记时的中区空态：给新建入口 */
export default function ProjectEmptyState({ onCreateProject }) {
  return (
    <div className="wrap">
      <Empty
        title="还没有登记任何项目"
        desc="新建一个项目后，就能给它提需求、挂启动命令。"
        icon={IC.folder}
      >
        <button className="btn sm primary" onClick={onCreateProject}>
          {IC.plus}新建项目
        </button>
      </Empty>
    </div>
  );
}

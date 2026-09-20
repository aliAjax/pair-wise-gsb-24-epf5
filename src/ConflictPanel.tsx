import type { Conflict } from "./types";

interface Props {
  conflicts: Conflict[];
  onDismiss: () => void;
}

/**
 * 冲突清单：每次被规则引擎拒绝的登记/修订都会在此列出
 * 探方、地层、坐标、字段、原值、提交值与触发规则。
 */
export function ConflictPanel({ conflicts, onDismiss }: Props) {
  if (conflicts.length === 0) return null;
  return (
    <section className="panel conflict-panel">
      <div className="section-heading">
        <div>
          <p>联审拦截</p>
          <h2>冲突清单（{conflicts.length} 条）</h2>
        </div>
        <button onClick={onDismiss}>知道了</button>
      </div>
      <div className="conflict-table-wrap">
        <table className="conflict-table">
          <thead>
            <tr>
              <th>探方</th>
              <th>地层</th>
              <th>坐标</th>
              <th>字段</th>
              <th>原值</th>
              <th>提交值</th>
              <th>触发规则</th>
            </tr>
          </thead>
          <tbody>
            {conflicts.map((conflict) => (
              <tr key={conflict.id}>
                <td>{conflict.squareCode}</td>
                <td>{conflict.layerLabel}</td>
                <td>{conflict.coord}</td>
                <td>{conflict.field}</td>
                <td className="cell-original">{conflict.original}</td>
                <td className="cell-incoming">{conflict.incoming}</td>
                <td className="cell-rule">{conflict.rule}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

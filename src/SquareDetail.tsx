import { useMemo, useState } from "react";
import type {
  Artifact,
  FeatureType,
  Layer,
  PersistedState,
  Revision,
  SoilColor,
  Square,
} from "./types";
import { artifactsOf, layersOf, revisionsOf } from "./rules";

const SOIL_COLORS: SoilColor[] = ["灰褐土", "黄褐土", "黑褐土", "红褐土", "青灰土", "夯土"];
const FEATURE_TYPES: FeatureType[] = ["灰坑", "墓葬", "房址", "沟状遗迹"];

const SOIL_FILL: Record<SoilColor, string> = {
  灰褐土: "#a8a29e",
  黄褐土: "#d6a85c",
  黑褐土: "#57534e",
  红褐土: "#b45309",
  青灰土: "#7d8c8c",
  夯土: "#c08457",
};

interface DetailProps {
  state: PersistedState;
  square: Square;
  onAddLayer: (squareId: string, draft: {
    label: string;
    soilColor: SoilColor;
    topDepth: number;
    bottomDepth: number;
    note: string;
  }) => boolean;
  onAddArtifact: (squareId: string, draft: {
    layerId: string;
    name: string;
    featureType: FeatureType;
    x: number;
    y: number;
    depth: number;
    quantity: number;
    note: string;
  }) => boolean;
  onConfirm: (squareId: string) => boolean;
  onRevise: (squareId: string, layerId: string, patch: {
    label: string;
    soilColor: SoilColor;
    topDepth: number;
    bottomDepth: number;
    note: string;
  }, reason: string) => boolean;
}

function diffRevision(revision: Revision): string[] {
  const rows: string[] = [];
  const before = revision.before;
  const after = revision.after;
  if (before.label !== after.label) rows.push(`层名 ${before.label} → ${after.label}`);
  if (before.soilColor !== after.soilColor) rows.push(`土色 ${before.soilColor} → ${after.soilColor}`);
  if (before.topDepth !== after.topDepth) rows.push(`顶深 ${before.topDepth}m → ${after.topDepth}m`);
  if (before.bottomDepth !== after.bottomDepth) rows.push(`底深 ${before.bottomDepth}m → ${after.bottomDepth}m`);
  if (before.note !== after.note) rows.push(`备注「${before.note || "—"}」→「${after.note || "—"}」`);
  return rows.length > 0 ? rows : ["（无字段变化）"];
}

function LayerForm({ square, layers, onSubmit }: {
  square: Square;
  layers: Layer[];
  onSubmit: DetailProps["onAddLayer"];
}) {
  const expectedTop = layers.length === 0
    ? square.surfaceDepth
    : layers[layers.length - 1].bottomDepth;
  const [soilColor, setSoilColor] = useState<SoilColor>("灰褐土");
  const [bottomDepth, setBottomDepth] = useState("");
  const [note, setNote] = useState("");
  const label = `第${layers.length + 1}层`;

  return (
    <form
      className="inline-form"
      onSubmit={(event) => {
        event.preventDefault();
        const ok = onSubmit(square.id, {
          label,
          soilColor,
          topDepth: expectedTop,
          bottomDepth: Number(bottomDepth),
          note,
        });
        if (ok) {
          setBottomDepth("");
          setNote("");
        }
      }}
    >
      <h3>登记地层（{label}）</h3>
      <div className="form-grid">
        <label>
          <span>土色</span>
          <select value={soilColor} onChange={(e) => setSoilColor(e.target.value as SoilColor)}>
            {SOIL_COLORS.map((color) => <option key={color}>{color}</option>)}
          </select>
        </label>
        <label>
          <span>顶深（自动接续）</span>
          <input value={`${expectedTop} m`} readOnly />
        </label>
        <label>
          <span>底深（m）</span>
          <input
            required
            inputMode="decimal"
            placeholder="如 0.45"
            value={bottomDepth}
            onChange={(e) => setBottomDepth(e.target.value)}
          />
        </label>
        <label>
          <span>备注</span>
          <input placeholder="土质土色描述" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>
      <button className="primary-action" type="submit">登记地层</button>
    </form>
  );
}

function ArtifactForm({ square, layers, onSubmit }: {
  square: Square;
  layers: Layer[];
  onSubmit: DetailProps["onAddArtifact"];
}) {
  const [layerId, setLayerId] = useState(layers[0]?.id ?? "");
  const [name, setName] = useState("");
  const [featureType, setFeatureType] = useState<FeatureType>("灰坑");
  const [x, setX] = useState("");
  const [y, setY] = useState("");
  const [depth, setDepth] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [note, setNote] = useState("");

  const effectiveLayerId = layers.some((layer) => layer.id === layerId) ? layerId : (layers[0]?.id ?? "");

  return (
    <form
      className="inline-form"
      onSubmit={(event) => {
        event.preventDefault();
        const ok = onSubmit(square.id, {
          layerId: effectiveLayerId,
          name,
          featureType,
          x: Number(x),
          y: Number(y),
          depth: Number(depth),
          quantity: Number(quantity),
          note,
        });
        if (ok) {
          setName("");
          setX("");
          setY("");
          setDepth("");
          setQuantity("1");
          setNote("");
        }
      }}
    >
      <h3>出土物入档</h3>
      <div className="form-grid">
        <label>
          <span>所属地层（仅已登记）</span>
          <select value={effectiveLayerId} onChange={(e) => setLayerId(e.target.value)}>
            {layers.map((layer) => (
              <option key={layer.id} value={layer.id}>
                {layer.label} · {layer.soilColor} [{layer.topDepth}–{layer.bottomDepth}m]
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>名称</span>
          <input required placeholder="如 陶片12件" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          <span>遗迹类型</span>
          <select value={featureType} onChange={(e) => setFeatureType(e.target.value as FeatureType)}>
            {FEATURE_TYPES.map((type) => <option key={type}>{type}</option>)}
          </select>
        </label>
        <label>
          <span>东坐标 E（{square.xMin}–{square.xMax}m）</span>
          <input required inputMode="decimal" value={x} onChange={(e) => setX(e.target.value)} />
        </label>
        <label>
          <span>北坐标 N（{square.yMin}–{square.yMax}m）</span>
          <input required inputMode="decimal" value={y} onChange={(e) => setY(e.target.value)} />
        </label>
        <label>
          <span>出土深度（m）</span>
          <input required inputMode="decimal" value={depth} onChange={(e) => setDepth(e.target.value)} />
        </label>
        <label>
          <span>数量</span>
          <input required inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        </label>
        <label>
          <span>备注</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>
      <button className="primary-action" type="submit">入档</button>
    </form>
  );
}

function RevisionForm({ square, layers, onSubmit }: {
  square: Square;
  layers: Layer[];
  onSubmit: DetailProps["onRevise"];
}) {
  const [layerId, setLayerId] = useState(layers[0]?.id ?? "");
  const target = layers.find((layer) => layer.id === layerId) ?? layers[0];
  const [draft, setDraft] = useState<{
    key: string;
    label: string;
    soilColor: SoilColor;
    topDepth: string;
    bottomDepth: string;
    note: string;
  }>({ key: "", label: "", soilColor: "灰褐土", topDepth: "", bottomDepth: "", note: "" });
  const [reason, setReason] = useState("");

  const current = target && draft.key !== target.id
    ? {
        key: target.id,
        label: target.label,
        soilColor: target.soilColor,
        topDepth: String(target.topDepth),
        bottomDepth: String(target.bottomDepth),
        note: target.note,
      }
    : draft;

  if (!target) return null;

  const update = (patch: Partial<typeof current>) => setDraft({ ...current, ...patch });

  return (
    <form
      className="inline-form revision-form"
      onSubmit={(event) => {
        event.preventDefault();
        const ok = onSubmit(
          square.id,
          target.id,
          {
            label: current.label,
            soilColor: current.soilColor,
            topDepth: Number(current.topDepth),
            bottomDepth: Number(current.bottomDepth),
            note: current.note,
          },
          reason
        );
        if (ok) setReason("");
      }}
    >
      <h3>冻结地层纠错（新建修订，旧版保留）</h3>
      <div className="form-grid">
        <label>
          <span>修订对象</span>
          <select value={target.id} onChange={(e) => setLayerId(e.target.value)}>
            {layers.map((layer) => (
              <option key={layer.id} value={layer.id}>{layer.label} · {layer.soilColor}</option>
            ))}
          </select>
        </label>
        <label>
          <span>层名</span>
          <input required value={current.label} onChange={(e) => update({ label: e.target.value })} />
        </label>
        <label>
          <span>土色</span>
          <select value={current.soilColor} onChange={(e) => update({ soilColor: e.target.value as SoilColor })}>
            {SOIL_COLORS.map((color) => <option key={color}>{color}</option>)}
          </select>
        </label>
        <label>
          <span>顶深（m）</span>
          <input required inputMode="decimal" value={current.topDepth} onChange={(e) => update({ topDepth: e.target.value })} />
        </label>
        <label>
          <span>底深（m）</span>
          <input required inputMode="decimal" value={current.bottomDepth} onChange={(e) => update({ bottomDepth: e.target.value })} />
        </label>
        <label>
          <span>备注</span>
          <input value={current.note} onChange={(e) => update({ note: e.target.value })} />
        </label>
        <label className="span-2">
          <span>修订原因（必填，旧版将保留在修订链中）</span>
          <input required placeholder="如：剖面复核后更正土色" value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
      </div>
      <button className="primary-action" type="submit">提交修订</button>
    </form>
  );
}

export function SquareDetail({ state, square, onAddLayer, onAddArtifact, onConfirm, onRevise }: DetailProps) {
  const layers = useMemo(() => layersOf(state, square.id), [state, square.id]);
  const artifacts = useMemo(() => artifactsOf(state, square.id), [state, square.id]);
  const revisions = useMemo(() => revisionsOf(state, square.id), [state, square.id]);
  const confirmed = square.status === "confirmed";
  const totalDepth = layers.length > 0 ? layers[layers.length - 1].bottomDepth - square.surfaceDepth : 0;

  return (
    <section className="panel detail-panel">
      <div className="section-heading">
        <div>
          <p>{square.site} · {square.code}</p>
          <h2>
            探方 {square.code}
            <span className={`status-badge ${confirmed ? "status-confirmed" : "status-draft"}`}>
              {confirmed ? "已确认 · 地层冻结" : "登记中"}
            </span>
          </h2>
        </div>
        {!confirmed && (
          <button className="primary-action" onClick={() => onConfirm(square.id)}>
            联审确认并冻结
          </button>
        )}
      </div>

      <div className="square-meta">
        <span>边界 X [{square.xMin}, {square.xMax}]m</span>
        <span>边界 Y [{square.yMin}, {square.yMax}]m</span>
        <span>地表起算 {square.surfaceDepth}m</span>
        <span>已登记 {layers.length} 层 · 出土物 {artifacts.length} 件 · 修订 {revisions.length} 条</span>
      </div>

      <div className="detail-grid">
        <div>
          <h3 className="block-title">地层柱（顶深接续底深）</h3>
          <div className="strata-column">
            <div className="strata-surface">地表 {square.surfaceDepth}m</div>
            {layers.map((layer) => {
              const thickness = layer.bottomDepth - layer.topDepth;
              const height = totalDepth > 0 ? Math.max(34, (thickness / totalDepth) * 220) : 40;
              return (
                <div
                  key={layer.id}
                  className="strata-layer"
                  style={{ height, background: SOIL_FILL[layer.soilColor] }}
                  title={`${layer.label} ${layer.soilColor} ${layer.topDepth}–${layer.bottomDepth}m`}
                >
                  <strong>{layer.label}</strong>
                  <span>{layer.soilColor}</span>
                  <em>{layer.topDepth}–{layer.bottomDepth}m</em>
                </div>
              );
            })}
            {layers.length === 0 && <div className="strata-empty">尚未登记地层</div>}
          </div>
          {!confirmed && <LayerForm square={square} layers={layers} onSubmit={onAddLayer} />}
          {confirmed && <RevisionForm square={square} layers={layers} onSubmit={onRevise} />}
        </div>

        <div>
          <h3 className="block-title">出土物（{artifacts.length}）</h3>
          {artifacts.length > 0 ? (
            <table className="artifact-table">
              <thead>
                <tr>
                  <th>名称</th>
                  <th>地层</th>
                  <th>坐标</th>
                  <th>深度</th>
                  <th>数量</th>
                </tr>
              </thead>
              <tbody>
                {artifacts.map((artifact: Artifact) => {
                  const layer = layers.find((item) => item.id === artifact.layerId);
                  return (
                    <tr key={artifact.id}>
                      <td>{artifact.name}<small>{artifact.featureType}</small></td>
                      <td>{layer ? layer.label : "未登记"}</td>
                      <td>E{artifact.x} N{artifact.y}</td>
                      <td>{artifact.depth}m</td>
                      <td>{artifact.quantity}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <p className="empty-hint">尚无出土物入档</p>
          )}
          {layers.length > 0 && (
            <ArtifactForm square={square} layers={layers} onSubmit={onAddArtifact} />
          )}
        </div>
      </div>

      {revisions.length > 0 && (
        <div className="revision-chain">
          <h3 className="block-title">修订链（旧版全程保留）</h3>
          {revisions.map((revision, index) => (
            <article key={revision.id} className="revision-card">
              <header>
                <strong>修订 {index + 1} · {revision.before.label}</strong>
                <span>{new Date(revision.createdAt).toLocaleString()}</span>
              </header>
              <p className="revision-reason">原因：{revision.reason}</p>
              <ul>
                {diffRevision(revision).map((row) => <li key={row}>{row}</li>)}
              </ul>
              <p className="revision-before">
                旧版留档：{revision.before.label} · {revision.before.soilColor} ·
                [{revision.before.topDepth}m, {revision.before.bottomDepth}m] · {revision.before.note || "无备注"}
              </p>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

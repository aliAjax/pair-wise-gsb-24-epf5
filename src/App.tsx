import { useMemo, useState } from "react";
import "./styles.css";
import type { ActionResult, Conflict, Stratum } from "./types";
import {
  addTrench,
  clearDatabase,
  confirmStratum,
  conflicts as getConflicts,
  decideRevision,
  deleteDraftStratum,
  exportJSON,
  importJSON,
  registerFind,
  registerStratum,
  resetToSeed,
  startRevision,
  useDB,
} from "./store";
import {
  depthText,
  effectiveLayer,
  layerLabel,
  sortedStrata,
} from "./rules";

type Tab = "overview" | "trenches" | "finds" | "audit" | "revisions" | "archive";

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "总览" },
  { id: "trenches", label: "探方与地层" },
  { id: "finds", label: "出土物" },
  { id: "revisions", label: "修订链" },
  { id: "audit", label: "联审冲突" },
  { id: "archive", label: "落盘档案" },
];

interface Notice {
  kind: "ok" | "err";
  text: string;
  conflicts?: Conflict[];
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString("zh-CN")} ${d.toLocaleTimeString("zh-CN", { hour12: false })}`;
}

function StatusPill({ status }: { status: Stratum["status"] }) {
  const map = {
    draft: ["草稿", "pill-draft"],
    confirmed: ["已冻结", "pill-frozen"],
    revising: ["修订中", "pill-revising"],
  } as const;
  const [text, cls] = map[status];
  return <span className={`pill ${cls}`}>{text}</span>;
}

function ConflictTable({ rows, empty }: { rows: Conflict[]; empty: string }) {
  if (!rows.length) {
    return <p className="empty-hint">✓ {empty}</p>;
  }
  return (
    <div className="conflict-table-wrap">
      <table className="conflict-table">
        <thead>
          <tr>
            <th>触发规则</th>
            <th>探方</th>
            <th>地层</th>
            <th>坐标</th>
            <th>原值</th>
            <th>说明</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c, i) => (
            <tr key={i} className={c.severity === "soft" ? "row-soft" : ""}>
              <td className="rule-cell">
                <span className={`rule-tag ${c.severity === "soft" ? "soft" : "hard"}`}>
                  {c.ruleId}
                </span>
                <span className="rule-name">{c.ruleLabel.replace(/^S\d+\s*/, "")}</span>
              </td>
              <td>
                {c.trenchCode}
                {c.findId ? <em className="sub-id">{c.findId}</em> : null}
              </td>
              <td>{c.stratumLabel ?? "—"}</td>
              <td className="mono">{c.coord ?? "—"}</td>
              <td className="mono original">{c.originalValue ?? "—"}</td>
              <td>{c.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DepthBar({ layer, maxDepth }: { layer: Stratum; maxDepth: number }) {
  const eff = effectiveLayer(layer);
  const topPct = (eff.topDepth / maxDepth) * 100;
  const hPct = Math.max(((eff.bottomDepth - eff.topDepth) / maxDepth) * 100, 6);
  return (
    <div
      className={`depth-block status-${layer.status}`}
      style={{ top: `${topPct}%`, height: `${hPct}%` }}
      title={`${depthText(eff.topDepth)} – ${depthText(eff.bottomDepth)}`}
    >
      <span>第{layer.seq}层</span>
    </div>
  );
}

// ---------- 总览 ----------

function Overview({ go }: { go: (t: Tab) => void }) {
  const db = useDB();
  const conflicts = useMemo(() => getConflicts(), [db]);
  const hard = conflicts.filter((c) => c.severity === "hard");
  const revising = db.strata.filter((s) => s.status === "revising").length;

  const metrics = [
    { label: "探方数", value: db.trenches.length, tone: 0 },
    { label: "地层数（已冻结）", value: `${db.strata.length}（${db.strata.filter((s) => s.status === "confirmed").length}）`, tone: 1 },
    { label: "出土物", value: db.finds.length, tone: 2 },
    { label: "联审冲突", value: hard.length, tone: hard.length ? 3 : 1 },
  ];

  return (
    <>
      <div className="metrics-grid">
        {metrics.map((m) => (
          <article className="metric-card" key={m.label}>
            <span>{m.label}</span>
            <strong>{m.value}</strong>
            <i className={["status-ok", "status-watch", "status-danger", "status-danger"][m.tone]} />
          </article>
        ))}
      </div>

      <div className="panel-grid two">
        <section className="panel">
          <div className="section-heading">
            <div>
              <p>闭环状态</p>
              <h2>地层与出土物联审</h2>
            </div>
          </div>
          <ul className="state-list">
            <li className={hard.length ? "bad" : "good"}>
              <b>一致性联审</b>
              <span>{hard.length ? `检出 ${hard.length} 条硬性冲突` : "全库零硬性冲突，深度链与边界闭合"}</span>
            </li>
            <li className={revising ? "warn" : "good"}>
              <b>冻结与修订</b>
              <span>{revising ? `${revising} 条地层修订待审结` : "已确认地层全部冻结；纠错留痕于修订链"}</span>
            </li>
            <li className="good">
              <b>落盘</b>
              <span>每次操作自动写入浏览器本地档案，最近保存 {fmtTime(db.savedAt)}</span>
            </li>
          </ul>
          <div className="button-row">
            <button className="primary-action" onClick={() => go("trenches")}>登记地层</button>
            <button onClick={() => go("finds")}>出土物入档</button>
            <button onClick={() => go("audit")}>查看联审</button>
          </div>
        </section>

        <section className="panel">
          <div className="section-heading">
            <div>
              <p>最近操作</p>
              <h2>操作日志</h2>
            </div>
          </div>
          <div className="log-list">
            {db.logs.slice(0, 7).map((l) => (
              <div className={`log-item ${l.outcome}`} key={l.id}>
                <div className="log-head">
                  <span className="log-action">{l.action}</span>
                  <span className="log-target">{l.target}</span>
                  <span className="log-time">{fmtTime(l.at)}</span>
                </div>
                <p>{l.detail}{l.ruleId ? <em className="log-rule">（{l.ruleId}）</em> : null}</p>
              </div>
            ))}
            {!db.logs.length && <p className="empty-hint">暂无操作</p>}
          </div>
        </section>
      </div>
    </>
  );
}

// ---------- 探方与地层 ----------

function TrenchForm({ onResult }: { onResult: (r: ActionResult, okText: string) => void }) {
  const [code, setCode] = useState("");
  const [site, setSite] = useState("");
  const [sizeE, setSizeE] = useState("5");
  const [sizeN, setSizeN] = useState("5");

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p>探方登记</p>
          <h2>新建探方</h2>
        </div>
      </div>
      <div className="field-grid">
        <label>
          <span>探方编号</span>
          <input value={code} placeholder="如 T0301" onChange={(e) => setCode(e.target.value)} />
        </label>
        <label>
          <span>遗址</span>
          <input value={site} placeholder="如 河西坞遗址" onChange={(e) => setSite(e.target.value)} />
        </label>
        <label>
          <span>东西宽（米，边界 0–E）</span>
          <input type="number" step="0.5" value={sizeE} onChange={(e) => setSizeE(e.target.value)} />
        </label>
        <label>
          <span>南北长（米，边界 0–N）</span>
          <input type="number" step="0.5" value={sizeN} onChange={(e) => setSizeN(e.target.value)} />
        </label>
      </div>
      <div className="button-row">
        <button
          className="primary-action"
          onClick={() =>
            onResult(
              addTrench({ code, site, sizeE: Number(sizeE), sizeN: Number(sizeN) }),
              `探方 ${code} 已登记`,
            )
          }
        >
          登记探方
        </button>
      </div>
    </section>
  );
}

function StratumForm({ trenchId, onResult }: { trenchId: string; onResult: (r: ActionResult, okText: string) => void }) {
  const db = useDB();
  const layers = sortedStrata(db, trenchId);
  const expectedTop = layers.length ? effectiveLayer(layers[layers.length - 1]).bottomDepth : 0;
  const [soilColor, setSoilColor] = useState("");
  const [topDepth, setTopDepth] = useState(expectedTop.toFixed(2));
  const [bottomDepth, setBottomDepth] = useState("");

  return (
    <div className="stratum-form">
      <h4>连续登记下一层（第{layers.length + 1}层）</h4>
      <p className="rule-hint">
        规则 S1：顶深必须承接上一层底深 <b>{depthText(expectedTop)}</b>；规则 S2：底深须大于顶深。
      </p>
      <div className="field-grid three">
        <label>
          <span>土色 / 土质描述</span>
          <input value={soilColor} placeholder="如 灰褐土，含炭屑" onChange={(e) => setSoilColor(e.target.value)} />
        </label>
        <label>
          <span>顶深（米）</span>
          <input type="number" step="0.01" value={topDepth} onChange={(e) => setTopDepth(e.target.value)} />
        </label>
        <label>
          <span>底深（米）</span>
          <input type="number" step="0.01" value={bottomDepth} placeholder="如 1.10" onChange={(e) => setBottomDepth(e.target.value)} />
        </label>
      </div>
      <div className="button-row">
        <button
          className="primary-action"
          onClick={() =>
            onResult(
              registerStratum({
                trenchId,
                soilColor,
                topDepth: Number(topDepth),
                bottomDepth: Number(bottomDepth),
              }),
              `第${layers.length + 1}层已登记（草稿）`,
            )
          }
        >
          登记地层
        </button>
      </div>
    </div>
  );
}

function RevisionForm({ layer, onResult }: { layer: Stratum; onResult: (r: ActionResult, okText: string) => void }) {
  const eff = effectiveLayer(layer);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [color, setColor] = useState(eff.soilColor);
  const [top, setTop] = useState(eff.topDepth.toFixed(2));
  const [bottom, setBottom] = useState(eff.bottomDepth.toFixed(2));

  if (layer.status !== "confirmed" && layer.status !== "revising") return null;

  return (
    <div className="revision-inline">
      {!open ? (
        <button className="link-btn" onClick={() => setOpen(true)} disabled={layer.status === "revising"}>
          {layer.status === "revising" ? "修订审理中…" : "发起纠错修订（旧版保留）"}
        </button>
      ) : (
        <>
          <h4>纠错修订 · {layerLabel(layer)}（已冻结）</h4>
          <p className="rule-hint">
            规则 S5：必须填写修订原因；规则 S10：候选深度必须与上下邻层连续，否则不予立案。旧版值将永久保留。
          </p>
          <div className="field-grid">
            <label className="wide">
              <span>修订原因（必填）</span>
              <input value={reason} placeholder="如 复测发现层界面判深偏差 0.1m" onChange={(e) => setReason(e.target.value)} />
            </label>
            <label>
              <span>土色（新值）</span>
              <input value={color} onChange={(e) => setColor(e.target.value)} />
            </label>
            <label>
              <span>顶深新值（米）· 旧值 {depthText(eff.topDepth)}</span>
              <input type="number" step="0.01" value={top} onChange={(e) => setTop(e.target.value)} />
            </label>
            <label>
              <span>底深新值（米）· 旧值 {depthText(eff.bottomDepth)}</span>
              <input type="number" step="0.01" value={bottom} onChange={(e) => setBottom(e.target.value)} />
            </label>
          </div>
          <div className="button-row">
            <button
              className="primary-action"
              onClick={() => {
                const r = startRevision({
                  layerId: layer.id,
                  reason,
                  newSoilColor: color,
                  newTopDepth: Number(top),
                  newBottomDepth: Number(bottom),
                });
                if (r.ok) setOpen(false);
                onResult(r, "修订已立案，待审结");
              }}
            >
              提交修订
            </button>
            <button onClick={() => setOpen(false)}>取消</button>
          </div>
        </>
      )}
    </div>
  );
}

function TrenchCard({ trenchId, onResult }: { trenchId: string; onResult: (r: ActionResult, okText: string) => void }) {
  const db = useDB();
  const trench = db.trenches.find((t) => t.id === trenchId)!;
  const layers = sortedStrata(db, trenchId);
  const trenchFinds = db.finds.filter((f) => f.trenchId === trenchId);
  const maxDepth = Math.max(1, ...layers.map((l) => effectiveLayer(l).bottomDepth));
  const pendingRev = layers.flatMap((l) => l.revisions.filter((r) => r.status === "pending"));

  return (
    <article className="panel trench-card">
      <div className="section-heading">
        <div>
          <p>{trench.site}</p>
          <h2>{trench.code}</h2>
        </div>
        <div className="trench-meta">
          开口 {trench.sizeE}m × {trench.sizeN}m · {layers.length} 层 · {trenchFinds.length} 件出土物
          {pendingRev.length > 0 && <span className="pill pill-revising">{pendingRev.length} 修订待审</span>}
        </div>
      </div>

      <div className="trench-body">
        <div className="layer-profile">
          <div className="depth-ruler">
            {[0, 0.25, 0.5, 0.75, 1].map((p) => (
              <span key={p} style={{ top: `${p * 100}%` }}>{(maxDepth * p).toFixed(1)}m</span>
            ))}
          </div>
          <div className="depth-column">
            {layers.map((l) => (
              <DepthBar key={l.id} layer={l} maxDepth={maxDepth} />
            ))}
            {!layers.length && <p className="empty-hint">尚未登记地层</p>}
          </div>
        </div>

        <div className="layer-rows">
          {layers.map((layer) => {
            const eff = effectiveLayer(layer);
            const count = trenchFinds.filter((f) => f.stratumId === layer.id).length;
            return (
              <div key={layer.id} className={`layer-row ${layer.status}`}>
                <div className="layer-row-head">
                  <strong>{layerLabel(layer)}</strong>
                  <StatusPill status={layer.status} />
                  <span className="layer-depth mono">{depthText(eff.topDepth)} – {depthText(eff.bottomDepth)}</span>
                  <span className="layer-count">{count} 件出土物</span>
                </div>
                <p className="layer-color">{eff.soilColor}</p>
                <div className="layer-actions">
                  {layer.status === "draft" && (
                    <>
                      <button className="small primary-action" onClick={() => onResult(confirmStratum(layer.id), `${layerLabel(layer)}已确认并冻结`)}>
                        确认并冻结
                      </button>
                      <button className="small danger" onClick={() => onResult(deleteDraftStratum(layer.id), "草稿已删除")}>
                        删除草稿
                      </button>
                    </>
                  )}
                  <RevisionForm layer={layer} onResult={onResult} />
                </div>
                {layer.revisions.length > 0 && (
                  <p className="rev-mini">
                    修订链 {layer.revisions.length} 条：
                    {layer.revisions.map((r) => (
                      <span key={r.id} className={`mini-tag ${r.status}`}>{r.id} {r.status === "approved" ? "通过" : r.status === "pending" ? "待审" : "撤回"}</span>
                    ))}
                  </p>
                )}
              </div>
            );
          })}
          <StratumForm trenchId={trenchId} onResult={onResult} />
        </div>
      </div>
    </article>
  );
}

function Trenches({ onResult }: { onResult: (r: ActionResult, okText: string) => void }) {
  const db = useDB();
  return (
    <>
      <TrenchForm onResult={onResult} />
      {db.trenches.map((t) => (
        <TrenchCard key={t.id} trenchId={t.id} onResult={onResult} />
      ))}
      {!db.trenches.length && <section className="panel"><p className="empty-hint">还没有探方，先登记一个。</p></section>}
    </>
  );
}

// ---------- 出土物 ----------

function Finds({ onResult }: { onResult: (r: ActionResult, okText: string) => void }) {
  const db = useDB();
  const [trenchId, setTrenchId] = useState(db.trenches[0]?.id ?? "");
  const [stratumId, setStratumId] = useState("");
  const [name, setName] = useState("");
  const [e, setE] = useState("");
  const [n, setN] = useState("");
  const [depth, setDepth] = useState("");

  const trench = db.trenches.find((t) => t.id === trenchId);
  const layers = trench ? sortedStrata(db, trench.id) : [];
  const selectedLayer = layers.find((l) => l.id === stratumId);
  const eff = selectedLayer ? effectiveLayer(selectedLayer) : undefined;

  const submit = () =>
    onResult(
      registerFind({
        trenchId,
        stratumId,
        name,
        coordE: Number(e),
        coordN: Number(n),
        depth: Number(depth),
      }),
      `出土物「${name}」已入档`,
    );

  return (
    <>
      <section className="panel">
        <div className="section-heading">
          <div>
            <p>出土物入档</p>
            <h2>归入已登记地层</h2>
          </div>
        </div>
        <div className="field-grid">
          <label>
            <span>所属探方（S6）</span>
            <select
              value={trenchId}
              onChange={(ev) => {
                setTrenchId(ev.target.value);
                setStratumId("");
              }}
            >
              {db.trenches.map((t) => (
                <option key={t.id} value={t.id}>{t.code}（{t.site}）</option>
              ))}
            </select>
          </label>
          <label>
            <span>所属地层（S7：只能选已登记地层）</span>
            <select value={stratumId} onChange={(ev) => setStratumId(ev.target.value)}>
              <option value="">请选择地层…</option>
              {layers.map((l) => {
                const le = effectiveLayer(l);
                return (
                  <option key={l.id} value={l.id}>
                    {layerLabel(l)} · {le.soilColor} · {depthText(le.topDepth)}–{depthText(le.bottomDepth)}
                  </option>
                );
              })}
            </select>
          </label>
          <label className="wide">
            <span>名称 / 描述</span>
            <input value={name} placeholder="如 夹砂陶片" onChange={(ev) => setName(ev.target.value)} />
          </label>
          <label>
            <span>坐标 E（米，0–{trench?.sizeE ?? "?"}）· S8 边界</span>
            <input type="number" step="0.1" value={e} onChange={(ev) => setE(ev.target.value)} />
          </label>
          <label>
            <span>坐标 N（米，0–{trench?.sizeN ?? "?"}）· S8 边界</span>
            <input type="number" step="0.1" value={n} onChange={(ev) => setN(ev.target.value)} />
          </label>
          <label>
            <span>出土深度（米）· S9 须在 {eff ? `${depthText(eff.topDepth)}–${depthText(eff.bottomDepth)}` : "所属地层区间"}</span>
            <input type="number" step="0.01" value={depth} onChange={(ev) => setDepth(ev.target.value)} />
          </label>
        </div>
        <div className="button-row">
          <button className="primary-action" onClick={submit} disabled={!db.trenches.length}>入档</button>
        </div>
        <p className="rule-hint">
          坐标超出探方边界、或深度与所属地层不符时，S8 / S9 直接阻止入档，不产生悬空档案。
        </p>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p>已入档（{db.finds.length}）</p>
            <h2>出土物清单</h2>
          </div>
        </div>
        <div className="find-list">
          {db.finds.map((f) => {
          const tr = db.trenches.find((t) => t.id === f.trenchId);
          const ly = db.strata.find((s) => s.id === f.stratumId);
          return (
            <article className="find-card" key={f.id}>
              <div className="find-head">
                <strong>{f.name}</strong>
                <span className="mono">{f.id}</span>
              </div>
              <p>
                {tr?.code ?? "探方缺失"} · {ly ? layerLabel(ly) : "地层缺失"} ·{" "}
                E{f.coordE.toFixed(2)} N{f.coordN.toFixed(2)} · 深{depthText(f.depth)}
              </p>
              <p className="find-time">登记于 {fmtTime(f.registeredAt)}</p>
            </article>
          );
        })}
        </div>
        {!db.finds.length && <p className="empty-hint">暂无出土物。</p>}
      </section>
    </>
  );
}

// ---------- 修订链 ----------

function Revisions({ onResult }: { onResult: (r: ActionResult, okText: string) => void }) {
  const db = useDB();
  const all = db.strata.flatMap((l) => {
    const trench = db.trenches.find((t) => t.id === l.trenchId)!;
    return l.revisions.map((r) => ({ layer: l, trench, rev: r }));
  });

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p>冻结地层纠错留痕</p>
          <h2>修订链（{all.length}）</h2>
        </div>
      </div>
      <p className="rule-hint">
        规则 S4：确认后的地层冻结，禁止直接改写；规则 S5：每次纠错必须登记原因；旧版值快照保留，可逐版追溯。
      </p>
      <div className="revision-list">
        {all.map(({ layer, trench, rev }) => (
          <article key={rev.id} className={`revision-card ${rev.status}`}>
            <div className="rev-top">
              <strong>{trench.code} · {layerLabel(layer)}</strong>
              <span className="mono">{rev.id}</span>
              <span className={`pill pill-rev-${rev.status}`}>
                {rev.status === "approved" ? "已通过（新值生效）" : rev.status === "pending" ? "待审结" : "已撤回（旧版恢复）"}
              </span>
            </div>
            <p className="rev-reason">原因：{rev.reason}</p>
            <table className="rev-diff">
              <thead>
                <tr><th></th><th>土色</th><th>顶深</th><th>底深</th></tr>
              </thead>
              <tbody>
                <tr className="old">
                  <td>旧版</td><td>{rev.oldSoilColor}</td>
                  <td className="mono">{depthText(rev.oldTopDepth)}</td>
                  <td className="mono">{depthText(rev.oldBottomDepth)}</td>
                </tr>
                <tr className="new">
                  <td>新版</td><td>{rev.newSoilColor}</td>
                  <td className="mono">{depthText(rev.newTopDepth)}</td>
                  <td className="mono">{depthText(rev.newBottomDepth)}</td>
                </tr>
              </tbody>
            </table>
            <p className="find-time">发起 {fmtTime(rev.createdAt)}{rev.decidedAt ? ` · 审结 ${fmtTime(rev.decidedAt)}` : ""}</p>
            {rev.status === "pending" && (
              <div className="button-row">
                <button
                  className="small primary-action"
                  onClick={() => onResult(decideRevision(layer.id, rev.id, true), "修订已通过，新值生效，请查看联审")}
                >
                  通过（S10 链复核后生效）
                </button>
                <button
                  className="small"
                  onClick={() => onResult(decideRevision(layer.id, rev.id, false), "修订已撤回，冻结值恢复")}
                >
                  撤回
                </button>
              </div>
            )}
          </article>
        ))}
      </div>
      {!all.length && <p className="empty-hint">暂无修订；地层确认冻结后，纠错将在此留痕。</p>}
    </section>
  );
}

// ---------- 联审 ----------

function Audit() {
  const db = useDB();
  const all = useMemo(() => getConflicts(), [db]);
  const hard = all.filter((c) => c.severity === "hard");
  const soft = all.filter((c) => c.severity === "soft");

  return (
    <>
      <section className="panel">
        <div className="section-heading">
          <div>
            <p>刷新即全量复核</p>
            <h2>联审冲突清单</h2>
          </div>
          <div className="audit-summary">
            <span className="pill pill-frozen">硬性 {hard.length}</span>
            <span className="pill pill-draft">预警 {soft.length}</span>
          </div>
        </div>
        <p className="rule-hint">
          硬性冲突阻断入档/立案；预警（如“待审修订通过后会破坏深度链”）允许保留，但审结时仍按 S10 拦截。
          每条列出触发规则、探方、地层、坐标与原值。
        </p>
        <ConflictTable rows={all} empty="探方、地层、出土物与修订链完全一致，无冲突。" />
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p>逐探方核对</p>
            <h2>地层链与出土物分布</h2>
          </div>
        </div>
        <div className="audit-grid">
          {db.trenches.map((t) => {
            const layers = sortedStrata(db, t.id);
            const fs = db.finds.filter((f) => f.trenchId === t.id);
            return (
              <article key={t.id} className="mini-trench">
                <h3>{t.code} <em>{t.site}</em></h3>
                <p className="rule-hint">开口 {t.sizeE}×{t.sizeN}m · 最深 {layers.length ? depthText(effectiveLayer(layers[layers.length - 1]).bottomDepth) : "—"}</p>
                <ul className="chain-list">
                  {layers.map((l, i) => {
                    const eff = effectiveLayer(l);
                    const okTop = i === 0 ? Math.abs(eff.topDepth) < 1e-9 : Math.abs(eff.topDepth - effectiveLayer(layers[i - 1]).bottomDepth) < 1e-9;
                    return (
                      <li key={l.id} className={okTop ? "ok" : "bad"}>
                        {layerLabel(l)} · {eff.soilColor} · <span className="mono">{depthText(eff.topDepth)}→{depthText(eff.bottomDepth)}</span>
                        <StatusPill status={l.status} />
                        <span className="layer-count">{fs.filter((x) => x.stratumId === l.id).length} 件</span>
                      </li>
                    );
                  })}
                  {!layers.length && <li className="rule-hint">无地层</li>}
                </ul>
              </article>
            );
          })}
        </div>
      </section>
    </>
  );
}

// ---------- 落盘档案 ----------

function Archive({ onResult }: { onResult: (r: ActionResult, okText: string) => void }) {
  const db = useDB();
  const [text, setText] = useState("");

  const download = () => {
    const blob = new Blob([exportJSON()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `考古档案_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const onFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const r = importJSON(String(reader.result));
      onResult(r, "档案已导入并完成联审");
    };
    reader.readAsText(file);
  };

  return (
    <>
      <section className="panel">
        <div className="section-heading">
          <div>
            <p>可落盘</p>
            <h2>本地持久化与档案交换</h2>
          </div>
        </div>
        <ul className="state-list">
          <li className="good"><b>自动落盘</b><span>所有登记、确认、修订、入档操作即时写入 localStorage（键 hxwl-10.archaeology.db.v1），刷新页面后探方、地层、出土物与修订链保持一致。</span></li>
          <li className="good"><b>导出文件</b><span>完整 JSON 档案（含修订旧版与操作日志），可归档或换机导入。</span></li>
          <li className="warn"><b>导入即联审</b><span>导入后立即全量校验，任何 S1–S10 冲突都会在“联审冲突”页列出。</span></li>
        </ul>
        <div className="button-row">
          <button className="primary-action" onClick={download}>导出 JSON 档案</button>
          <label className="file-btn">
            导入 JSON 档案
            <input
              type="file"
              accept="application/json,.json"
              onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
            />
          </label>
        </div>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p>维护</p>
            <h2>重置 / 清空</h2>
          </div>
        </div>
        <div className="button-row">
          <button onClick={() => { resetToSeed(); onResult({ ok: true, conflicts: [] }, "已恢复内置样例档案"); }}>恢复内置样例</button>
          <button
            className="danger"
            onClick={() => {
              if (confirm("确认清空全部探方、地层、出土物与修订链？")) {
                clearDatabase();
                onResult({ ok: true, conflicts: [] }, "档案已清空");
              }
            }}
          >
            清空档案
          </button>
        </div>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p>原始落盘内容</p>
            <h2>JSON 预览</h2>
          </div>
          <button className="small" onClick={() => setText(exportJSON())}>刷新预览</button>
        </div>
        <textarea className="json-preview" value={text || "（点击“刷新预览”查看）"} readOnly />
      </section>
    </>
  );
}

// ---------- 外壳 ----------

export default function App() {
  const [tab, setTab] = useState<Tab>("overview");
  const [notice, setNotice] = useState<Notice | null>(null);
  const db = useDB();

  const onResult = (r: ActionResult, okText: string) => {
    if (r.ok) {
      setNotice({ kind: "ok", text: okText, conflicts: r.conflicts });
    } else {
      setNotice({ kind: "err", text: "操作被规则拦截", conflicts: r.conflicts });
    }
    window.setTimeout(() => setNotice(null), 8000);
  };

  const hardCount = useMemo(() => getConflicts().filter((c) => c.severity === "hard").length, [db]);

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">hxwl-10 · 考古探方地层与出土物联审闭环</p>
          <h1>考古探方记录</h1>
          <p className="subtitle">
            按土色与深度连续登记地层（S1 顶深承接、S2 底深大于顶深），确认即冻结（S4），纠错只走带原因修订（S5/S10）；
            出土物须归入已登记地层（S6/S7），坐标越界（S8）或深度不符（S9）不得入档。落盘可刷新，导入导出即联审。
          </p>
        </div>
        <div className="stack-card">
          <span>持久化</span>
          <strong>localStorage 自动落盘 + JSON 档案</strong>
          <span className="save-time">最近保存 {fmtTime(db.savedAt)}</span>
        </div>
      </section>

      <nav className="tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={tab === t.id ? "active" : ""}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.id === "audit" && hardCount > 0 && <span className="tab-badge">{hardCount}</span>}
          </button>
        ))}
      </nav>

      {notice && (
        <div className={`notice ${notice.kind}`}>
          <div className="notice-head">
            <b>{notice.kind === "ok" ? "✓ " + notice.text : "✕ " + notice.text}</b>
            <button onClick={() => setNotice(null)}>×</button>
          </div>
          {!!notice.conflicts?.length && <ConflictTable rows={notice.conflicts} empty="" />}
        </div>
      )}

      {tab === "overview" && <Overview go={setTab} />}
      {tab === "trenches" && <Trenches onResult={onResult} />}
      {tab === "finds" && <Finds onResult={onResult} />}
      {tab === "revisions" && <Revisions onResult={onResult} />}
      {tab === "audit" && <Audit />}
      {tab === "archive" && <Archive onResult={onResult} />}

      <footer className="app-footer">
        React + Vite + TypeScript · 规则 S1–S10 全部在前端落库前与刷新后双重执行
      </footer>
    </main>
  );
}

import { useMemo, useRef, useState } from "react";
import "./styles.css";
import type { Conflict, PersistedState, Square } from "./types";
import { exportState, loadState, parseImport, saveState } from "./storage";
import { buildSeedState } from "./seed";
import {
  auditState,
  validateArtifact,
  validateConfirm,
  validateLayer,
  validateRevision,
  validateSquare,
  type RuleResult,
} from "./rules";
import { ConflictPanel } from "./ConflictPanel";
import { SquareDetail } from "./SquareDetail";

function initialState(): PersistedState {
  const persisted = loadState();
  if (persisted) return persisted;
  const seed = buildSeedState();
  saveState(seed);
  return seed;
}

function App() {
  const [state, setState] = useState<PersistedState>(initialState);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [selectedId, setSelectedId] = useState<string>(state.squares[0]?.id ?? "");
  const [notice, setNotice] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selected = state.squares.find((square) => square.id === selectedId) ?? state.squares[0];

  const metrics = useMemo(
    () => [
      { label: "探方数", value: state.squares.length },
      { label: "地层数", value: state.layers.length },
      { label: "出土物", value: state.artifacts.length },
      { label: "修订数", value: state.revisions.length },
    ],
    [state]
  );

  function commit(next: PersistedState, message: string) {
    setState(next);
    saveState(next);
    setConflicts([]);
    setNotice(message);
  }

  function report(result: RuleResult<unknown>): boolean {
    if (!result.ok) {
      setConflicts(result.conflicts);
      setNotice("");
      return false;
    }
    return true;
  }

  // —— 探方登记 ——
  function handleAddSquare(draft: {
    code: string;
    site: string;
    xMin: number;
    xMax: number;
    yMin: number;
    yMax: number;
    surfaceDepth: number;
  }): boolean {
    const result = validateSquare(state, draft);
    if (!report(result)) return false;
    const square: Square = {
      ...result.value!,
      id: `SQ-${draft.code}-${Date.now()}`,
      status: "draft",
      createdAt: Date.now(),
    };
    commit({ ...state, squares: [...state.squares, square] }, `探方 ${square.code} 已登记`);
    setSelectedId(square.id);
    return true;
  }

  // —— 地层登记（R2 连续 / R5 冻结） ——
  function handleAddLayer(
    squareId: string,
    draft: Parameters<typeof validateLayer>[2]
  ): boolean {
    const square = state.squares.find((item) => item.id === squareId);
    if (!square) return false;
    const result = validateLayer(state, square, draft);
    if (!report(result)) return false;
    commit(
      { ...state, layers: [...state.layers, result.value!] },
      `${square.code} ${result.value!.label} 已登记（${result.value!.topDepth}–${result.value!.bottomDepth}m）`
    );
    return true;
  }

  // —— 出土物入档（R1 边界 / R3 归属 / R4 深度） ——
  function handleAddArtifact(
    squareId: string,
    draft: Parameters<typeof validateArtifact>[2]
  ): boolean {
    const square = state.squares.find((item) => item.id === squareId);
    if (!square) return false;
    const result = validateArtifact(state, square, draft);
    if (!report(result)) return false;
    commit(
      { ...state, artifacts: [...state.artifacts, result.value!] },
      `${result.value!.name} 已入档（E${result.value!.x} N${result.value!.y} 深${result.value!.depth}m）`
    );
    return true;
  }

  // —— 联审确认：冻结地层 ——
  function handleConfirm(squareId: string): boolean {
    const square = state.squares.find((item) => item.id === squareId);
    if (!square) return false;
    const result = validateConfirm(state, square);
    if (!report(result)) return false;
    commit(
      {
        ...state,
        squares: state.squares.map((item) => (item.id === squareId ? result.value! : item)),
      },
      `探方 ${square.code} 已确认，地层冻结，后续纠错请走修订`
    );
    return true;
  }

  // —— 冻结后纠错：新建带原因修订，旧版保留（R5/R6） ——
  function handleRevise(
    squareId: string,
    layerId: string,
    patch: Parameters<typeof validateRevision>[3],
    reason: string
  ): boolean {
    const square = state.squares.find((item) => item.id === squareId);
    if (!square) return false;
    const result = validateRevision(state, square, layerId, patch, reason);
    if (!report(result)) return false;
    commit(
      {
        ...state,
        layers: result.value!.layers,
        revisions: [...state.revisions, result.value!.revision],
      },
      `修订已建立：${result.value!.revision.before.label}（原因：${result.value!.revision.reason}），旧版已留档`
    );
    return true;
  }

  // —— 全量复核 ——
  function handleAudit() {
    const found = auditState(state);
    if (found.length === 0) {
      setConflicts([]);
      setNotice("全量复核通过：探方、地层、出土物与修订链一致");
    } else {
      setConflicts(found);
      setNotice("");
    }
  }

  // —— 导入：先审后入，冲突即拒 ——
  async function handleImport(file: File) {
    const parsed = parseImport(await file.text());
    if (!parsed) {
      setConflicts([]);
      setNotice("导入失败：文件不是有效的档案格式");
      return;
    }
    const found = auditState(parsed);
    if (found.length > 0) {
      setConflicts(found);
      setNotice("");
      return;
    }
    commit(parsed, "档案已导入并通过一致性复核");
    setSelectedId(parsed.squares[0]?.id ?? "");
  }

  function handleReset() {
    const seed = buildSeedState();
    commit(seed, "已重置为演示档案");
    setSelectedId(seed.squares[0]?.id ?? "");
  }

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">hxwl-10 · 地层与出土物联审闭环</p>
          <h1>考古探方记录</h1>
          <p className="subtitle">
            探方按土色与深度连续登记地层，后一层顶深必须等于前一层底深；出土物只能归入已登记地层，
            坐标越界或深度不符即被拦截；地层确认后冻结，纠错只能新建带原因的修订并保留旧版。
          </p>
        </div>
        <div className="stack-card">
          <span>数据落盘</span>
          <strong>localStorage 持久化 · JSON 导入导出 · 刷新后档案与修订链一致</strong>
          <div className="stack-actions">
            <button onClick={() => exportState(state)}>导出档案</button>
            <button onClick={() => fileInputRef.current?.click()}>导入档案</button>
            <button onClick={handleAudit}>全量复核</button>
            <button onClick={handleReset}>重置演示</button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleImport(file);
                event.target.value = "";
              }}
            />
          </div>
        </div>
      </section>

      <section className="metrics-grid">
        {metrics.map((metric) => (
          <article className="metric-card" key={metric.label}>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
            <i className="status-ok" />
          </article>
        ))}
      </section>

      {notice && <p className="notice-bar">{notice}</p>}
      <ConflictPanel conflicts={conflicts} onDismiss={() => setConflicts([])} />

      <section className="workspace">
        <aside className="panel narrow">
          <h2>探方</h2>
          <div className="square-list">
            {state.squares.map((square) => (
              <button
                key={square.id}
                className={`square-item ${selected?.id === square.id ? "active" : ""}`}
                onClick={() => setSelectedId(square.id)}
              >
                <strong>{square.code}</strong>
                <span>{square.status === "confirmed" ? "已确认" : "登记中"}</span>
              </button>
            ))}
          </div>
          <NewSquareForm onSubmit={handleAddSquare} />
        </aside>

        {selected && (
          <SquareDetail
            state={state}
            square={selected}
            onAddLayer={handleAddLayer}
            onAddArtifact={handleAddArtifact}
            onConfirm={handleConfirm}
            onRevise={handleRevise}
          />
        )}
      </section>
    </main>
  );
}

function NewSquareForm({ onSubmit }: { onSubmit: (draft: {
  code: string;
  site: string;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  surfaceDepth: number;
}) => boolean }) {
  const [code, setCode] = useState("");
  const [site, setSite] = useState("河湾遗址");
  const [size, setSize] = useState("5");

  return (
    <form
      className="inline-form"
      onSubmit={(event) => {
        event.preventDefault();
        const side = Number(size);
        const ok = onSubmit({
          code: code.trim(),
          site: site.trim(),
          xMin: 0,
          xMax: side,
          yMin: 0,
          yMax: side,
          surfaceDepth: 0,
        });
        if (ok) setCode("");
      }}
    >
      <h3>新探方</h3>
      <div className="form-grid single">
        <label>
          <span>探方编号</span>
          <input required placeholder="如 T0301" value={code} onChange={(e) => setCode(e.target.value)} />
        </label>
        <label>
          <span>遗址</span>
          <input required value={site} onChange={(e) => setSite(e.target.value)} />
        </label>
        <label>
          <span>边长（m）</span>
          <input required inputMode="decimal" value={size} onChange={(e) => setSize(e.target.value)} />
        </label>
      </div>
      <button className="primary-action" type="submit">登记探方</button>
    </form>
  );
}

export default App;

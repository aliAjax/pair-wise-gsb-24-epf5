import type { Artifact, Conflict, Layer, PersistedState, Revision, Square } from "./types";

export type RuleCode =
  | "R1-探方边界"
  | "R2-地层连续"
  | "R3-地层归属"
  | "R4-地层深度"
  | "R5-地层冻结"
  | "R6-修订原因";

export const RULE_LABELS: Record<RuleCode, string> = {
  "R1-探方边界": "R1 坐标必须落在探方边界内",
  "R2-地层连续": "R2 后一层顶深必须等于前一层底深",
  "R3-地层归属": "R3 出土物只能归入已登记地层",
  "R4-地层深度": "R4 出土深度必须落在所属地层顶底深之间",
  "R5-地层冻结": "R5 已确认探方的地层已冻结，只能通过修订纠错",
  "R6-修订原因": "R6 修订必须填写原因且保留旧版",
};

export interface RuleResult<T> {
  ok: boolean;
  value?: T;
  conflicts: Conflict[];
}

let conflictSeq = 0;
function conflictId(): string {
  conflictSeq += 1;
  return `cf-${Date.now()}-${conflictSeq}`;
}

function makeConflict(partial: Omit<Conflict, "id">): Conflict {
  return { id: conflictId(), ...partial };
}

export function layersOf(state: PersistedState, squareId: string): Layer[] {
  return state.layers
    .filter((layer) => layer.squareId === squareId)
    .sort((a, b) => a.seq - b.seq);
}

export function artifactsOf(state: PersistedState, squareId: string): Artifact[] {
  return state.artifacts.filter((artifact) => artifact.squareId === squareId);
}

export function revisionsOf(state: PersistedState, squareId: string): Revision[] {
  return state.revisions
    .filter((revision) => revision.squareId === squareId)
    .sort((a, b) => a.createdAt - b.createdAt);
}

/** 校验新增探方（编号唯一、边界合法） */
export function validateSquare(
  state: PersistedState,
  draft: Omit<Square, "id" | "status" | "createdAt">
): RuleResult<Omit<Square, "id" | "status" | "createdAt">> {
  const conflicts: Conflict[] = [];
  if (state.squares.some((square) => square.code === draft.code)) {
    conflicts.push(
      makeConflict({
        squareCode: draft.code,
        layerLabel: "—",
        coord: "—",
        field: "探方编号",
        original: state.squares.find((square) => square.code === draft.code)?.code ?? "",
        incoming: draft.code,
        rule: "探方编号必须唯一",
      })
    );
  }
  if (!(draft.xMin < draft.xMax && draft.yMin < draft.yMax)) {
    conflicts.push(
      makeConflict({
        squareCode: draft.code,
        layerLabel: "—",
        coord: `X[${draft.xMin},${draft.xMax}] Y[${draft.yMin},${draft.yMax}]`,
        field: "探方边界",
        original: `X[${draft.xMin},${draft.xMax}] Y[${draft.yMin},${draft.yMax}]`,
        incoming: `X[${draft.xMin},${draft.xMax}] Y[${draft.yMin},${draft.yMax}]`,
        rule: "探方边界必须满足 最小值 < 最大值",
      })
    );
  }
  return conflicts.length === 0
    ? { ok: true, value: draft, conflicts }
    : { ok: false, conflicts };
}

/**
 * 校验新增地层：
 * - 探方必须存在且未确认（确认后冻结）
 * - 第一层顶深必须等于地表起算深度
 * - 后一层顶深必须等于前一层底深（R2）
 */
export function validateLayer(
  state: PersistedState,
  square: Square,
  draft: Pick<Layer, "label" | "soilColor" | "topDepth" | "bottomDepth" | "note">
): RuleResult<Layer> {
  const conflicts: Conflict[] = [];
  const existing = layersOf(state, square.id);

  if (square.status === "confirmed") {
    conflicts.push(
      makeConflict({
        squareCode: square.code,
        layerLabel: draft.label,
        coord: "—",
        field: "地层登记",
        original: "探方已确认，地层冻结",
        incoming: `新增地层「${draft.label}」`,
        rule: RULE_LABELS["R5-地层冻结"],
      })
    );
  }

  if (!(draft.topDepth < draft.bottomDepth)) {
    conflicts.push(
      makeConflict({
        squareCode: square.code,
        layerLabel: draft.label,
        coord: "—",
        field: "顶深/底深",
        original: `顶深 ${draft.topDepth}m`,
        incoming: `底深 ${draft.bottomDepth}m`,
        rule: "顶深必须小于底深",
      })
    );
  }

  const expectedTop = existing.length === 0
    ? square.surfaceDepth
    : existing[existing.length - 1].bottomDepth;

  if (Math.abs(draft.topDepth - expectedTop) > 1e-9) {
    const prevLabel = existing.length === 0
      ? "地表"
      : `${existing[existing.length - 1].label}（第${existing.length}层）`;
    conflicts.push(
      makeConflict({
        squareCode: square.code,
        layerLabel: draft.label,
        coord: "—",
        field: "顶深",
        original: `${prevLabel} 底深 ${expectedTop}m`,
        incoming: `顶深 ${draft.topDepth}m`,
        rule: RULE_LABELS["R2-地层连续"],
      })
    );
  }

  if (conflicts.length > 0) return { ok: false, conflicts };

  const layer: Layer = {
    id: `L-${square.code}-${existing.length + 1}-${Date.now()}`,
    squareId: square.id,
    seq: existing.length + 1,
    label: draft.label,
    soilColor: draft.soilColor,
    topDepth: draft.topDepth,
    bottomDepth: draft.bottomDepth,
    note: draft.note,
    createdAt: Date.now(),
  };
  return { ok: true, value: layer, conflicts };
}

/**
 * 校验出土物入档：
 * - R3 只能归入已登记地层
 * - R1 坐标必须在探方边界内
 * - R4 深度必须在所属地层顶底深之间
 */
export function validateArtifact(
  state: PersistedState,
  square: Square,
  draft: Pick<Artifact, "layerId" | "name" | "featureType" | "x" | "y" | "depth" | "quantity" | "note">
): RuleResult<Artifact> {
  const conflicts: Conflict[] = [];
  const layer = state.layers.find(
    (item) => item.id === draft.layerId && item.squareId === square.id
  );
  const coord = `E${draft.x} N${draft.y} 深${draft.depth}m`;

  if (!layer) {
    conflicts.push(
      makeConflict({
        squareCode: square.code,
        layerLabel: "未登记",
        coord,
        field: "所属地层",
        original: "（无此地层）",
        incoming: draft.layerId || "（未选择）",
        rule: RULE_LABELS["R3-地层归属"],
      })
    );
  }

  const inBoundary =
    draft.x >= square.xMin && draft.x <= square.xMax && draft.y >= square.yMin && draft.y <= square.yMax;
  if (!inBoundary) {
    conflicts.push(
      makeConflict({
        squareCode: square.code,
        layerLabel: layer ? layer.label : "未登记",
        coord,
        field: "坐标",
        original: `边界 X[${square.xMin},${square.xMax}] Y[${square.yMin},${square.yMax}]`,
        incoming: `E${draft.x} N${draft.y}`,
        rule: RULE_LABELS["R1-探方边界"],
      })
    );
  }

  if (layer && !(draft.depth >= layer.topDepth && draft.depth <= layer.bottomDepth)) {
    conflicts.push(
      makeConflict({
        squareCode: square.code,
        layerLabel: layer.label,
        coord,
        field: "出土深度",
        original: `${layer.label} 深度区间 [${layer.topDepth}m, ${layer.bottomDepth}m]`,
        incoming: `深 ${draft.depth}m`,
        rule: RULE_LABELS["R4-地层深度"],
      })
    );
  }

  if (conflicts.length > 0) return { ok: false, conflicts };

  const artifact: Artifact = {
    id: `A-${square.code}-${Date.now()}`,
    squareId: square.id,
    layerId: draft.layerId,
    name: draft.name,
    featureType: draft.featureType,
    x: draft.x,
    y: draft.y,
    depth: draft.depth,
    quantity: draft.quantity,
    note: draft.note,
    createdAt: Date.now(),
  };
  return { ok: true, value: artifact, conflicts };
}

/**
 * 确认探方：确认前整体复核地层链连续性，确认后地层冻结。
 */
export function validateConfirm(state: PersistedState, square: Square): RuleResult<Square> {
  const conflicts: Conflict[] = [];
  const layers = layersOf(state, square.id);

  if (layers.length === 0) {
    conflicts.push(
      makeConflict({
        squareCode: square.code,
        layerLabel: "—",
        coord: "—",
        field: "地层",
        original: "0 层",
        incoming: "确认探方",
        rule: "确认前至少登记一层地层",
      })
    );
  }

  layers.forEach((layer, index) => {
    const expectedTop = index === 0 ? square.surfaceDepth : layers[index - 1].bottomDepth;
    if (Math.abs(layer.topDepth - expectedTop) > 1e-9) {
      conflicts.push(
        makeConflict({
          squareCode: square.code,
          layerLabel: layer.label,
          coord: "—",
          field: "顶深",
          original: `上一层底深 ${expectedTop}m`,
          incoming: `顶深 ${layer.topDepth}m`,
          rule: RULE_LABELS["R2-地层连续"],
        })
      );
    }
  });

  if (conflicts.length > 0) return { ok: false, conflicts };
  return { ok: true, value: { ...square, status: "confirmed" }, conflicts };
}

/**
 * 冻结后的纠错：不改动旧层，生成一条带原因的修订，
 * 新层版本追加到链尾，旧版保留在修订记录中（R5/R6）。
 * 修订后的整链仍需满足 R2 连续性，且已入档出土物不得因此违反 R4。
 */
export function validateRevision(
  state: PersistedState,
  square: Square,
  layerId: string,
  patch: Pick<Layer, "label" | "soilColor" | "topDepth" | "bottomDepth" | "note">,
  reason: string
): RuleResult<{ revision: Revision; layers: Layer[] }> {
  const conflicts: Conflict[] = [];
  const layers = layersOf(state, square.id);
  const index = layers.findIndex((layer) => layer.id === layerId);
  const target = index >= 0 ? layers[index] : undefined;

  if (!target) {
    conflicts.push(
      makeConflict({
        squareCode: square.code,
        layerLabel: "未登记",
        coord: "—",
        field: "修订对象",
        original: "（无此地层）",
        incoming: layerId,
        rule: RULE_LABELS["R3-地层归属"],
      })
    );
    return { ok: false, conflicts };
  }

  if (!reason.trim()) {
    conflicts.push(
      makeConflict({
        squareCode: square.code,
        layerLabel: target.label,
        coord: "—",
        field: "修订原因",
        original: "（空）",
        incoming: "（空）",
        rule: RULE_LABELS["R6-修订原因"],
      })
    );
  }

  if (!(patch.topDepth < patch.bottomDepth)) {
    conflicts.push(
      makeConflict({
        squareCode: square.code,
        layerLabel: target.label,
        coord: "—",
        field: "顶深/底深",
        original: `顶深 ${target.topDepth}m 底深 ${target.bottomDepth}m`,
        incoming: `顶深 ${patch.topDepth}m 底深 ${patch.bottomDepth}m`,
        rule: "顶深必须小于底深",
      })
    );
  }

  // 用修订值替换后，整链重新校验连续性
  const replaced = layers.map((layer) =>
    layer.id === layerId ? { ...layer, ...patch } : layer
  );
  replaced.forEach((layer, i) => {
    const expectedTop = i === 0 ? square.surfaceDepth : replaced[i - 1].bottomDepth;
    if (Math.abs(layer.topDepth - expectedTop) > 1e-9) {
      conflicts.push(
        makeConflict({
          squareCode: square.code,
          layerLabel: layer.label,
          coord: "—",
          field: "顶深",
          original: `上一层底深 ${expectedTop}m`,
          incoming: `顶深 ${layer.topDepth}m`,
          rule: RULE_LABELS["R2-地层连续"],
        })
      );
    }
  });

  // 已入档出土物不得因修订而违反 R4
  const revised = replaced[index];
  state.artifacts
    .filter((artifact) => artifact.layerId === layerId)
    .forEach((artifact) => {
      if (!(artifact.depth >= revised.topDepth && artifact.depth <= revised.bottomDepth)) {
        conflicts.push(
          makeConflict({
            squareCode: square.code,
            layerLabel: revised.label,
            coord: `E${artifact.x} N${artifact.y} 深${artifact.depth}m`,
            field: "出土深度",
            original: `修订后区间 [${revised.topDepth}m, ${revised.bottomDepth}m]`,
            incoming: `${artifact.name} 深 ${artifact.depth}m`,
            rule: RULE_LABELS["R4-地层深度"],
          })
        );
      }
    });

  if (conflicts.length > 0) return { ok: false, conflicts };

  // 修订保持地层身份不变：旧版完整存入 revision.before，当前链中就地更新
  const after: Layer = { ...target, ...patch, createdAt: Date.now() };
  const revision: Revision = {
    id: `R-${Date.now()}`,
    squareId: square.id,
    layerId: target.id,
    reason: reason.trim(),
    before: target,
    after,
    createdAt: Date.now(),
  };

  const nextLayers = state.layers.map((layer) => (layer.id === layerId ? after : layer));
  return { ok: true, value: { revision, layers: nextLayers }, conflicts };
}

/** 全量一致性复核：用于导入数据与刷新后自检，返回全部冲突 */
export function auditState(state: PersistedState): Conflict[] {
  const conflicts: Conflict[] = [];
  for (const square of state.squares) {
    const layers = layersOf(state, square.id);
    layers.forEach((layer, index) => {
      const expectedTop = index === 0 ? square.surfaceDepth : layers[index - 1].bottomDepth;
      if (Math.abs(layer.topDepth - expectedTop) > 1e-9) {
        conflicts.push(
          makeConflict({
            squareCode: square.code,
            layerLabel: layer.label,
            coord: "—",
            field: "顶深",
            original: `上一层底深 ${expectedTop}m`,
            incoming: `顶深 ${layer.topDepth}m`,
            rule: RULE_LABELS["R2-地层连续"],
          })
        );
      }
    });
    for (const artifact of artifactsOf(state, square.id)) {
      const layer = layers.find((item) => item.id === artifact.layerId);
      const coord = `E${artifact.x} N${artifact.y} 深${artifact.depth}m`;
      if (!layer) {
        conflicts.push(
          makeConflict({
            squareCode: square.code,
            layerLabel: "未登记",
            coord,
            field: "所属地层",
            original: "（无此地层）",
            incoming: artifact.layerId,
            rule: RULE_LABELS["R3-地层归属"],
          })
        );
        continue;
      }
      if (
        artifact.x < square.xMin ||
        artifact.x > square.xMax ||
        artifact.y < square.yMin ||
        artifact.y > square.yMax
      ) {
        conflicts.push(
          makeConflict({
            squareCode: square.code,
            layerLabel: layer.label,
            coord,
            field: "坐标",
            original: `边界 X[${square.xMin},${square.xMax}] Y[${square.yMin},${square.yMax}]`,
            incoming: `E${artifact.x} N${artifact.y}`,
            rule: RULE_LABELS["R1-探方边界"],
          })
        );
      }
      if (artifact.depth < layer.topDepth || artifact.depth > layer.bottomDepth) {
        conflicts.push(
          makeConflict({
            squareCode: square.code,
            layerLabel: layer.label,
            coord,
            field: "出土深度",
            original: `${layer.label} 深度区间 [${layer.topDepth}m, ${layer.bottomDepth}m]`,
            incoming: `深 ${artifact.depth}m`,
            rule: RULE_LABELS["R4-地层深度"],
          })
        );
      }
    }
  }
  return conflicts;
}

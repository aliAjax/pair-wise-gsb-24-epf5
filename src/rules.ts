import type {
  Conflict,
  Database,
  Find,
  RuleId,
  Stratum,
  Trench,
} from "./types";

export const RULE_LABELS: Record<RuleId, string> = {
  S1_TOP_EQUALS_PREV_BOTTOM: "S1 地层连续：后一层顶深必须等于前一层底深",
  S2_BOTTOM_GT_TOP: "S2 深度有效：底深必须大于顶深",
  S3_LAYER_SEQ_GAP: "S3 层位连续：层号不得缺号",
  S4_LAYER_FROZEN: "S4 冻结保护：地层确认后不得直接改写",
  S5_REVISION_REASON_REQUIRED: "S5 修订留痕：纠错必须填写原因",
  S6_FIND_TRENCH_EXISTS: "S6 探方有效：出土物必须归属已登记探方",
  S7_FIND_STRATUM_REGISTERED: "S7 地层归属：出土物只能归入已登记地层",
  S8_FIND_WITHIN_BOUNDARY: "S8 坐标边界：坐标不得超出探方范围",
  S9_FIND_DEPTH_MATCH: "S9 深度相符：出土深度必须落在所属地层深度区间",
  S10_REVISION_BREAKS_CHAIN: "S10 修订复核：修订后不得破坏地层连续链",
};

export function nowIso(): string {
  return new Date().toISOString();
}

export function uid(prefix: string, db: Database): string {
  db.seqCounters.uid += 1;
  return `${prefix}-${String(db.seqCounters.uid).padStart(4, "0")}`;
}

/** 地层对外展示的深度口径：若有“通过”的修订，以修订值为准，旧版保留于 revisions。 */
export function effectiveLayer(layer: Stratum): {
  soilColor: string;
  topDepth: number;
  bottomDepth: number;
} {
  const approved = [...layer.revisions]
    .filter((r) => r.status === "approved")
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
  if (approved) {
    return {
      soilColor: approved.newSoilColor,
      topDepth: approved.newTopDepth,
      bottomDepth: approved.newBottomDepth,
    };
  }
  return {
    soilColor: layer.soilColor,
    topDepth: layer.topDepth,
    bottomDepth: layer.bottomDepth,
  };
}

export function layerLabel(layer: Stratum): string {
  return `第${layer.seq}层`;
}

export function depthText(v: number): string {
  return `${v.toFixed(2)}m`;
}

function makeConflict(
  ruleId: RuleId,
  trench: Trench | undefined,
  message: string,
  extra: Partial<Conflict> = {},
): Conflict {
  return {
    ruleId,
    ruleLabel: RULE_LABELS[ruleId],
    severity: "hard",
    trenchId: trench?.id ?? extra.trenchId ?? "—",
    trenchCode: trench?.code ?? extra.trenchCode ?? "未知探方",
    message,
    ...extra,
  };
}

function trenchOf(db: Database, trenchId: string): Trench | undefined {
  return db.trenches.find((t) => t.id === trenchId);
}

/** 按探方取出排好序的地层（层号升序）。 */
export function sortedStrata(db: Database, trenchId: string): Stratum[] {
  return db.strata
    .filter((s) => s.trenchId === trenchId)
    .sort((a, b) => a.seq - b.seq);
}

// ---------- 单条地层登记校验（草稿/确认都适用） ----------

export function validateStratumInput(
  db: Database,
  trenchId: string,
  seq: number,
  topDepth: number,
  bottomDepth: number,
): Conflict[] {
  const trench = trenchOf(db, trenchId);
  const conflicts: Conflict[] = [];

  if (!Number.isFinite(topDepth) || !Number.isFinite(bottomDepth)) {
    conflicts.push(
      makeConflict("S2_BOTTOM_GT_TOP", trench, "顶深、底深必须为数字", {
        trenchId,
        stratumLabel: `第${seq}层`,
      }),
    );
    return conflicts;
  }

  if (topDepth < 0) {
    conflicts.push(
      makeConflict(
        "S1_TOP_EQUALS_PREV_BOTTOM",
        trench,
        `第${seq}层顶深不能为负值（原值 ${depthText(topDepth)}）`,
      ),
    );
  }

  if (bottomDepth <= topDepth) {
    conflicts.push(
      makeConflict(
        "S2_BOTTOM_GT_TOP",
        trench,
        `第${seq}层底深 ${depthText(bottomDepth)} 必须大于顶深 ${depthText(topDepth)}`,
        { stratumLabel: `第${seq}层`, originalValue: `顶${depthText(topDepth)} / 底${depthText(bottomDepth)}` },
      ),
    );
  }

  const layers = sortedStrata(db, trenchId);

  // 层号必须连续
  if (layers.length > 0) {
    const nextSeq = layers[layers.length - 1].seq + 1;
    if (seq !== nextSeq) {
      conflicts.push(
        makeConflict(
          "S3_LAYER_SEQ_GAP",
          trench,
          `层号缺号：当前应登记第${nextSeq}层，收到第${seq}层`,
          { stratumLabel: `第${seq}层`, originalValue: `第${seq}层` },
        ),
      );
    }
  } else if (seq !== 1) {
    conflicts.push(
      makeConflict(
        "S3_LAYER_SEQ_GAP",
        trench,
        `首个地层必须从第1层开始，收到第${seq}层`,
        { stratumLabel: `第${seq}层`, originalValue: `第${seq}层` },
      ),
    );
  }

  // 后一层顶深 = 前一层底深
  const prev = layers[layers.length - 1];
  if (prev) {
    const eff = effectiveLayer(prev);
    if (Math.abs(topDepth - eff.bottomDepth) > 1e-9) {
      conflicts.push(
        makeConflict(
          "S1_TOP_EQUALS_PREV_BOTTOM",
          trench,
          `第${seq}层顶深 ${depthText(topDepth)} 必须等于第${prev.seq}层底深 ${depthText(eff.bottomDepth)}`,
          {
            stratumId: prev.id,
            stratumLabel: layerLabel(prev),
            originalValue: `期望顶深 ${depthText(eff.bottomDepth)}，实填 ${depthText(topDepth)}`,
          },
        ),
      );
    }
  } else if (Math.abs(topDepth) > 1e-9) {
    conflicts.push(
      makeConflict(
        "S1_TOP_EQUALS_PREV_BOTTOM",
        trench,
        `第1层顶深必须自地表 0.00m 起，实填 ${depthText(topDepth)}`,
        { stratumLabel: "第1层", originalValue: depthText(topDepth) },
      ),
    );
  }

  return conflicts;
}

// ---------- 出土物入档校验 ----------

export function validateFindInput(
  db: Database,
  trenchId: string,
  stratumId: string,
  coordE: number,
  coordN: number,
  depth: number,
): Conflict[] {
  const trench = trenchOf(db, trenchId);
  const conflicts: Conflict[] = [];

  if (!trench) {
    conflicts.push(
      makeConflict("S6_FIND_TRENCH_EXISTS", undefined, "探方不存在或未登记", {
        trenchId,
      }),
    );
    return conflicts;
  }

  const layer = db.strata.find((s) => s.id === stratumId);
  if (!layer || layer.trenchId !== trenchId) {
    conflicts.push(
      makeConflict(
        "S7_FIND_STRATUM_REGISTERED",
        trench,
        `地层不存在或不属于探方 ${trench.code}，出土物不能入档`,
        { originalValue: `stratumId=${stratumId}` },
      ),
    );
  }

  const nums = [coordE, coordN, depth];
  if (nums.some((n) => !Number.isFinite(n))) {
    conflicts.push(
      makeConflict("S8_FIND_WITHIN_BOUNDARY", trench, "坐标与深度必须为数字", {
        coord: `E${coordE} N${coordN}`,
      }),
    );
    return conflicts;
  }

  // 坐标边界：探方局部坐标 [0, sizeE] × [0, sizeN]
  if (coordE < 0 || coordE > trench.sizeE || coordN < 0 || coordN > trench.sizeN) {
    conflicts.push(
      makeConflict(
        "S8_FIND_WITHIN_BOUNDARY",
        trench,
        `坐标 E${coordE.toFixed(2)} N${coordN.toFixed(2)} 超出探方边界（东西 0–${trench.sizeE}m，南北 0–${trench.sizeN}m），不能入档`,
        {
          stratumId: layer?.id,
          stratumLabel: layer ? layerLabel(layer) : undefined,
          coord: `E${coordE.toFixed(2)} N${coordN.toFixed(2)}`,
          originalValue: `边界 0–${trench.sizeE} × 0–${trench.sizeN}`,
        },
      ),
    );
  }

  // 深度必须落入所属地层区间（以生效值，含最新通过的修订）
  if (layer) {
    const eff = effectiveLayer(layer);
    if (depth < eff.topDepth - 1e-9 || depth > eff.bottomDepth + 1e-9) {
      conflicts.push(
        makeConflict(
          "S9_FIND_DEPTH_MATCH",
          trench,
          `出土深度 ${depthText(depth)} 不属于${layerLabel(layer)}（${depthText(eff.topDepth)}–${depthText(eff.bottomDepth)}），不能入档`,
          {
            stratumId: layer.id,
            stratumLabel: layerLabel(layer),
            coord: `E${coordE.toFixed(2)} N${coordN.toFixed(2)}`,
            originalValue: depthText(depth),
          },
        ),
      );
    }
  }

  return conflicts;
}

// ---------- 修订校验 ----------

export function validateRevisionInput(
  layer: Stratum,
  reason: string,
  newTopDepth: number,
  newBottomDepth: number,
): Conflict[] {
  const conflicts: Conflict[] = [];
  const reasonTrim = reason.trim();

  if (!reasonTrim) {
    conflicts.push({
      ruleId: "S5_REVISION_REASON_REQUIRED",
      ruleLabel: RULE_LABELS.S5_REVISION_REASON_REQUIRED,
      severity: "hard",
      trenchId: "—",
      trenchCode: "—",
      stratumId: layer.id,
      stratumLabel: layerLabel(layer),
      message: "纠错修订必须填写原因，旧版将保留于修订链",
      originalValue: "原因为空",
    });
  }

  if (
    !Number.isFinite(newTopDepth) ||
    !Number.isFinite(newBottomDepth) ||
    newBottomDepth <= newTopDepth
  ) {
    conflicts.push({
      ruleId: "S2_BOTTOM_GT_TOP",
      ruleLabel: RULE_LABELS.S2_BOTTOM_GT_TOP,
      severity: "hard",
      trenchId: "—",
      trenchCode: "—",
      stratumId: layer.id,
      stratumLabel: layerLabel(layer),
      message: `修订值无效：底深 ${depthText(newBottomDepth)} 必须大于顶深 ${depthText(newTopDepth)}`,
      originalValue: `顶${depthText(newTopDepth)} / 底${depthText(newBottomDepth)}`,
    });
  }

  return conflicts;
}

/**
 * 修订通过前的复核：把候选深度套进地层链，检查与上下邻层是否仍然连续。
 * 返回 S1 / S10 类冲突。
 */
export function checkRevisionChain(
  layers: Stratum[],
  target: Stratum,
  candidateTop: number,
  candidateBottom: number,
): Conflict[] {
  // 此处 layers 已按 seq 排序；trench 信息由调用方补不到时用占位
  const conflicts: Conflict[] = [];
  const idx = layers.findIndex((l) => l.id === target.id);
  if (idx < 0) return conflicts;

  const prev = layers[idx - 1];
  const next = layers[idx + 1];

  if (prev) {
    const eff = effectiveLayer(prev);
    if (Math.abs(candidateTop - eff.bottomDepth) > 1e-9) {
      conflicts.push({
        ruleId: "S10_REVISION_BREAKS_CHAIN",
        ruleLabel: RULE_LABELS.S10_REVISION_BREAKS_CHAIN,
        severity: "hard",
        trenchId: "—",
        trenchCode: "—",
        stratumId: target.id,
        stratumLabel: layerLabel(target),
        message: `修订后第${target.seq}层顶深 ${depthText(candidateTop)} 与上层第${prev.seq}层底深 ${depthText(eff.bottomDepth)} 不连续`,
        originalValue: `期望 ${depthText(eff.bottomDepth)}，候选 ${depthText(candidateTop)}`,
      });
    }
  } else if (Math.abs(candidateTop) > 1e-9) {
    conflicts.push({
      ruleId: "S10_REVISION_BREAKS_CHAIN",
      ruleLabel: RULE_LABELS.S10_REVISION_BREAKS_CHAIN,
      severity: "hard",
      trenchId: "—",
      trenchCode: "—",
      stratumId: target.id,
      stratumLabel: layerLabel(target),
      message: `修订后第1层顶深必须为 0.00m，候选 ${depthText(candidateTop)}`,
      originalValue: depthText(candidateTop),
    });
  }

  if (next) {
    const nextEff = effectiveLayer(next);
    if (Math.abs(nextEff.topDepth - candidateBottom) > 1e-9) {
      conflicts.push({
        ruleId: "S10_REVISION_BREAKS_CHAIN",
        ruleLabel: RULE_LABELS.S10_REVISION_BREAKS_CHAIN,
        severity: "hard",
        trenchId: "—",
        trenchCode: "—",
        stratumId: target.id,
        stratumLabel: layerLabel(target),
        message: `修订后第${target.seq}层底深 ${depthText(candidateBottom)} 与下层第${next.seq}层顶深 ${depthText(nextEff.topDepth)} 不连续`,
        originalValue: `下层顶深 ${depthText(nextEff.topDepth)}，候选底深 ${depthText(candidateBottom)}`,
      });
    }
  }

  return conflicts;
}

// ---------- 全量联审：刷新后对整库跑一遍 ----------

export function auditAll(db: Database): Conflict[] {
  const conflicts: Conflict[] = [];

  for (const trench of db.trenches) {
    const layers = sortedStrata(db, trench.id);

    // S3 层号连续性
    layers.forEach((layer, i) => {
      if (layer.seq !== i + 1) {
        conflicts.push(
          makeConflict(
            "S3_LAYER_SEQ_GAP",
            trench,
            `层号断裂：位置${i + 1}上是第${layer.seq}层`,
            {
              stratumId: layer.id,
              stratumLabel: layerLabel(layer),
              originalValue: `第${layer.seq}层`,
            },
          ),
        );
      }
    });

    // S1/S2 深度链（按生效值；进行中的修订不改变生效值，但单独提示）
    layers.forEach((layer, i) => {
      const eff = effectiveLayer(layer);
      if (eff.bottomDepth <= eff.topDepth) {
        conflicts.push(
          makeConflict(
            "S2_BOTTOM_GT_TOP",
            trench,
            `${layerLabel(layer)}底深不大于顶深`,
            {
              stratumId: layer.id,
              stratumLabel: layerLabel(layer),
              originalValue: `顶${depthText(eff.topDepth)} / 底${depthText(eff.bottomDepth)}`,
            },
          ),
        );
      }
      const expectedTop = i === 0 ? 0 : effectiveLayer(layers[i - 1]).bottomDepth;
      if (Math.abs(eff.topDepth - expectedTop) > 1e-9) {
        conflicts.push(
          makeConflict(
            "S1_TOP_EQUALS_PREV_BOTTOM",
            trench,
            `${layerLabel(layer)}顶深 ${depthText(eff.topDepth)} 与${i === 0 ? "地表 0.00m" : `第${layers[i - 1].seq}层底深 ${depthText(expectedTop)}`}不连续`,
            {
              stratumId: layer.id,
              stratumLabel: layerLabel(layer),
              originalValue: `期望 ${depthText(expectedTop)}，实际 ${depthText(eff.topDepth)}`,
            },
          ),
        );
      }

      // 待审修订若现在通过会破坏链 → 软提示，联审时列出
      const pending = layer.revisions.filter((r) => r.status === "pending");
      for (const rev of pending) {
        const chainConflicts = checkRevisionChain(
          layers,
          layer,
          rev.newTopDepth,
          rev.newBottomDepth,
        );
        for (const c of chainConflicts) {
          conflicts.push(
            makeConflict(
              "S10_REVISION_BREAKS_CHAIN",
              trench,
              `待审修订 ${rev.id}：${c.message}`,
              {
                stratumId: layer.id,
                stratumLabel: layerLabel(layer),
                originalValue: c.originalValue,
                severity: "soft",
              },
            ),
          );
        }
      }
    });

    // 出土物：S7/S8/S9
    for (const find of db.finds.filter((f) => f.trenchId === trench.id)) {
      const layer = layers.find((l) => l.id === find.stratumId);
      if (!layer) {
        conflicts.push(
          makeConflict(
            "S7_FIND_STRATUM_REGISTERED",
            trench,
            `出土物「${find.name}」归属的地层不存在，档案悬空`,
            {
              findId: find.id,
              coord: `E${find.coordE.toFixed(2)} N${find.coordN.toFixed(2)}`,
              originalValue: find.stratumId,
            },
          ),
        );
        continue;
      }

      if (
        find.coordE < 0 ||
        find.coordE > trench.sizeE ||
        find.coordN < 0 ||
        find.coordN > trench.sizeN
      ) {
        conflicts.push(
          makeConflict(
            "S8_FIND_WITHIN_BOUNDARY",
            trench,
            `出土物「${find.name}」坐标越界（东西 0–${trench.sizeE}m，南北 0–${trench.sizeN}m）`,
            {
              stratumId: layer.id,
              stratumLabel: layerLabel(layer),
              findId: find.id,
              coord: `E${find.coordE.toFixed(2)} N${find.coordN.toFixed(2)}`,
              originalValue: `边界 0–${trench.sizeE} × 0–${trench.sizeN}`,
            },
          ),
        );
      }

      const eff = effectiveLayer(layer);
      if (
        find.depth < eff.topDepth - 1e-9 ||
        find.depth > eff.bottomDepth + 1e-9
      ) {
        conflicts.push(
          makeConflict(
            "S9_FIND_DEPTH_MATCH",
            trench,
            `出土物「${find.name}」深度 ${depthText(find.depth)} 已不在${layerLabel(layer)}生效区间 ${depthText(eff.topDepth)}–${depthText(eff.bottomDepth)}`,
            {
              stratumId: layer.id,
              stratumLabel: layerLabel(layer),
              findId: find.id,
              coord: `E${find.coordE.toFixed(2)} N${find.coordN.toFixed(2)}`,
              originalValue: depthText(find.depth),
            },
          ),
        );
      }
    }
  }

  // S6 出土物引用了不存在的探方
  for (const find of db.finds) {
    if (!trenchOf(db, find.trenchId)) {
      conflicts.push(
        makeConflict(
          "S6_FIND_TRENCH_EXISTS",
          undefined,
          `出土物「${find.name}」引用的探方已不存在`,
          {
            trenchId: find.trenchId,
            findId: find.id,
            coord: `E${find.coordE.toFixed(2)} N${find.coordN.toFixed(2)}`,
            originalValue: find.trenchId,
          },
        ),
      );
    }
  }

  return dedupeConflicts(conflicts);
}

function dedupeConflicts(conflicts: Conflict[]): Conflict[] {
  const seen = new Set<string>();
  const out: Conflict[] = [];
  for (const c of conflicts) {
    const key = [
      c.ruleId,
      c.trenchId,
      c.stratumId ?? "",
      c.findId ?? "",
      c.originalValue ?? "",
      c.message,
    ].join("|");
    if (!seen.has(key)) {
      seen.add(key);
      out.push(c);
    }
  }
  return out;
}

export function findLabel(find: Find): string {
  return `${find.name}（E${find.coordE.toFixed(2)} N${find.coordN.toFixed(2)} · 深${depthText(find.depth)}）`;
}

import { useSyncExternalStore } from "react";
import type {
  ActionResult,
  Conflict,
  Database,
  Find,
  OperationLog,
  Stratum,
  Trench,
} from "./types";
import {
  RULE_LABELS,
  auditAll,
  checkRevisionChain,
  effectiveLayer,
  layerLabel,
  nowIso,
  sortedStrata,
  uid,
  validateFindInput,
  validateRevisionInput,
  validateStratumInput,
} from "./rules";

const DB_KEY = "hxwl-10.archaeology.db.v1";

// ---------- 种子数据（内置一致样例，便于开箱即审） ----------

function seedDatabase(): Database {
  const db: Database = {
    version: 1,
    savedAt: nowIso(),
    trenches: [],
    strata: [],
    finds: [],
    logs: [],
    seqCounters: { uid: 0 },
  };

  const t1: Trench = {
    id: "tr-0001",
    code: "T0203",
    site: "河西坞遗址",
    sizeE: 5,
    sizeN: 5,
    createdAt: nowIso(),
  };
  const t2: Trench = {
    id: "tr-0002",
    code: "T0204",
    site: "河西坞遗址",
    sizeE: 5,
    sizeN: 5,
    createdAt: nowIso(),
  };
  db.trenches.push(t1, t2);

  const mkLayer = (
    trenchId: string,
    seq: number,
    color: string,
    top: number,
    bottom: number,
    status: Stratum["status"],
  ): Stratum => ({
    id: uid("lay", db),
    trenchId,
    seq,
    soilColor: color,
    topDepth: top,
    bottomDepth: bottom,
    status,
    registeredAt: nowIso(),
    confirmedAt: status === "confirmed" ? nowIso() : undefined,
    revisions: [],
  });

  const l1 = mkLayer(t1.id, 1, "浅灰土（耕土）", 0, 0.4, "confirmed");
  const l2 = mkLayer(t1.id, 2, "灰褐土", 0.4, 1.1, "confirmed");
  const l3 = mkLayer(t1.id, 3, "黄褐土", 1.1, 1.8, "draft");
  db.strata.push(l1, l2, l3);

  const k1 = mkLayer(t2.id, 1, "黑褐土（夹炭屑）", 0, 0.55, "confirmed");
  db.strata.push(k1);

  const f1: Find = {
    id: uid("fnd", db),
    trenchId: t1.id,
    stratumId: l2.id,
    name: "夹砂陶片",
    coordE: 3,
    coordN: 4,
    depth: 0.75,
    registeredAt: nowIso(),
  };
  const f2: Find = {
    id: uid("fnd", db),
    trenchId: t2.id,
    stratumId: k1.id,
    name: "动物骨碎片",
    coordE: 1.2,
    coordN: 2.4,
    depth: 0.4,
    registeredAt: nowIso(),
  };
  db.finds.push(f1, f2);

  log(db, "初始化", "档案库", "success", "已载入内置一致样例：2 个探方、4 条地层、2 件出土物");
  return db;
}

function log(
  db: Database,
  action: string,
  target: string,
  outcome: OperationLog["outcome"],
  detail: string,
  ruleId?: OperationLog["ruleId"],
): void {
  db.logs.unshift({
    id: uid("log", db),
    at: nowIso(),
    action,
    target,
    outcome,
    detail,
    ruleId,
  });
  if (db.logs.length > 200) db.logs.length = 200;
}

// ---------- 持久化 ----------

let db: Database = load();
const listeners = new Set<() => void>();

function load(): Database {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Database;
      if (parsed && parsed.version === 1 && Array.isArray(parsed.trenches)) {
        return parsed;
      }
    }
  } catch {
    // 落盘损坏时回退到种子
  }
  return seedDatabase();
}

function persist(): void {
  db.savedAt = nowIso();
  localStorage.setItem(DB_KEY, JSON.stringify(db));
  listeners.forEach((fn) => fn());
}

export function getDB(): Database {
  return db;
}

export function conflicts(): Conflict[] {
  return auditAll(db);
}

function commit(): void {
  persist();
}

function blocked(target: string, action: string, conflicts: Conflict[]): ActionResult {
  const first = conflicts[0];
  log(db, action, target, "blocked", first?.message ?? "校验未通过", first?.ruleId);
  commit();
  return { ok: false, conflicts };
}

// ---------- 操作 ----------

export function addTrench(input: {
  code: string;
  site: string;
  sizeE: number;
  sizeN: number;
}): ActionResult {
  const code = input.code.trim();
  const errs: Conflict[] = [];
  if (!code) {
    errs.push({
      ruleId: "S6_FIND_TRENCH_EXISTS",
      ruleLabel: RULE_LABELS.S6_FIND_TRENCH_EXISTS,
      severity: "hard",
      trenchId: "—",
      trenchCode: code || "空编号",
      message: "探方编号不能为空",
    });
  }
  if (
    !Number.isFinite(input.sizeE) ||
    !Number.isFinite(input.sizeN) ||
    input.sizeE <= 0 ||
    input.sizeN <= 0
  ) {
    errs.push({
      ruleId: "S8_FIND_WITHIN_BOUNDARY",
      ruleLabel: RULE_LABELS.S8_FIND_WITHIN_BOUNDARY,
      severity: "hard",
      trenchId: "—",
      trenchCode: code || "—",
      message: "探方长宽必须为正数",
      originalValue: `东西${input.sizeE}m × 南北${input.sizeN}m`,
    });
  }
  if (db.trenches.some((t) => t.code === code)) {
    errs.push({
      ruleId: "S6_FIND_TRENCH_EXISTS",
      ruleLabel: RULE_LABELS.S6_FIND_TRENCH_EXISTS,
      severity: "hard",
      trenchId: "—",
      trenchCode: code,
      message: `探方编号 ${code} 已存在`,
      originalValue: code,
    });
  }
  if (errs.length) return blocked(code || "新探方", "新建探方", errs);

  const trench: Trench = {
    id: uid("tr", db),
    code,
    site: input.site.trim() || "未填写遗址",
    sizeE: input.sizeE,
    sizeN: input.sizeN,
    createdAt: nowIso(),
  };
  db.trenches.push(trench);
  log(db, "新建探方", code, "success", `开口 ${input.sizeE}m × ${input.sizeN}m`);
  commit();
  return { ok: true, conflicts: [] };
}

export function registerStratum(input: {
  trenchId: string;
  soilColor: string;
  topDepth: number;
  bottomDepth: number;
}): ActionResult {
  const trench = db.trenches.find((t) => t.id === input.trenchId);
  if (!trench) {
    return blocked("未知探方", "登记地层", [
      {
        ruleId: "S6_FIND_TRENCH_EXISTS",
        ruleLabel: RULE_LABELS.S6_FIND_TRENCH_EXISTS,
        severity: "hard",
        trenchId: input.trenchId,
        trenchCode: "未知探方",
        message: "探方不存在",
      },
    ]);
  }

  const layers = sortedStrata(db, trench.id);
  const seq = layers.length + 1;
  const errs = validateStratumInput(
    db,
    trench.id,
    seq,
    input.topDepth,
    input.bottomDepth,
  );
  if (errs.length) return blocked(`${trench.code} 第${seq}层`, "登记地层", errs);

  const layer: Stratum = {
    id: uid("lay", db),
    trenchId: trench.id,
    seq,
    soilColor: input.soilColor.trim() || "未描述土色",
    topDepth: input.topDepth,
    bottomDepth: input.bottomDepth,
    status: "draft",
    registeredAt: nowIso(),
    revisions: [],
  };
  db.strata.push(layer);
  log(
    db,
    "登记地层",
    `${trench.code} ${layerLabel(layer)}`,
    "success",
    `${layer.soilColor}，${input.topDepth.toFixed(2)}–${input.bottomDepth.toFixed(2)}m（草稿）`,
  );
  commit();
  return { ok: true, conflicts: [] };
}

export function confirmStratum(layerId: string): ActionResult {
  const layer = db.strata.find((s) => s.id === layerId);
  const trench = layer ? db.trenches.find((t) => t.id === layer.trenchId) : undefined;
  if (!layer || !trench) return { ok: false, conflicts: [] };

  if (layer.status === "confirmed") {
    return blocked(`${trench.code} ${layerLabel(layer)}`, "确认地层", [
      {
        ruleId: "S4_LAYER_FROZEN",
        ruleLabel: RULE_LABELS.S4_LAYER_FROZEN,
        severity: "hard",
        trenchId: trench.id,
        trenchCode: trench.code,
        stratumId: layer.id,
        stratumLabel: layerLabel(layer),
        message: "地层已确认并冻结，不能重复确认；如需纠错请发起修订",
      },
    ]);
  }

  if (layer.status === "revising") {
    return blocked(`${trench.code} ${layerLabel(layer)}`, "确认地层", [
      {
        ruleId: "S4_LAYER_FROZEN",
        ruleLabel: RULE_LABELS.S4_LAYER_FROZEN,
        severity: "hard",
        trenchId: trench.id,
        trenchCode: trench.code,
        stratumId: layer.id,
        stratumLabel: layerLabel(layer),
        message: "修订尚未审结，不能再次确认",
      },
    ]);
  }

  layer.status = "confirmed";
  layer.confirmedAt = nowIso();
  log(db, "确认冻结", `${trench.code} ${layerLabel(layer)}`, "success", "地层已冻结，后续纠错须走修订链");
  commit();
  return { ok: true, conflicts: [] };
}

export function startRevision(input: {
  layerId: string;
  reason: string;
  newSoilColor: string;
  newTopDepth: number;
  newBottomDepth: number;
}): ActionResult {
  const layer = db.strata.find((s) => s.id === input.layerId);
  const trench = layer ? db.trenches.find((t) => t.id === layer.trenchId) : undefined;
  if (!layer || !trench) return { ok: false, conflicts: [] };

  const target = `${trench.code} ${layerLabel(layer)}`;

  if (layer.status !== "confirmed") {
    return blocked(target, "发起修订", [
      {
        ruleId: "S4_LAYER_FROZEN",
        ruleLabel: RULE_LABELS.S4_LAYER_FROZEN,
        severity: "hard",
        trenchId: trench.id,
        trenchCode: trench.code,
        stratumId: layer.id,
        stratumLabel: layerLabel(layer),
        message: layer.status === "draft"
          ? "草稿地层可直接编辑删除，无需发起修订"
          : "该地层已有进行中的修订，请先审结",
      },
    ]);
  }

  const errs = validateRevisionInput(
    layer,
    input.reason,
    input.newTopDepth,
    input.newBottomDepth,
  ).map((c) => ({ ...c, trenchId: trench.id, trenchCode: trench.code }));

  // 链复核（候选值此刻即给出，不通过则不予立案）
  const layers = sortedStrata(db, trench.id);
  const chainErrs = checkRevisionChain(
    layers,
    layer,
    input.newTopDepth,
    input.newBottomDepth,
  ).map((c) => ({ ...c, trenchId: trench.id, trenchCode: trench.code }));

  const all = [...errs, ...chainErrs];
  if (all.length) return blocked(target, "发起修订", all);

  const eff = effectiveLayer(layer);
  layer.revisions.push({
    id: uid("rev", db),
    createdAt: nowIso(),
    reason: input.reason.trim(),
    oldSoilColor: eff.soilColor,
    oldTopDepth: eff.topDepth,
    oldBottomDepth: eff.bottomDepth,
    newSoilColor: input.newSoilColor.trim() || eff.soilColor,
    newTopDepth: input.newTopDepth,
    newBottomDepth: input.newBottomDepth,
    status: "pending",
  });
  layer.status = "revising";
  log(
    db,
    "发起修订",
    target,
    "success",
    `原因：${input.reason.trim()}；候选 ${input.newTopDepth.toFixed(2)}–${input.newBottomDepth.toFixed(2)}m，旧版已快照保留`,
  );
  commit();
  return { ok: true, conflicts: [] };
}

export function decideRevision(
  layerId: string,
  revisionId: string,
  approve: boolean,
): ActionResult {
  const layer = db.strata.find((s) => s.id === layerId);
  const trench = layer ? db.trenches.find((t) => t.id === layer.trenchId) : undefined;
  const rev = layer?.revisions.find((r) => r.id === revisionId);
  if (!layer || !trench || !rev) return { ok: false, conflicts: [] };
  const target = `${trench.code} ${layerLabel(layer)} / ${rev.id}`;

  if (rev.status !== "pending") {
    return blocked(target, approve ? "通过修订" : "撤回修订", [
      {
        ruleId: "S4_LAYER_FROZEN",
        ruleLabel: RULE_LABELS.S4_LAYER_FROZEN,
        severity: "hard",
        trenchId: trench.id,
        trenchCode: trench.code,
        stratumId: layer.id,
        stratumLabel: layerLabel(layer),
        message: "该修订已审结，不能重复操作",
      },
    ]);
  }

  if (!approve) {
    rev.status = "withdrawn";
    rev.decidedAt = nowIso();
    layer.status = "confirmed";
    log(db, "撤回修订", target, "success", `修订被撤回，冻结值恢复生效（${rev.oldTopDepth.toFixed(2)}–${rev.oldBottomDepth.toFixed(2)}m），旧版仍保留`);
    commit();
    return { ok: true, conflicts: [] };
  }

  // 通过前再次链复核（防止等待期间邻层发生变化）
  const layers = sortedStrata(db, trench.id);
  const chainErrs = checkRevisionChain(layers, layer, rev.newTopDepth, rev.newBottomDepth);
  if (chainErrs.length) {
    return blocked(
      target,
      "通过修订",
      chainErrs.map((c) => ({ ...c, trenchId: trench.id, trenchCode: trench.code })),
    );
  }

  rev.status = "approved";
  rev.decidedAt = nowIso();
  layer.soilColor = rev.newSoilColor;
  layer.topDepth = rev.newTopDepth;
  layer.bottomDepth = rev.newBottomDepth;
  layer.status = "confirmed";
  log(
    db,
    "通过修订",
    target,
    "success",
    `新值生效 ${rev.newTopDepth.toFixed(2)}–${rev.newBottomDepth.toFixed(2)}m；旧版 ${rev.oldTopDepth.toFixed(2)}–${rev.oldBottomDepth.toFixed(2)}m 留存修订链；请联审已登记出土物`,
  );
  commit();

  // 修订生效后出土物可能越出新区间 —— 不阻断，但把冲突出给调用方展示
  return { ok: true, conflicts: auditAll(db) };
}

export function registerFind(input: {
  trenchId: string;
  stratumId: string;
  name: string;
  coordE: number;
  coordN: number;
  depth: number;
}): ActionResult {
  const trench = db.trenches.find((t) => t.id === input.trenchId);
  const layer = db.strata.find((s) => s.id === input.stratumId);
  const errs = validateFindInput(
    db,
    input.trenchId,
    input.stratumId,
    input.coordE,
    input.coordN,
    input.depth,
  );
  if (errs.length) {
    return blocked(
      `${trench?.code ?? "未知探方"} / ${input.name || "未命名出土物"}`,
      "出土物入档",
      errs,
    );
  }

  const find: Find = {
    id: uid("fnd", db),
    trenchId: input.trenchId,
    stratumId: input.stratumId!,
    name: input.name.trim() || "未命名出土物",
    coordE: input.coordE,
    coordN: input.coordN,
    depth: input.depth,
    registeredAt: nowIso(),
  };
  db.finds.push(find);
  log(
    db,
    "出土物入档",
    `${trench!.code} / ${find.name}`,
    "success",
    `归入${layerLabel(layer!)}，E${input.coordE.toFixed(2)} N${input.coordN.toFixed(2)}，深${input.depth.toFixed(2)}m`,
  );
  commit();
  return { ok: true, conflicts: [] };
}

export function deleteDraftStratum(layerId: string): ActionResult {
  const layer = db.strata.find((s) => s.id === layerId);
  const trench = layer ? db.trenches.find((t) => t.id === layer.trenchId) : undefined;
  if (!layer || !trench) return { ok: false, conflicts: [] };

  if (layer.status !== "draft") {
    return blocked(`${trench.code} ${layerLabel(layer)}`, "删除地层", [
      {
        ruleId: "S4_LAYER_FROZEN",
        ruleLabel: RULE_LABELS.S4_LAYER_FROZEN,
        severity: "hard",
        trenchId: trench.id,
        trenchCode: trench.code,
        stratumId: layer.id,
        stratumLabel: layerLabel(layer),
        message: "地层已确认冻结，不能删除；纠错只能发起带原因的修订",
      },
    ]);
  }

  // 草稿只允许删除“最后一层”，否则会造成层号缺口
  const layers = sortedStrata(db, trench.id);
  if (layers[layers.length - 1].id !== layer.id) {
    return blocked(`${trench.code} ${layerLabel(layer)}`, "删除地层", [
      {
        ruleId: "S3_LAYER_SEQ_GAP",
        ruleLabel: RULE_LABELS.S3_LAYER_SEQ_GAP,
        severity: "hard",
        trenchId: trench.id,
        trenchCode: trench.code,
        stratumId: layer.id,
        stratumLabel: layerLabel(layer),
        message: "只能从最新登记的草稿层开始删除，避免层号断裂",
      },
    ]);
  }

  db.strata = db.strata.filter((s) => s.id !== layerId);
  log(db, "删除草稿", `${trench.code} ${layerLabel(layer)}`, "success", "确认前的草稿已删除，不留修订链");
  commit();
  return { ok: true, conflicts: [] };
}

export function resetToSeed(): void {
  db = seedDatabase();
  persist();
}

export function clearDatabase(): void {
  db = {
    version: 1,
    savedAt: nowIso(),
    trenches: [],
    strata: [],
    finds: [],
    logs: [],
    seqCounters: { uid: 0 },
  };
  log(db, "清空", "档案库", "success", "全部探方、地层、出土物与修订链已清空");
  commit();
}

export function exportJSON(): string {
  return JSON.stringify(db, null, 2);
}

export function importJSON(text: string): ActionResult {
  let parsed: Database;
  try {
    parsed = JSON.parse(text) as Database;
  } catch {
    return blocked("导入文件", "导入档案", [
      {
        ruleId: "S6_FIND_TRENCH_EXISTS",
        ruleLabel: RULE_LABELS.S6_FIND_TRENCH_EXISTS,
        severity: "hard",
        trenchId: "—",
        trenchCode: "—",
        message: "JSON 无法解析，导入中止，当前档案未改动",
      },
    ]);
  }

  if (
    !parsed ||
    parsed.version !== 1 ||
    !Array.isArray(parsed.trenches) ||
    !Array.isArray(parsed.strata) ||
    !Array.isArray(parsed.finds)
  ) {
    return blocked("导入文件", "导入档案", [
      {
        ruleId: "S6_FIND_TRENCH_EXISTS",
        ruleLabel: RULE_LABELS.S6_FIND_TRENCH_EXISTS,
        severity: "hard",
        trenchId: "—",
        trenchCode: "—",
        message: "文件结构不符合 v1 档案格式，导入中止",
      },
    ]);
  }

  parsed.logs = Array.isArray(parsed.logs) ? parsed.logs : [];
  parsed.seqCounters = parsed.seqCounters ?? { uid: 0 };
  db = parsed;
  const found = auditAll(db);
  log(
    db,
    "导入档案",
    "JSON 文件",
    found.length ? "success" : "success",
    `导入完成：${db.trenches.length} 探方 / ${db.strata.length} 地层 / ${db.finds.length} 出土物；联审发现 ${found.length} 条冲突`,
  );
  commit();
  return { ok: true, conflicts: found };
}

// ---------- React 绑定 ----------

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useDB(): Database {
  return useSyncExternalStore(subscribe, () => db);
}

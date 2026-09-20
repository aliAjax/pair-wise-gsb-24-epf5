import { buildSeedState } from "../src/seed";
import {
  auditState,
  layersOf,
  validateArtifact,
  validateConfirm,
  validateLayer,
  validateRevision,
} from "../src/rules";
import { isValidPersisted } from "../src/storage";

let failures = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    console.log(`PASS ${name}`);
  } else {
    failures += 1;
    console.error(`FAIL ${name}`);
  }
}

const state = buildSeedState();

// 1. 种子档案自身一致
check("种子档案全量复核无冲突", auditState(state).length === 0);

const t0203 = state.squares.find((s) => s.code === "T0203")!;
const t0204 = state.squares.find((s) => s.code === "T0204")!;
const t0204Layers = layersOf(state, t0204.id);
const lastT0204 = t0204Layers[t0204Layers.length - 1];

// 2. R2：顶深不等于前一层底深 → 拦截
const r2 = validateLayer(state, t0204, {
  label: "第3层",
  soilColor: "夯土",
  topDepth: 0.5,
  bottomDepth: 1.2,
  note: "",
});
check("R2 拦截断续地层", !r2.ok && r2.conflicts.some((c) => c.rule.includes("R2")));
check("R2 冲突列出探方/地层/原值", !r2.ok && r2.conflicts[0].squareCode === "T0204" && r2.conflicts[0].original.includes("0.9"));

// 3. R2 通过：顶深接续 0.9
const r2ok = validateLayer(state, t0204, {
  label: "第3层",
  soilColor: "夯土",
  topDepth: 0.9,
  bottomDepth: 1.2,
  note: "",
});
check("R2 放行连续地层", r2ok.ok);

// 4. R1：坐标越界 → 拦截
const r1 = validateArtifact(state, t0204, {
  layerId: lastT0204.id,
  name: "陶片",
  featureType: "灰坑",
  x: 6.5,
  y: 2,
  depth: 0.5,
  quantity: 1,
  note: "",
});
check("R1 拦截越界坐标", !r1.ok && r1.conflicts.some((c) => c.rule.includes("R1")));
check("R1 冲突列出坐标与原边界", !r1.ok && r1.conflicts[0].coord.includes("E6.5") && r1.conflicts[0].original.includes("[0,5]"));

// 5. R4：深度不在地层区间 → 拦截
const r4 = validateArtifact(state, t0204, {
  layerId: lastT0204.id,
  name: "陶片",
  featureType: "灰坑",
  x: 2,
  y: 2,
  depth: 0.1,
  quantity: 1,
  note: "",
});
check("R4 拦截深度不符", !r4.ok && r4.conflicts.some((c) => c.rule.includes("R4")));

// 6. R3：归入未登记地层 → 拦截
const r3 = validateArtifact(state, t0204, {
  layerId: "L-不存在",
  name: "陶片",
  featureType: "灰坑",
  x: 2,
  y: 2,
  depth: 0.5,
  quantity: 1,
  note: "",
});
check("R3 拦截未登记地层", !r3.ok && r3.conflicts.some((c) => c.rule.includes("R3")));

// 7. R5：已确认探方禁止直接登记地层
const r5 = validateLayer(state, t0203, {
  label: "第4层",
  soilColor: "夯土",
  topDepth: 1.4,
  bottomDepth: 1.8,
  note: "",
});
check("R5 拦截冻结后登记", !r5.ok && r5.conflicts.some((c) => c.rule.includes("R5")));

// 8. R6：修订必须填原因
const l2 = layersOf(state, t0203.id)[1];
const r6 = validateRevision(
  state,
  t0203,
  l2.id,
  { label: l2.label, soilColor: "红褐土", topDepth: l2.topDepth, bottomDepth: l2.bottomDepth, note: l2.note },
  "  "
);
check("R6 拦截无原因修订", !r6.ok && r6.conflicts.some((c) => c.rule.includes("R6")));

// 9. 修订保持链一致：改中间层底深 → R2
const rChain = validateRevision(
  state,
  t0203,
  l2.id,
  { label: l2.label, soilColor: l2.soilColor, topDepth: l2.topDepth, bottomDepth: 0.9, note: l2.note },
  "测试链断裂"
);
check("修订破坏链连续被拦截", !rChain.ok && rChain.conflicts.some((c) => c.rule.includes("R2")));

// 10. 修订使已入档出土物深度越界 → R4
const l3 = layersOf(state, t0203.id)[2];
const rOrphan = validateRevision(
  state,
  t0203,
  l3.id,
  { label: l3.label, soilColor: l3.soilColor, topDepth: l3.topDepth, bottomDepth: 0.95, note: l3.note },
  "测试出土物越界"
);
check("修订致出土物越界被拦截", !rOrphan.ok && rOrphan.conflicts.some((c) => c.rule.includes("R4")));

// 11. 合法修订：末层底深下延，旧版保留
const rOk = validateRevision(
  state,
  t0203,
  l3.id,
  { label: l3.label, soilColor: l3.soilColor, topDepth: l3.topDepth, bottomDepth: 1.6, note: l3.note },
  "发掘推进，第3层底界下延"
);
check("合法修订通过", rOk.ok);
if (rOk.ok) {
  const next = { ...state, layers: rOk.value!.layers, revisions: [...state.revisions, rOk.value!.revision] };
  check("修订后旧版留档", next.revisions.some((r) => r.before.bottomDepth === 1.4 && r.after.bottomDepth === 1.6));
  check("修订后全量复核无冲突", auditState(next).length === 0);
}

// 12. 已确认探方重复确认前的整链复核（confirm 校验器本身可用）
const again = validateConfirm(state, t0204);
check("登记中探方可确认", again.ok && again.value!.status === "confirmed");

// 13. 持久化往返：序列化→解析→校验→复核
const roundTrip: unknown = JSON.parse(JSON.stringify(state));
check("落盘数据可回读", isValidPersisted(roundTrip));
check("回读后复核无冲突", isValidPersisted(roundTrip) && auditState(roundTrip).length === 0);

console.log(failures === 0 ? "ALL TESTS PASSED" : `${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);

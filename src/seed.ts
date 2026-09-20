import type { Layer, PersistedState, Square } from "./types";
import {
  validateArtifact,
  validateConfirm,
  validateLayer,
  validateRevision,
  type RuleResult,
} from "./rules";

function must<T>(result: RuleResult<T>, what: string): T {
  if (!result.ok || result.value === undefined) {
    throw new Error(`种子数据构建失败: ${what}`);
  }
  return result.value;
}

/**
 * 种子数据全部经由规则引擎登记，保证初始档案本身满足全部约束：
 * 地层链连续、出土物在界内且深度相符、冻结后纠错走修订并保留旧版。
 */
export function buildSeedState(): PersistedState {
  const state: PersistedState = {
    version: 1,
    squares: [],
    layers: [],
    artifacts: [],
    revisions: [],
  };

  const t0203: Square = {
    id: "SQ-T0203",
    code: "T0203",
    site: "河湾遗址",
    xMin: 0,
    xMax: 5,
    yMin: 0,
    yMax: 5,
    surfaceDepth: 0,
    status: "draft",
    createdAt: Date.now() - 86400000 * 3,
  };
  const t0204: Square = {
    id: "SQ-T0204",
    code: "T0204",
    site: "河湾遗址",
    xMin: 0,
    xMax: 5,
    yMin: 0,
    yMax: 5,
    surfaceDepth: 0,
    status: "draft",
    createdAt: Date.now() - 86400000 * 2,
  };
  state.squares.push(t0203, t0204);

  // —— T0203：连续登记三层 ——
  const l1: Layer = must(
    validateLayer(state, t0203, {
      label: "第1层",
      soilColor: "灰褐土",
      topDepth: 0,
      bottomDepth: 0.35,
      note: "耕土层，含现代杂物",
    }),
    "T0203 第1层"
  );
  state.layers.push(l1);

  const l2: Layer = must(
    validateLayer(state, t0203, {
      label: "第2层",
      soilColor: "黄褐土",
      topDepth: 0.35,
      bottomDepth: 0.8,
      note: "夹杂炭屑",
    }),
    "T0203 第2层"
  );
  state.layers.push(l2);

  const l3: Layer = must(
    validateLayer(state, t0203, {
      label: "第3层",
      soilColor: "黑褐土",
      topDepth: 0.8,
      bottomDepth: 1.4,
      note: "致密，见动物骨骼",
    }),
    "T0203 第3层"
  );
  state.layers.push(l3);

  // —— T0203：出土物入档（界内、深度与所属地层相符） ——
  state.artifacts.push(
    must(
      validateArtifact(state, t0203, {
        layerId: l2.id,
        name: "陶片12件",
        featureType: "灰坑",
        x: 3.2,
        y: 4.1,
        depth: 0.5,
        quantity: 12,
        note: "夹砂红陶",
      }),
      "T0203 陶片"
    )
  );
  state.artifacts.push(
    must(
      validateArtifact(state, t0203, {
        layerId: l3.id,
        name: "兽骨1件",
        featureType: "灰坑",
        x: 1.5,
        y: 2.0,
        depth: 1.0,
        quantity: 1,
        note: "疑似牛骨",
      }),
      "T0203 兽骨"
    )
  );

  // —— T0203：联审确认，地层冻结 ——
  const confirmed = must(validateConfirm(state, t0203), "T0203 确认");
  state.squares = state.squares.map((square) => (square.id === t0203.id ? confirmed : square));

  // —— 冻结后纠错：第2层土色更正，新建带原因修订，旧版保留 ——
  const revised = must(
    validateRevision(
      state,
      confirmed,
      l2.id,
      {
        label: l2.label,
        soilColor: "红褐土",
        topDepth: l2.topDepth,
        bottomDepth: l2.bottomDepth,
        note: l2.note,
      },
      "室内土色比对后更正第2层土色（黄褐土→红褐土）"
    ),
    "T0203 第2层修订"
  );
  state.layers = revised.layers;
  state.revisions.push(revised.revision);

  // —— T0204：登记中探方，两层 ——
  const t1: Layer = must(
    validateLayer(state, t0204, {
      label: "第1层",
      soilColor: "灰褐土",
      topDepth: 0,
      bottomDepth: 0.3,
      note: "耕土层",
    }),
    "T0204 第1层"
  );
  state.layers.push(t1);

  const t2: Layer = must(
    validateLayer(state, t0204, {
      label: "第2层",
      soilColor: "青灰土",
      topDepth: 0.3,
      bottomDepth: 0.9,
      note: "H12灰坑开口于此层",
    }),
    "T0204 第2层"
  );
  state.layers.push(t2);

  state.artifacts.push(
    must(
      validateArtifact(state, t0204, {
        layerId: t2.id,
        name: "陶片5件",
        featureType: "灰坑",
        x: 2.0,
        y: 3.0,
        depth: 0.6,
        quantity: 5,
        note: "H12内出土",
      }),
      "T0204 陶片"
    )
  );

  return state;
}

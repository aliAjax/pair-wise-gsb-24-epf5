// 地层与出土物联审闭环 —— 数据模型

export type RuleId =
  | "S1_TOP_EQUALS_PREV_BOTTOM" // 后一层顶深必须等于前一层底深
  | "S2_BOTTOM_GT_TOP" // 底深必须大于顶深
  | "S3_LAYER_SEQ_GAP" // 层位序列必须连续
  | "S4_LAYER_FROZEN" // 地层确认后冻结，禁止直接改写
  | "S5_REVISION_REASON_REQUIRED" // 纠错修订必须填写原因
  | "S6_FIND_TRENCH_EXISTS" // 出土物必须归属有效探方
  | "S7_FIND_STRATUM_REGISTERED" // 出土物只能归入已登记地层
  | "S8_FIND_WITHIN_BOUNDARY" // 坐标不得超出探方边界
  | "S9_FIND_DEPTH_MATCH" // 出土深度必须与所属地层深度相符
  | "S10_REVISION_BREAKS_CHAIN"; // 修订不得破坏地层连续链

export type LayerStatus = "draft" | "confirmed" | "revising";

export interface Revision {
  id: string;
  createdAt: string;
  reason: string;
  // 旧版快照（修订发起时的已确认值，永久保留）
  oldSoilColor: string;
  oldTopDepth: number;
  oldBottomDepth: number;
  // 新版候选值
  newSoilColor: string;
  newTopDepth: number;
  newBottomDepth: number;
  status: "pending" | "approved" | "withdrawn";
  decidedAt?: string;
}

export interface Stratum {
  id: string;
  trenchId: string;
  seq: number; // 自上而下连续编号，从 1 开始
  soilColor: string;
  topDepth: number; // 顶深（距地表，米）
  bottomDepth: number; // 底深（距地表，米）
  status: LayerStatus;
  registeredAt: string;
  confirmedAt?: string;
  revisions: Revision[];
}

export interface Find {
  id: string;
  trenchId: string;
  stratumId: string;
  name: string;
  coordE: number; // 探方局部坐标东向（米）
  coordN: number; // 探方局部坐标北向（米）
  depth: number; // 出土深度（距地表，米）
  registeredAt: string;
}

export interface Trench {
  id: string;
  code: string; // 探方编号，如 T0203
  site: string; // 遗址
  sizeE: number; // 东西宽（米）
  sizeN: number; // 南北长（米）
  createdAt: string;
}

export interface OperationLog {
  id: string;
  at: string;
  action: string;
  target: string;
  outcome: "success" | "blocked";
  detail: string;
  ruleId?: RuleId;
}

export interface Conflict {
  ruleId: RuleId;
  ruleLabel: string;
  severity: "hard" | "soft";
  trenchId: string;
  trenchCode: string;
  stratumId?: string;
  stratumLabel?: string;
  findId?: string;
  coord?: string;
  originalValue?: string;
  message: string;
}

export interface Database {
  version: 1;
  savedAt: string;
  trenches: Trench[];
  strata: Stratum[];
  finds: Find[];
  logs: OperationLog[];
  seqCounters: { uid: number };
}

export interface ActionResult {
  ok: boolean;
  conflicts: Conflict[];
}

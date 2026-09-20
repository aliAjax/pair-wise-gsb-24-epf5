export type SoilColor = "灰褐土" | "黄褐土" | "黑褐土" | "红褐土" | "青灰土" | "夯土";

export type FeatureType = "灰坑" | "墓葬" | "房址" | "沟状遗迹";

export type SquareStatus = "draft" | "confirmed";

export interface Square {
  id: string;
  code: string;
  site: string;
  /** 探方边界（米），西南角原点 */
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  /** 地表起算深度（米） */
  surfaceDepth: number;
  status: SquareStatus;
  createdAt: number;
}

export interface Layer {
  id: string;
  squareId: string;
  seq: number;
  label: string;
  soilColor: SoilColor;
  /** 顶深（米，自地表起算） */
  topDepth: number;
  /** 底深（米） */
  bottomDepth: number;
  note: string;
  createdAt: number;
}

export interface Artifact {
  id: string;
  squareId: string;
  layerId: string;
  name: string;
  featureType: FeatureType;
  x: number;
  y: number;
  /** 出土深度（米，自地表起算） */
  depth: number;
  quantity: number;
  note: string;
  createdAt: number;
}

export interface Revision {
  id: string;
  squareId: string;
  layerId: string;
  reason: string;
  before: Layer;
  after: Layer;
  createdAt: number;
}

export interface Conflict {
  id: string;
  squareCode: string;
  layerLabel: string;
  coord: string;
  field: string;
  original: string;
  incoming: string;
  rule: string;
}

export interface PersistedState {
  version: 1;
  squares: Square[];
  layers: Layer[];
  artifacts: Artifact[];
  revisions: Revision[];
}

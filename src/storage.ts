import type { Artifact, Layer, PersistedState, Square } from "./types";

const STORAGE_KEY = "hxwl-10:archive:v1";

const SOILS: Layer["soilColor"][] = ["灰褐土", "黄褐土", "黑褐土", "红褐土", "青灰土", "夯土"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

export function isValidSquare(value: unknown): value is Square {
  if (!isRecord(value)) return false;
  return (
    isString(value.id) &&
    isString(value.code) &&
    isString(value.site) &&
    isFiniteNumber(value.xMin) &&
    isFiniteNumber(value.xMax) &&
    isFiniteNumber(value.yMin) &&
    isFiniteNumber(value.yMax) &&
    isFiniteNumber(value.surfaceDepth) &&
    value.xMin < value.xMax &&
    value.yMin < value.yMax &&
    (value.status === "draft" || value.status === "confirmed") &&
    isFiniteNumber(value.createdAt)
  );
}

export function isValidLayer(value: unknown): value is Layer {
  if (!isRecord(value)) return false;
  return (
    isString(value.id) &&
    isString(value.squareId) &&
    isFiniteNumber(value.seq) &&
    isString(value.label) &&
    SOILS.includes(value.soilColor as Layer["soilColor"]) &&
    isFiniteNumber(value.topDepth) &&
    isFiniteNumber(value.bottomDepth) &&
    value.topDepth < value.bottomDepth &&
    typeof value.note === "string" &&
    isFiniteNumber(value.createdAt)
  );
}

export function isValidArtifact(value: unknown): value is Artifact {
  if (!isRecord(value)) return false;
  return (
    isString(value.id) &&
    isString(value.squareId) &&
    isString(value.layerId) &&
    isString(value.name) &&
    isString(value.featureType) &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    isFiniteNumber(value.depth) &&
    isFiniteNumber(value.quantity) &&
    typeof value.note === "string" &&
    isFiniteNumber(value.createdAt)
  );
}

export function isValidPersisted(value: unknown): value is PersistedState {
  if (!isRecord(value)) return false;
  return (
    value.version === 1 &&
    Array.isArray(value.squares) &&
    Array.isArray(value.layers) &&
    Array.isArray(value.artifacts) &&
    Array.isArray(value.revisions)
  );
}

export function loadState(): PersistedState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isValidPersisted(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveState(state: PersistedState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function exportState(state: PersistedState): void {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `hxwl-10-archive-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function parseImport(text: string): PersistedState | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return isValidPersisted(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

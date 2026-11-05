// Dev/E2E-only fps badge (?stats=1): pure helpers. The badge itself is
// ui/StatsBadge.tsx; it is only mounted when the dev/E2E guard of the app
// holds, so production builds never show it.

/** What the badge shows. */
export interface StatsSample {
  fps: number;
  frameMs: number;
  p95Ms: number;
  drawCalls: number;
  triangles: number;
  /** JS heap in bytes; null where the browser does not expose it (Safari, Firefox). */
  heapBytes: number | null;
  /** The level of detail; null before the camera is placed on the world (no level yet). */
  lod: string | null;
  detail: string;
  /** Island build steps waiting (the incremental build, display/buildqueue.ts). */
  queue: number;
  /** The longest frame of the last second (ms): build hitches. */
  maxMs: number;
  /** Life instances and particles drawn in the last frame (null: the life layer is off, ?life=0). */
  life: { instances: number; particles: number } | null;
  /** The building models in view (any order; the badge lists the top MODEL_ROWS by triangles). */
  models?: ModelRow[];
}

/** One building model in view: content ID, voxels per tile, triangles of all its instances and their count. */
export interface ModelRow {
  id: string;
  voxelsPerTile: number;
  triangles: number;
  count: number;
}

/** How many models the badge lists. */
export const MODEL_ROWS = 10;

/** The top models by total triangles, one line each: "apiary 12 vpt  21.3k tris (3 × 7.1k)". */
export function modelLines(models: readonly ModelRow[]): string[] {
  return [...models]
    .sort((a, b) => b.triangles - a.triangles || a.id.localeCompare(b.id))
    .slice(0, MODEL_ROWS)
    .map((m) => `${m.id} ${m.voxelsPerTile} vpt  ${formatCount(m.triangles)} tris (${m.count} × ${formatCount(m.count > 0 ? m.triangles / m.count : 0)})`);
}

/** Whether the URL asks for the badge (?stats=1). */
export function statsRequested(search: string): boolean {
  return new URLSearchParams(search).get("stats") === "1";
}

/** The badge lines (monospace, short enough for a phone corner). */
export function statsLines(s: StatsSample): string[] {
  const heap = s.heapBytes === null ? "n/a" : `${(s.heapBytes / 1024 / 1024).toFixed(0)} MB`;
  return [
    `${s.fps.toFixed(1)} fps  ${s.frameMs.toFixed(1)} ms (p95 ${s.p95Ms.toFixed(1)})`,
    `max ${s.maxMs.toFixed(1)} ms  queue ${s.queue}`,
    `draws ${s.drawCalls}  tris ${formatCount(s.triangles)}`,
    `heap ${heap}`,
    `lod ${s.lod ?? "–"}  detail ${s.detail}`,
    s.life ? `life ${s.life.instances} inst  ${s.life.particles} pcl` : "life off",
    ...(s.models && s.models.length > 0 ? ["models by tris:", ...modelLines(s.models)] : []),
  ];
}

/** 1234 → "1.2k", 1 234 567 → "1.23M". */
export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(Math.round(n));
}

/** JS heap in bytes from the non-standard Chromium performance.memory, else null. */
export function readHeapBytes(perf: Performance = performance): number | null {
  const m = (perf as Performance & { memory?: { usedJSHeapSize?: number } }).memory;
  return typeof m?.usedJSHeapSize === "number" ? m.usedJSHeapSize : null;
}

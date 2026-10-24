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
  lod: string;
  detail: string;
  /** Life instances and particles drawn in the last frame (null: the life layer is off, ?life=0). */
  life: { instances: number; particles: number } | null;
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
    `draws ${s.drawCalls}  tris ${formatCount(s.triangles)}`,
    `heap ${heap}`,
    `lod ${s.lod}  detail ${s.detail}`,
    s.life ? `life ${s.life.instances} inst  ${s.life.particles} pcl` : "life off",
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

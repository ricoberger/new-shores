import { describe, expect, it } from "vitest";
import { formatCount, readHeapBytes, statsLines, statsRequested } from "./stats";

describe("fps badge helpers", () => {
  it("reads ?stats=1", () => {
    expect(statsRequested("?fixture=played&stats=1")).toBe(true);
    expect(statsRequested("?stats=0")).toBe(false);
    expect(statsRequested("")).toBe(false);
  });

  it("formats counts", () => {
    expect(formatCount(950)).toBe("950");
    expect(formatCount(12_345)).toBe("12.3k");
    expect(formatCount(1_234_567)).toBe("1.23M");
  });

  it("formats the lines, with and without a heap reading", () => {
    const s = { fps: 59.96, frameMs: 16.7, p95Ms: 18.2, drawCalls: 31, triangles: 612_000, heapBytes: 88 * 1024 * 1024, lod: "near", detail: "lite", queue: 12, maxMs: 41.26, life: { instances: 120, particles: 40 } };
    expect(statsLines(s)).toEqual(["60.0 fps  16.7 ms (p95 18.2)", "max 41.3 ms  queue 12", "draws 31  tris 612.0k", "heap 88 MB", "lod near  detail lite", "life 120 inst  40 pcl"]);
    expect(statsLines({ ...s, heapBytes: null })[3]).toBe("heap n/a");
    expect(statsLines({ ...s, life: null })[5]).toBe("life off");
    expect(statsLines({ ...s, lod: null })[4]).toBe("lod –  detail lite");
  });

  it("reads the heap when the browser exposes it", () => {
    expect(readHeapBytes({ memory: { usedJSHeapSize: 5 } } as unknown as Performance)).toBe(5);
    expect(readHeapBytes({} as Performance)).toBeNull();
  });
});

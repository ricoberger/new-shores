import { describe, expect, it } from "vitest";
import { formatCount, readHeapBytes, statsLines, statsRequested } from "./stats";

describe("fps badge helpers", () => {
  it("reads ?stats=1", () => {
    expect(statsRequested("?fixture=dense-2x400&stats=1")).toBe(true);
    expect(statsRequested("?stats=0")).toBe(false);
    expect(statsRequested("")).toBe(false);
  });

  it("formats counts", () => {
    expect(formatCount(950)).toBe("950");
    expect(formatCount(12_345)).toBe("12.3k");
    expect(formatCount(1_234_567)).toBe("1.23M");
  });

  it("formats the lines, with and without a heap reading", () => {
    const s = { fps: 59.96, frameMs: 16.7, p95Ms: 18.2, drawCalls: 31, triangles: 612_000, heapBytes: 88 * 1024 * 1024, lod: "near", detail: "lite" };
    expect(statsLines(s)).toEqual(["60.0 fps  16.7 ms (p95 18.2)", "draws 31  tris 612.0k", "heap 88 MB", "lod near  detail lite"]);
    expect(statsLines({ ...s, heapBytes: null })[2]).toBe("heap n/a");
  });

  it("reads the heap when the browser exposes it", () => {
    expect(readHeapBytes({ memory: { usedJSHeapSize: 5 } } as unknown as Performance)).toBe(5);
    expect(readHeapBytes({} as Performance)).toBeNull();
  });
});

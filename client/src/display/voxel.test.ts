import { describe, expect, it } from "vitest";
import { voxelEnabled } from "./voxel";

describe("voxel prototype flag", () => {
  it("is on only with ?voxel=1", () => {
    expect(voxelEnabled("?voxel=1")).toBe(true);
    expect(voxelEnabled("?stats=1&voxel=1")).toBe(true);
    expect(voxelEnabled("")).toBe(false);
    expect(voxelEnabled("?voxel=0")).toBe(false);
  });
});

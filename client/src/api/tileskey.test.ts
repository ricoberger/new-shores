import { describe, expect, it } from "vitest";
import { tilesKey } from "./client";

describe("tilesKey", () => {
  it("carries seed, roll and generator version, as the server's key", () => {
    expect(tilesKey({ seed: 7, roll: 1, generator_version: 2 })).toBe("7-1-g2");
  });

  it("changes with each part", () => {
    const k = tilesKey({ seed: 7, roll: 1, generator_version: 2 });
    expect(tilesKey({ seed: 8, roll: 1, generator_version: 2 })).not.toBe(k);
    expect(tilesKey({ seed: 7, roll: 2, generator_version: 2 })).not.toBe(k);
    expect(tilesKey({ seed: 7, roll: 1, generator_version: 3 })).not.toBe(k);
  });
});

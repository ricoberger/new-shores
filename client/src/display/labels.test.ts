import { describe, expect, it } from "vitest";
import { declutterLabels, labelPosition, type LabelBox } from "./labels";

const box = (id: string, x: number, y: number, area: number, width = 100, height = 24): LabelBox => ({ id, x, y, width, height, area });

describe("far labels at the cap on phones", () => {
  it("hides the smaller island's label of an overlapping pair", () => {
    expect([...declutterLabels([box("a", 100, 100, 500), box("b", 150, 110, 900)], null)]).toEqual(["a"]);
    // Apart (with the gap): both show.
    expect(declutterLabels([box("a", 100, 100, 500), box("b", 205, 100, 900)], null).size).toBe(0);
    expect(declutterLabels([box("a", 100, 100, 500), box("b", 100, 129, 900)], null).size).toBe(0);
  });

  it("always keeps the focused island's label", () => {
    expect([...declutterLabels([box("a", 100, 100, 500), box("b", 150, 110, 900)], "a")]).toEqual(["b"]);
  });

  it("decides chains greedily from the largest island (a hidden label hides nothing)", () => {
    // b overlaps a and c, a and c do not overlap: b (smallest) goes, a and c stay.
    const hidden = declutterLabels([box("a", 100, 100, 800), box("b", 180, 100, 300), box("c", 260, 100, 700)], null);
    expect([...hidden]).toEqual(["b"]);
    // Ties: by ID.
    expect([...declutterLabels([box("y", 100, 100, 500), box("x", 120, 100, 500)], null)]).toEqual(["y"]);
  });
});

describe("far label position (D-072: one island fills the view at the cap)", () => {
  it("sits on the island's centre while the whole label fits inside the edge margin", () => {
    expect(labelPosition({ x: 400, y: 300 }, 50, 1280, 800, 24, false)).toEqual({ x: 400, y: 300 });
    expect(labelPosition({ x: 74, y: 24 }, 50, 1280, 800, 24, true)).toEqual({ x: 74, y: 24 });
  });

  it("hides another island's label whose centre is out of view", () => {
    expect(labelPosition({ x: -200, y: 300 }, 50, 1280, 800, 24, false)).toBeNull();
    expect(labelPosition({ x: 60, y: 300 }, 50, 1280, 800, 24, false)).toBeNull();
    expect(labelPosition({ x: Number.NaN, y: 300 }, 50, 1280, 800, 24, true)).toBeNull();
  });

  it("keeps the label of the island the camera is over in view, on the side of its centre", () => {
    expect(labelPosition({ x: -200, y: 300 }, 50, 1280, 800, 24, true)).toEqual({ x: 74, y: 300 });
    expect(labelPosition({ x: 2000, y: -500 }, 50, 1280, 800, 24, true)).toEqual({ x: 1206, y: 24 });
    expect(labelPosition({ x: 600, y: 1500 }, 50, 412, 915, 24, true)).toEqual({ x: 338, y: 891 });
  });

  it("hides every label in a viewport too small for it", () => {
    expect(labelPosition({ x: 40, y: 40 }, 50, 100, 100, 24, true)).toBeNull();
  });
});

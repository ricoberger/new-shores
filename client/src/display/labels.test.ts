import { describe, expect, it } from "vitest";
import { declutterLabels, type LabelBox } from "./labels";

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

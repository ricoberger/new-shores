import { describe, expect, it } from "vitest";
import type { Content, DisplayState } from "../api/client";
import { islandNameOf, localizeNames, shipNameOf } from "./names";

const content = {
  island_names: [{ source: "Greenhaven", name: "Grünhafen" }],
  ships: [{ id: "sloop", name: "Schaluppe", source_name: "Sloop" }],
} as unknown as Content;

describe("names", () => {
  it("translates generated island names and leaves chosen ones alone", () => {
    expect(islandNameOf(content, "Greenhaven")).toBe("Grünhafen");
    expect(islandNameOf(content, "My Island")).toBe("My Island");
    expect(islandNameOf(null, "Greenhaven")).toBe("Greenhaven");
  });

  it("translates a ship's default name only", () => {
    expect(shipNameOf(content, "Sloop 2")).toBe("Schaluppe 2");
    expect(shipNameOf(content, "Sloop Two")).toBe("Sloop Two");
    expect(shipNameOf(content, "Sloop 2 of the North")).toBe("Sloop 2 of the North");
    expect(shipNameOf(content, "Black Pearl")).toBe("Black Pearl");
  });

  it("returns the same display state when there is nothing to translate", () => {
    const display = { islands: [], ships: [] } as unknown as DisplayState;
    expect(localizeNames(display, { island_names: [], ships: [{ id: "sloop", name: "Sloop" }] } as unknown as Content)).toBe(display);
    const mapped = localizeNames(
      { islands: [{ id: "a", name: "Greenhaven" }], ships: [{ id: 1, name: "Sloop 1" }] } as unknown as DisplayState,
      content,
    );
    expect(mapped.islands[0]?.name).toBe("Grünhafen");
    expect(mapped.ships[0]?.name).toBe("Schaluppe 1");
  });
});

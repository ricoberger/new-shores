import { describe, expect, it } from "vitest";
import type { BuildingDisplay, ContentBuilding, IslandDisplay } from "../api/client";
import { armBit, joinedBuildings, joinPiece } from "./paintjoin";

const def = (id: string, extra: Partial<ContentBuilding> = {}) => ({ id, width: 1, height: 1, category: "ornaments", ...extra }) as ContentBuilding;
const defs = new Map<string, ContentBuilding>([
  ["hedge", def("hedge", { paint_family: {} })],
  ["city_wall", def("city_wall", { category: "military", paint_family: { road_crossing: true } })],
  ["tower", def("tower", { category: "military", width: 2, height: 2 })],
  ["square", def("square", { paint_family: { ground: "cobbles_fine" } })],
  ["well", def("well")],
]);
let id = 0;
const b = (type: string, x: number, y: number) => ({ id: ++id, type, x, y, rotation: 0 }) as BuildingDisplay;
const display = (buildings: BuildingDisplay[], roads: { x: number; y: number; type: string }[] = []) =>
  ({ buildings, roads }) as unknown as Pick<IslandDisplay, "buildings" | "roads">;

describe("paint-family joins (D-077 §2–§3)", () => {
  it("maps every neighbour mask to a piece whose turned arms are exactly the neighbours", () => {
    const arms: Record<string, [number, number][]> = {
      straight: [
        [-1, 0],
        [1, 0],
      ],
      end: [[1, 0]],
      corner: [
        [1, 0],
        [0, 1],
      ],
      t: [
        [-1, 0],
        [1, 0],
        [0, 1],
      ],
      cross: [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ],
    };
    const count = (m: number) => [1, 2, 4, 8].filter((x) => m & x).length;
    for (let mask = 1; mask < 16; mask++) {
      const { piece, rotation } = joinPiece(mask);
      const got = arms[piece]!.reduce((m, [x, y]) => m | armBit(x, y, rotation), 0);
      // Two opposite neighbours are straight, two adjacent a corner.
      if (piece !== "straight" || count(mask) === 2) expect(got, `mask ${mask}`).toBe(mask);
      expect(piece).toBe(["", "end", "end", "corner", "end", "straight", "corner", "t", "end", "corner", "straight", "t", "corner", "t", "t", "cross"][mask]);
    }
    expect(joinPiece(0)).toEqual({ piece: "straight", rotation: 0 });
  });

  it("picks the pieces of a painted line and its corner, and leaves other buildings alone", () => {
    const well = b("well", 9, 9);
    const sq = b("square", 0, 5);
    // An L: (0,0) (1,0) (2,0) and (2,1).
    const out = joinedBuildings(display([b("hedge", 0, 0), b("hedge", 1, 0), b("hedge", 2, 0), b("hedge", 2, 1), well, sq]), defs);
    expect(out.map((x) => x.model)).toEqual(["hedge.end", undefined, "hedge.corner", "hedge.end", undefined, undefined]);
    expect(out[1]!.rotation).toBe(0);
    expect(out[4]).toBe(well);
    expect(out[5]).toBe(sq);
    // No paint family: the same list.
    const plain = [well];
    expect(joinedBuildings(display(plain), defs)).toBe(plain);
  });

  it("joins the city wall to a tower's stubs and arches it over a land road, not a quay", () => {
    const out = joinedBuildings(display([b("tower", 0, 0), b("city_wall", 2, 0), b("city_wall", 3, 0), b("city_wall", 4, 0)], [{ x: 3, y: 0, type: "road_dirt" }]), defs);
    expect(out.map((x) => x.model)).toEqual([undefined, undefined, "city_wall.arch", "city_wall.end"]);
    const quay = joinedBuildings(display([b("city_wall", 2, 0), b("city_wall", 3, 0), b("city_wall", 4, 0)], [{ x: 3, y: 0, type: "quay" }]), defs);
    expect(quay[1]!.model).toBeUndefined();
    // A hedge does not join a tower.
    expect(joinedBuildings(display([b("tower", 0, 0), b("hedge", 2, 0)]), defs)[1]!.model).toBeUndefined();
  });
});

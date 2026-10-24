import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, describe, expect, it } from "vitest";
import { BOUNDS_MARGIN, groundFootprint, MIN_HALF_HEIGHT, NEAR_DEFAULT_HALF_HEIGHT, type Rect, ROTATION_EASE_MS, seaMargin, targetBounds } from "../display/camera";
import { buildDenseArchipelagoFixture } from "../dev/fixture";
import { CameraRig, easeInOut } from "./camera";

// The Babylon rig against the pure camera math, headless (NullEngine).

const DEV = { minX: 0, minY: 0, maxX: 112, maxY: 114 };
let engine: NullEngine | null = null;

function rig(width: number, height: number, bounds: Rect = DEV): CameraRig {
  engine = new NullEngine({ renderWidth: width, renderHeight: height, textureSize: 256, deterministicLockstep: false, lockstepMaxSteps: 1 });
  const scene = new Scene(engine);
  const r = new CameraRig(scene, engine);
  r.setIslandBounds(bounds);
  return r;
}

/** Bounding box of the dense-archipelago-8 fixture's islands. */
function eightIslandBounds(): Rect {
  const is = buildDenseArchipelagoFixture(0).server.display.islands;
  return {
    minX: Math.min(...is.map((i) => i.position.x)),
    minY: Math.min(...is.map((i) => i.position.y)),
    maxX: Math.max(...is.map((i) => i.position.x + i.width)),
    maxY: Math.max(...is.map((i) => i.position.y + i.height)),
  };
}

afterEach(() => {
  engine?.dispose();
  engine = null;
});

describe("CameraRig", () => {
  for (const [w, h] of [
    [1280, 800],
    [360, 640],
  ] as const) {
    it(`${w} × ${h}: the ground under the viewport corners is the pure footprint in all four rotations`, () => {
      const r = rig(w, h);
      r.setCamera({ x: 40, y: 30, half: 20 });
      for (let step = 0; step < 4; step++) {
        r.setCamera({ rotation: step });
        const fp = groundFootprint(r.view(), w / h);
        const corners = [
          [0, 0],
          [w, 0],
          [w, h],
          [0, h],
        ];
        corners.forEach(([px, py], i) => {
          const g = r.groundAt(px as number, py as number)!;
          expect(g.x).toBeCloseTo(fp[i]!.x, 4);
          expect(-g.z).toBeCloseTo(fp[i]!.y, 4);
        });
        // The target projects to the viewport centre.
        const c = r.project(new Vector3(40, 0, -30));
        expect(c.x).toBeCloseTo(w / 2, 3);
        expect(c.y).toBeCloseTo(h / 2, 3);
      }
    });
  }

  it("rotateBy keeps target and zoom; +1 orbits the camera clockwise seen from above (the map turns counter-clockwise on screen)", () => {
    const r = rig(1280, 800);
    r.setCamera({ x: 40, y: 30, half: 20, rotation: 0 });
    const east = () => r.project(new Vector3(50, 0, -30));
    const centre = r.project(new Vector3(40, 0, -30));
    const angle = () => {
      const p = east();
      // Screen angle (y down: positive is clockwise on screen).
      return Math.atan2(p.y - centre.y, p.x - centre.x);
    };
    const a0 = angle();
    r.rotateBy(1);
    expect(r.view()).toMatchObject({ x: 40, y: 30, half: 20, rotation: 1 });
    const a1 = angle();
    let d = a1 - a0;
    while (d <= -Math.PI) d += 2 * Math.PI;
    while (d > Math.PI) d -= 2 * Math.PI;
    // Counter-clockwise on screen (negative in y-down screen angles); not exactly 90° (the ground is tilted).
    expect(d).toBeLessThan(0);
    r.rotateBy(-1);
    expect(r.view().rotation).toBe(0);
    r.rotateBy(-1);
    expect(r.view().rotation).toBe(3);
    // Free: any angle in between.
    r.rotateBy(0.3);
    expect(r.view().rotation).toBeCloseTo(3.3, 12);
  });

  it("eases a free turn to the nearest 45° within 250 ms, the short way round", () => {
    const r = rig(1280, 800);
    r.setCamera({ x: 40, y: 30, half: 20, rotation: 0 });
    r.tick(1000);
    r.rotateBy(-0.2);
    expect(r.view().rotation).toBeCloseTo(3.8, 12);
    r.snap();
    expect(r.turning()).toBe(true);
    r.tick(1100);
    const mid = r.view().rotation;
    expect(mid > 3.8 || mid < 0.01).toBe(true);
    r.tick(1000 + ROTATION_EASE_MS);
    expect(r.turning()).toBe(false);
    expect(r.view().rotation).toBe(0);
    expect(r.view()).toMatchObject({ x: 40, y: 30, half: 20 });
    // A small way is quicker.
    r.rotateBy(0.05);
    r.snap();
    r.tick(1000 + ROTATION_EASE_MS + 60);
    expect(r.view().rotation).toBe(0);
    // Already on a step: nothing to ease.
    r.snap();
    expect(r.turning()).toBe(false);
  });

  it("steps by 45° (Q/E), adding up from a running ease's destination", () => {
    const r = rig(1280, 800);
    r.setCamera({ x: 40, y: 30, half: 20, rotation: 0 });
    r.tick(2000);
    r.step(1);
    r.step(1);
    r.tick(2000 + ROTATION_EASE_MS);
    expect(r.view().rotation).toBe(1);
    r.step(-3);
    r.tick(3000);
    expect(r.view().rotation).toBe(3.5);
    // A free turn interrupts an ease.
    r.step(1);
    r.rotateBy(0.1);
    expect(r.turning()).toBe(false);
  });

  it("clamps the target to the bounds plus margin and the zoom to the range", () => {
    const r = rig(412, 915);
    r.setCamera({ x: -1000, y: 1000, half: 1 });
    expect(r.view()).toMatchObject({ x: -BOUNDS_MARGIN, y: DEV.maxY + BOUNDS_MARGIN, half: MIN_HALF_HEIGHT });
    r.setCamera({ half: 10_000 });
    expect(r.view().half).toBeCloseTo(r.zoomRange().max, 6);
    // Zoom about a pointer keeps the ground point under it.
    r.setCamera({ x: 40, y: 30, half: NEAR_DEFAULT_HALF_HEIGHT });
    const before = r.groundAt(100, 200)!;
    r.zoom(1.3, { x: 100, y: 200 });
    const after = r.groundAt(100, 200)!;
    expect(after.x).toBeCloseTo(before.x, 4);
    expect(after.z).toBeCloseTo(before.z, 4);
  });

  it("pan keeps the ground point under the pointer in every rotation", () => {
    const r = rig(1280, 800);
    for (let step = 0; step < 4; step += 0.3) {
      r.setCamera({ x: 40, y: 30, half: 20, rotation: step });
      const g = r.groundAt(300, 300)!;
      r.pan({ x: 300, y: 300 }, { x: 420, y: 350 });
      const h = r.groundAt(420, 350)!;
      expect(h.x).toBeCloseTo(g.x, 4);
      expect(h.z).toBeCloseTo(g.z, 4);
    }
  });

  it("animates a jump with an ease in-out and blocks pan and zoom meanwhile", () => {
    const r = rig(1280, 800);
    r.setCamera({ x: 0, y: 0, half: 40 });
    r.animateTo({ x: 80, y: 60, half: 18 }, 350, 1000);
    expect(r.animating()).toBe(true);
    r.pan({ x: 0, y: 0 }, { x: 100, y: 100 });
    r.tick(1175);
    const mid = r.view();
    expect(mid.x).toBeCloseTo(40, 6);
    expect(mid.y).toBeCloseTo(30, 6);
    r.tick(1350);
    expect(r.animating()).toBe(false);
    expect(r.view()).toMatchObject({ x: 80, y: 60 });
    expect(r.view().half).toBeCloseTo(18, 9);
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.5)).toBeCloseTo(0.5, 9);
  });
});

describe("CameraRig clip range", () => {
  for (const [w, h] of [
    [412, 915],
    [360, 640],
    [1280, 800],
  ] as const) {
    it(`${w} × ${h}: at the whole-archipelago zoom the ground in view (and 6 tiles above it) lies between the clip planes in every rotation`, () => {
      const b = eightIslandBounds();
      const r = rig(w, h, b);
      const t = targetBounds(b);
      const aspect = w / h;
      const sea = seaMargin(b, aspect);
      const targets = [
        { x: 110.5, y: 91 },
        { x: t.minX, y: t.minY },
        { x: t.maxX, y: t.minY },
        { x: t.maxX, y: t.maxY },
        { x: t.minX, y: t.maxY },
      ];
      for (const at of targets) {
        for (let rotation = 0; rotation < 4; rotation += 0.25) {
          r.setCamera({ ...at, half: 100_000, rotation });
          const v = r.view();
          expect(v.half).toBeCloseTo(r.zoomRange().max, 6);
          const cam = r.camera;
          const forward = cam.getTarget().subtract(cam.position).normalize();
          for (const p of groundFootprint(v, aspect)) {
            // The viewport corners lie on the sea.
            expect(p.x).toBeGreaterThanOrEqual(b.minX - sea);
            expect(p.x).toBeLessThanOrEqual(b.maxX + sea);
            for (const y of [0, 6]) {
              const depth = Vector3.Dot(new Vector3(p.x, y, -p.y).subtract(cam.position), forward);
              expect(depth).toBeGreaterThan(cam.minZ);
              expect(depth).toBeLessThan(cam.maxZ);
            }
          }
        }
      }
    });
  }
});

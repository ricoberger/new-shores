import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, describe, expect, it } from "vitest";
import { CameraRig } from "./camera";
import { SceneLighting, SHADOW_LEAN, SUN_DIRECTION } from "./lighting";

// The golden-hour sun (accepted north-west placement): fixed to the world
// under the camera's 90° steps; at rotation 0 shadows fall toward the
// screen's lower right and a camera-facing wall is sunlit.

let engine: NullEngine | null = null;
afterEach(() => {
  engine?.dispose();
  engine = null;
});

function setup() {
  engine = new NullEngine({ renderWidth: 800, renderHeight: 600, textureSize: 64, deterministicLockstep: false, lockstepMaxSteps: 1 });
  const scene = new Scene(engine);
  const rig = new CameraRig(scene, engine);
  rig.setIslandBounds({ minX: 0, minY: 0, maxX: 100, maxY: 100 });
  rig.setCamera({ x: 50, y: 50, half: 18, rotation: 0 });
  const lighting = new SceneLighting(scene, rig.camera, "low");
  return { rig, lighting };
}

describe("sun", () => {
  it("stays fixed to the world when the camera turns", () => {
    const { rig, lighting } = setup();
    const d0 = lighting.sun.direction.clone();
    expect(d0.equalsWithEpsilon(SUN_DIRECTION, 1e-9)).toBe(true);
    for (let step = 1; step <= 8; step++) {
      rig.rotateBy(0.5);
      expect(rig.view().rotation).toBe((step / 2) % 4);
      expect(lighting.sun.direction.equalsWithEpsilon(d0, 1e-9)).toBe(true);
    }
  });

  it("throws shadows toward the lower right at rotation 0 and lights a camera-facing wall", () => {
    const { rig } = setup();
    const target = new Vector3(50, 0, -50);
    const a = rig.project(target);
    const b = rig.project(target.add(new Vector3(SHADOW_LEAN.x, 0, SHADOW_LEAN.z)));
    expect(b.x - a.x).toBeGreaterThan(0); // right
    expect(b.y - a.y).toBeGreaterThan(0); // down (screen y grows downward)
    expect(b.x - a.x).toBeGreaterThan(b.y - a.y); // mostly right, slightly down
    // Toward the camera and toward the sun, on the ground plane.
    const cam = rig.camera.position.subtract(target);
    const toSun = SUN_DIRECTION.scale(-1);
    const facesCameraAndSun = [new Vector3(-1, 0, 0), new Vector3(0, 0, -1), new Vector3(1, 0, 0), new Vector3(0, 0, 1)].filter(
      (n) => Vector3.Dot(n, cam) > 0 && Vector3.Dot(n, toSun) > 0,
    );
    expect(facesCameraAndSun.length).toBeGreaterThan(0);
  });
});

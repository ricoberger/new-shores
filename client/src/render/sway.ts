/**
 * Cloth sway (LIFE_LAYER §2): sails, drying cloth and flags move in the
 * vertex shader. The asset pipeline marks swaying vertices by lowering
 * their COLOR_0 alpha (weight = 1 − alpha, at most 245/255; the bytes
 * 248..255 carry the rigid vertices' jitter class), so every
 * other vertex of a material with the plugin is untouched. The wind is
 * world-fixed (the smoke's WIND); a ship instance with the SAILING alpha
 * sentinel also bulges its sails forward. No game state is involved: the
 * clock is the engine's frame time (frozen in visual tests).
 */
import type { Material } from "@babylonjs/core/Materials/material";
import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase";
import type { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer";
import { hash01 } from "../display/life";
import { WIND } from "../display/lifeplan";

/** Shared sway clock: seconds (wrapped) and amplitude (0 with ?life=0). */
export const swayClock = { t: 0, amp: 1 };

/** Wrap period of the clock (ms): the sway frequencies complete whole cycles in it. */
const WRAP_MS = 600_000;
/** Sway angular frequency (rad/s): 240 cycles per WRAP_MS. */
const OMEGA = (2 * Math.PI * 240) / (WRAP_MS / 1000);

/** Weights up to this are rigid (alpha bytes 248..255: the jitter classes, nsvoxel/jitter.py). */
export const SWAY_MIN = 8.5 / 255;

/** Instance alpha marking a sailing ship (reset to 1 in the shader). */
export const SAILING_ALPHA = 0.5;

/** Whether a ship's sails fill: under way on a leg (not handling, not arrived, not waiting at sea). */
export function sailing(ship: { leg?: unknown }, placement: { atSea: boolean } | null): boolean {
  return !!ship.leg && !!placement?.atSea;
}

/** Whether a ship waits at anchor (idle or unpaid without a leg, or queued at a Trading Post): it bobs. */
export function waiting(ship: { leg?: unknown }, dock: { queued?: boolean } | undefined): boolean {
  return dock ? !!dock.queued : !ship.leg;
}

const bobOut = { dy: 0, rock: 0 };

/** Bob of a ship at anchor at time nowMs: heave (world y) and roll (radians), seeded by the ship ID. */
export function anchorBob(id: number, nowMs: number): { dy: number; rock: number } {
  const s = hash01(id, "bob") * Math.PI * 2;
  const t = nowMs / 1000;
  bobOut.dy = Math.sin(t * 1.3 + s) * 0.03;
  bobOut.rock = Math.sin(t * 0.9 + s * 1.7) * 0.05;
  return bobOut;
}

/** Sets the sway clock from the frame's time (ms). */
export function setSwayTime(nowMs: number, enabled: boolean): void {
  swayClock.t = (((nowMs % WRAP_MS) + WRAP_MS) % WRAP_MS) / 1000;
  swayClock.amp = enabled ? 1 : 0;
}

const len = Math.hypot(WIND.x, WIND.y);
/** Wind direction in world space (x, z; archipelago y is world −z). */
const WX = (WIND.x / len).toFixed(4);
const WZ = (-WIND.y / len).toFixed(4);

export class SwayPlugin extends MaterialPluginBase {
  constructor(material: Material) {
    super(material, "Sway", 200, { SWAY: false });
    this._enable(true);
  }

  override prepareDefines(defines: Record<string, unknown>): void {
    defines["SWAY"] = true;
  }

  override getClassName(): string {
    return "SwayPlugin";
  }

  override getUniforms() {
    return {
      ubo: [
        { name: "swayTime", size: 1, type: "float" },
        { name: "swayAmp", size: 1, type: "float" },
      ],
      vertex: "uniform float swayTime;\nuniform float swayAmp;",
    };
  }

  override bindForSubMesh(ubo: UniformBuffer): void {
    ubo.updateFloat("swayTime", swayClock.t);
    ubo.updateFloat("swayAmp", swayClock.amp);
  }

  override getCustomCode(shaderType: string): Record<string, string> | null {
    if (shaderType !== "vertex") return null;
    return {
      CUSTOM_VERTEX_UPDATE_WORLDPOS: `
#if defined(SWAY) && defined(VERTEXCOLOR)
  // Alpha bytes 248..255 are rigid (the jitter class, render/jitter.ts); sway weights start at 10/255.
  float swayRaw = 1.0 - color.a;
  float swayW = (swayRaw > ${SWAY_MIN.toFixed(4)} ? swayRaw : 0.0) * swayAmp;
  if (swayW > 0.0) {
    vec3 swayWind = vec3(${WX}, 0.0, ${WZ});
    float swayPh = swayTime * ${OMEGA.toFixed(5)} + dot(worldPos.xz, vec2(3.1, 2.3));
    worldPos.xyz += swayWind * (0.03 + 0.03 * sin(swayPh)) * swayW + vec3(0.0, 0.012 * cos(swayPh * 1.7) * swayW, 0.0);
#ifdef INSTANCESCOLOR
    if (abs(instanceColor.a - ${SAILING_ALPHA.toFixed(2)}) < 0.01) {
      vec3 swayFwd = normalize(vec3(finalWorld[0][0], 0.0, finalWorld[0][2]) + vec3(1e-5, 0.0, 0.0));
      worldPos.xyz += swayFwd * 0.07 * swayW * length(finalWorld[0].xyz);
    }
#endif
  }
#endif
`,
      CUSTOM_VERTEX_MAIN_END: `
#if defined(SWAY) && defined(INSTANCESCOLOR)
  if (abs(instanceColor.a - ${SAILING_ALPHA.toFixed(2)}) < 0.01) vColor.a = 1.0;
#endif
`,
    };
  }
}

/** Adds the sway plugin to a material (once). */
export function addSway<T extends Material>(m: T): T {
  if (!m.pluginManager?.getPlugin("Sway")) new SwayPlugin(m);
  return m;
}

/**
 * Per-voxel colour jitter (D-057 V2; ART_DIRECTION §4): the hand-made
 * voxel look, in the shader rather than baked into the models. Every
 * fragment finds its voxel — its position in the model's own voxel grid
 * (mesh-local position × voxels per unit, nudged half a voxel inward
 * across the face it lies on) — hashes it and shifts the vertex colour's
 * value (four steps) and, slightly, its hue along a warm–cool axis.
 *
 * The strength follows the material class, which the asset pipeline
 * writes into the COLOR_0 alpha byte of rigid vertices (255 − class,
 * nsvoxel/jitter.py); swaying vertices (alpha ≤ 245) get the cloth/leaf
 * strength. Stone and roofs are strongest, plaster lightest; glass, water
 * and placeholder boxes (alpha 255) are untouched.
 *
 * WebGL 2 only (derivatives, constant arrays); the WebGL 1 fallback draws
 * the plain vertex colours.
 *
 * Local positions keep the pattern fixed to the model: deterministic, no
 * crawling while a ship sails, a building rises or the camera moves. The
 * grid is the material's (8 per tile for the full models, 2 for the lite
 * tier, 16 for the life props). Global switch: `jitterShade.amount` (0 at
 * far LOD, where a voxel is below a pixel, and with `?jitter=0` for A/B
 * comparisons). Render-only; no state.
 */
import type { Material } from "@babylonjs/core/Materials/material";
import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase";
import type { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer";

/** Voxels per tile of the models (manifest voxels_per_tile), of their lite tier (÷ LITE_DOWNSAMPLE 4) and of the life props (scale 16). */
export const MODEL_VPT = 8;
export const LITE_VPT = 2;
export const LIFE_VPT = 16;

/**
 * Value (± per step) and hue amplitude per class (nsvoxel/jitter.py: 0 none,
 * 1 stone, 2 roof, 3 plaster, 4 wood, 5 ground, 6 foliage, 7 metal), and
 * the swaying vertices' (index 8: cloth and leaves).
 */
export const JITTER_CLASSES: readonly (readonly [value: number, hue: number])[] = [
  [0, 0],
  [0.105, 0.02],
  [0.085, 0.03],
  [0.035, 0.01],
  [0.07, 0.022],
  [0.06, 0.018],
  [0.07, 0.03],
  [0.03, 0],
  [0.04, 0.015],
];

/** The class of a COLOR_0 alpha (0..1): 255 − class for rigid vertices, 8 for swaying ones. */
export function jitterClass(alpha: number): number {
  const c = Math.round((1 - alpha) * 255);
  return c <= 7 ? c : 8;
}

/** Whether the page asks for the jitter (`?jitter=0` turns it off; read once). */
export function jitterRequested(search: string): boolean {
  return new URLSearchParams(search).get("jitter") !== "0";
}

/** Global jitter switch: 1 on, 0 off (far LOD, ?jitter=0). */
export const jitterShade = { amount: 1, enabled: jitterRequested(globalThis.location?.search ?? "") };

/** Sets the jitter for a LOD (none at far LOD; none with ?jitter=0). */
export function setJitterLod(far: boolean): void {
  jitterShade.amount = jitterShade.enabled && !far ? 1 : 0;
}

const f = (x: number) => x.toFixed(4);
const TABLE = JITTER_CLASSES.map(([v, h]) => `vec2(${f(v)}, ${f(h)})`).join(", ");

export class JitterPlugin extends MaterialPluginBase {
  constructor(
    material: Material,
    private readonly vpt: number,
  ) {
    super(material, "Jitter", 220, { VOXJITTER: false });
    this._enable(true);
  }

  override prepareDefines(defines: Record<string, unknown>): void {
    defines["VOXJITTER"] = true;
  }

  override getClassName(): string {
    return "JitterPlugin";
  }

  override getUniforms() {
    return {
      ubo: [
        { name: "jitAmount", size: 1, type: "float" },
        { name: "jitVpt", size: 1, type: "float" },
      ],
      vertex: "uniform float jitAmount;\nuniform float jitVpt;",
      fragment: "uniform float jitAmount;\nuniform float jitVpt;",
    };
  }

  override bindForSubMesh(ubo: UniformBuffer): void {
    ubo.updateFloat("jitAmount", jitterShade.amount);
    ubo.updateFloat("jitVpt", this.vpt);
  }

  override getCustomCode(shaderType: string): Record<string, string> | null {
    if (shaderType === "vertex") {
      return {
        CUSTOM_VERTEX_DEFINITIONS: "varying vec3 vJitP;\nvarying vec3 vJitN;\nvarying vec2 vJitS;",
        CUSTOM_VERTEX_MAIN_END: `
#if defined(VOXJITTER) && defined(VERTEXCOLOR) && defined(WEBGL2)
  vJitP = positionUpdated * jitVpt;
  vJitN = normalUpdated;
  int jitC = int(floor((1.0 - color.a) * 255.0 + 0.5));
  vec2 jitTable[9] = vec2[9](${TABLE});
  vJitS = jitTable[jitC <= 7 ? jitC : 8] * jitAmount;
#endif
`,
      };
    }
    if (shaderType !== "fragment") return null;
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: `
varying vec3 vJitP;
varying vec3 vJitN;
varying vec2 vJitS;
float jitHash(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.x + p.y) * p.z);
}
`,
      CUSTOM_FRAGMENT_UPDATE_DIFFUSE: `
#if defined(VOXJITTER) && defined(VERTEXCOLOR) && defined(WEBGL2)
  if (vJitS.x > 0.0) {
    // The face's own normal (flat per triangle; the shading normals of the sides are tilted, cloth's point up),
    // turned outward by the shading normal, picks the axis to step half a voxel inward along.
    vec3 jitG = cross(dFdx(vJitP), dFdy(vJitP));
    float jitD = dot(jitG, vJitN);
    if (abs(jitD) > 1e-6 && jitD < 0.0) jitG = -jitG;
    vec3 jitA = abs(jitG);
    vec3 jitIn = jitA.x >= jitA.y && jitA.x >= jitA.z ? vec3(sign(jitG.x), 0.0, 0.0) : (jitA.y >= jitA.z ? vec3(0.0, sign(jitG.y), 0.0) : vec3(0.0, 0.0, sign(jitG.z)));
    vec3 jitCell = floor(vJitP - jitIn * 0.5);
    float jitV = floor(jitHash(jitCell) * 4.0) / 3.0 * 2.0 - 1.0;
    float jitH = jitHash(jitCell + 17.0) * 2.0 - 1.0;
    float jitL = dot(baseColor.rgb, vec3(0.3, 0.59, 0.11));
    baseColor.rgb = max(vec3(0.0), baseColor.rgb * (1.0 + vJitS.x * jitV) + vec3(1.0, 0.3, -0.8) * (vJitS.y * jitH * jitL));
  }
#endif
`,
    };
  }
}

/** Adds the jitter plugin to a material (once), for models with `vpt` voxels per mesh unit. */
export function addJitter<T extends Material>(m: T, vpt: number): T {
  if (!m.pluginManager?.getPlugin("Jitter")) new JitterPlugin(m, vpt);
  return m;
}

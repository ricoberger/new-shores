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
 * tier, 16 for the life props), or per vertex (JIT_VPT_ATTRIBUTE) where
 * models of other densities (manifest `voxels_per_tile`, V7) share a mesh. Global switch: `jitterShade.amount` (0 at
 * far LOD, where a voxel is below a pixel, and with `?jitter=0` for A/B
 * comparisons). Render-only; no state.
 */
import type { Material } from "@babylonjs/core/Materials/material";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase";
import type { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer";

/** Voxels per tile of the models (manifest voxels_per_tile), of their lite tier (÷ LITE_DOWNSAMPLE 4) and of the life props (scale 16). */
export const MODEL_VPT = 8;
export const LITE_VPT = 2;
export const LIFE_VPT = 16;

/**
 * Merged meshes (ModelMerger) bake each copy's scale and position into the
 * vertices, so `position × vpt` would no longer be the model's own voxel
 * grid. They carry a per-vertex attribute `jitO` (4 normalised bytes): the
 * fraction of the copy's origin in voxel cells (xyz) and its scale in
 * 1/JIT_SCALE_STEPS (w, scales are quantised to it). The shader divides
 * the position by the copy's scale and subtracts that offset, so the cells
 * are the model's voxels whatever the copy's scale and place. No attribute:
 * the old behaviour (the mesh's own units).
 */
export const JIT_ATTRIBUTE = "jitO";
export const JIT_SCALE_STEPS = 32;

/** A copy's scale as the merged meshes store it (multiples of 1 / JIT_SCALE_STEPS, at least one step, at most 255 steps). */
export function jitterScale(s: number): number {
  return Math.min(255, Math.max(1, Math.round(s * JIT_SCALE_STEPS))) / JIT_SCALE_STEPS;
}

/** The `jitO` bytes of a copy at origin (x, y, z) (mesh units) with scale s (as jitterScale returns it) of a model with `vpt` voxels per unit. */
export function jitterOrigin(x: number, y: number, z: number, s: number, vpt: number): [number, number, number, number] {
  const f = (v: number) => {
    const c = (v * vpt) / s;
    return Math.round((c - Math.floor(c)) * 255) % 256;
  };
  return [f(x), f(y), f(z), Math.round(s * JIT_SCALE_STEPS)];
}

/**
 * Merged model chunks that hold a model at another density than the
 * material's (a recipe's VOXELS_PER_TILE: 12 or 16, the manifest entry's
 * `voxels_per_tile`) carry the voxel grid per vertex instead: `voxG`
 * (4 bytes, xyz normalised) is the fraction of the copy's origin in its
 * voxel cells and w its voxels per unit (an integer byte, not a scale, so
 * 12 per tile stays exact). The shader uses position × w − xyz.
 */
export const JIT_VPT_ATTRIBUTE = "voxG";

/** The `voxG` bytes of a model with `vpt` voxels per unit placed at (x, y, z) (mesh units, unscaled). */
export function jitterGrid(x: number, y: number, z: number, vpt: number): [number, number, number, number] {
  const f = (v: number) => {
    const c = v * vpt;
    return Math.round((c - Math.floor(c)) * 255) % 256;
  };
  return [f(x), f(y), f(z), Math.min(255, Math.max(1, Math.round(vpt)))];
}

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
    super(material, "Jitter", 220, { VOXJITTER: false, VOXJITO: false, VOXJITG: false });
    this._enable(true);
  }

  override prepareDefines(defines: Record<string, unknown>, _scene?: unknown, mesh?: AbstractMesh): void {
    defines["VOXJITTER"] = true;
    defines["VOXJITO"] = !!mesh?.isVerticesDataPresent(JIT_ATTRIBUTE);
    defines["VOXJITG"] = !defines["VOXJITO"] && !!mesh?.isVerticesDataPresent(JIT_VPT_ATTRIBUTE);
  }

  override getAttributes(attributes: string[], _scene?: unknown, mesh?: AbstractMesh): void {
    if (mesh?.isVerticesDataPresent(JIT_ATTRIBUTE)) attributes.push(JIT_ATTRIBUTE);
    else if (mesh?.isVerticesDataPresent(JIT_VPT_ATTRIBUTE)) attributes.push(JIT_VPT_ATTRIBUTE);
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
        CUSTOM_VERTEX_DEFINITIONS: "varying vec3 vJitP;\nvarying vec3 vJitN;\nvarying vec2 vJitS;\n#ifdef VOXJITO\nattribute vec4 jitO;\n#endif\n#ifdef VOXJITG\nattribute vec4 voxG;\n#endif",
        CUSTOM_VERTEX_MAIN_END: `
#if defined(VOXJITTER) && defined(VERTEXCOLOR) && defined(WEBGL2)
#ifdef VOXJITO
  vJitP = positionUpdated * (jitVpt / (max(jitO.w * 255.0, 1.0) / ${JIT_SCALE_STEPS}.0)) - jitO.xyz;
#elif defined(VOXJITG)
  vJitP = positionUpdated * max(voxG.w * 255.0, 1.0) - voxG.xyz;
#else
  vJitP = positionUpdated * jitVpt;
#endif
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

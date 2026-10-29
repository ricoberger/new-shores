/**
 * Voxel ground shading (D-057 V2; ART_DIRECTION §4): a material plugin for
 * the terrain and plateau meshes (vertices island-local: their nodes sit
 * at the island root without an offset). Every fragment finds its voxel —
 * the terrain column (TERRAIN_VPT per tile) and the height layer (1/8
 * tile) it belongs to, nudged inward along the normal so faces on a voxel
 * boundary pick their own voxel — and
 *
 * - takes the ground colour of its column from the island's ground
 *   texture (one texel per column, nearest sampling: the smooth blend
 *   between tiles, beach pebbles, wet sand, road stones, furrows) on the
 *   faces looking straight up (the tops of the near/mid terrain: their
 *   vertex colour carries the corner occlusion only; the sides' normals
 *   are tilted, voxelterrain.ts UP_TILT, and keep their vertex colours),
 *   and
 * - multiplies a per-voxel brightness jitter in three steps (the hand-made
 *   voxel look) on every face, sides included.
 *
 * Without a texture (the rock layer, the far meshes) only the jitter applies.
 * The jitter strength is global (groundShade.jitter): the renderer sets it
 * to 0 at far LOD, where a voxel is below a pixel and the jitter would
 * only shimmer. Render-only; no state.
 */
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture";
import type { Material } from "@babylonjs/core/Materials/material";
import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase";
import type { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer";
import { JITTER_CLASSES } from "./jitter";

/** Ground jitter strength (± per step): the ground class of render/jitter.ts. */
export const GROUND_JITTER = (JITTER_CLASSES[5] as readonly [number, number])[0];
/** Global strength of the per-voxel brightness jitter (± per step; 0 at far LOD and with ?jitter=0). */
export const groundShade = { jitter: GROUND_JITTER };

/** The ground texture of one island (null: jitter only) and its column grid. */
export interface GroundBinding {
  texture: BaseTexture | null;
  /** Texture size in texels (columns). */
  width: number;
  height: number;
  /** Columns (texels) per tile, also the jitter's column size. */
  vpt: number;
}

export class GroundPlugin extends MaterialPluginBase {
  constructor(
    material: Material,
    private readonly binding: GroundBinding,
  ) {
    super(material, "Ground", 210, { GROUND: false, GROUNDTEX: false });
    this._enable(true);
  }

  override prepareDefines(defines: Record<string, unknown>): void {
    defines["GROUND"] = true;
    defines["GROUNDTEX"] = this.binding.texture !== null;
  }

  override getClassName(): string {
    return "GroundPlugin";
  }

  override getSamplers(samplers: string[]): void {
    samplers.push("groundSampler");
  }

  override getActiveTextures(active: BaseTexture[]): void {
    if (this.binding.texture) active.push(this.binding.texture);
  }

  override hasTexture(texture: BaseTexture): boolean {
    return texture === this.binding.texture;
  }

  override getUniforms() {
    return {
      ubo: [
        { name: "groundSize", size: 2, type: "vec2" },
        { name: "groundVpt", size: 1, type: "float" },
        { name: "groundJitter", size: 1, type: "float" },
      ],
      vertex: "uniform vec2 groundSize;\nuniform float groundVpt;\nuniform float groundJitter;",
      fragment: "uniform vec2 groundSize;\nuniform float groundVpt;\nuniform float groundJitter;",
    };
  }

  override bindForSubMesh(ubo: UniformBuffer): void {
    const b = this.binding;
    ubo.updateFloat2("groundSize", Math.max(1, b.width), Math.max(1, b.height));
    ubo.updateFloat("groundVpt", b.vpt);
    ubo.updateFloat("groundJitter", groundShade.jitter);
    if (b.texture) ubo.setTexture("groundSampler", b.texture);
  }

  override getCustomCode(shaderType: string): Record<string, string> | null {
    if (shaderType === "vertex") {
      return {
        CUSTOM_VERTEX_DEFINITIONS: "varying vec3 vGroundLocal;\nvarying vec3 vGroundNormal;",
        CUSTOM_VERTEX_MAIN_END: "vGroundLocal = positionUpdated;\nvGroundNormal = normalUpdated;",
      };
    }
    if (shaderType !== "fragment") return null;
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: `
varying vec3 vGroundLocal;
varying vec3 vGroundNormal;
#ifdef GROUNDTEX
uniform sampler2D groundSampler;
#endif
`,
      CUSTOM_FRAGMENT_UPDATE_DIFFUSE: `
#ifdef GROUND
  vec3 gN = normalize(vGroundNormal);
  vec3 gP = vGroundLocal - gN * 0.02;
  vec2 gCol = floor(vec2(gP.x, -gP.z) * groundVpt);
#ifdef GROUNDTEX
  if (gN.y > 0.95) baseColor.rgb *= texture2D(groundSampler, (gCol + 0.5) / groundSize).rgb;
#endif
  float gH = fract(sin(dot(vec3(gCol, floor(gP.y * 8.0 + 0.01)), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
  baseColor.rgb *= 1.0 + groundJitter * (floor(gH * 3.0) - 1.0);
#endif
`,
    };
  }
}

/** Adds the ground plugin to a material (once). */
export function addGround<T extends Material>(m: T, binding: GroundBinding): T {
  if (!m.pluginManager?.getPlugin("Ground")) new GroundPlugin(m, binding);
  return m;
}

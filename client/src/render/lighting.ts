// Fixed golden-hour lighting (ART_DIRECTION §2, §8): one warm directional
// sun fixed to the world (it does not follow the camera's 90° steps), a
// cool sky fill at LIGHT_VALUES.fill_ratio of the key — the scene's
// ambient colour, taken by every lit material (skyFill), so the fill costs
// no second per-pixel light — and the quality-dependent extras. "high"
// (desktop layout): a low-resolution sun shadow map from buildings and
// trees onto the ground (drawn once per caster change) and FXAA (not on
// software WebGL, where the pass costs more than a frame); "low" (touch
// layouts): none of them is created. The slight warm grading ("high") and
// the soft vignette (both) are HTML overlays above the canvas
// (GameCanvas), composited instead of shaded per pixel. No bloom, SSAO or
// depth of field.
import type { Camera } from "@babylonjs/core/Cameras/camera";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import "@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent";
import { RenderTargetTexture } from "@babylonjs/core/Materials/Textures/renderTargetTexture";
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { FxaaPostProcess } from "@babylonjs/core/PostProcesses/fxaaPostProcess";
import type { Scene } from "@babylonjs/core/scene";
import type { Quality } from "../display/quality";
import { LIGHT, LIGHT_VALUES } from "../theme/palette";
import { c3 } from "./palette";

/**
 * Horizontal direction (world x, z) toward the sun: north-west in
 * archipelago terms, a little north of it — the left of the screen at
 * rotation 0 — so that shadows fall toward the camera's right and slightly
 * down there and the left-front faces are sunlit. ("South-west" and
 * "lower right" cannot both hold for this camera, which looks north-east;
 * the visible shadow direction wins, see the task's implementation notes.)
 */
const SUN_AZIMUTH = { x: -0.66, z: 0.75 };
/** Sun elevation above the horizon (low golden-hour sun, long shadows). */
const SUN_ELEVATION = (38 * Math.PI) / 180;

/** Direction the sunlight travels (from the sun to the ground), unit length. */
export const SUN_DIRECTION = new Vector3(
  -SUN_AZIMUTH.x * Math.cos(SUN_ELEVATION),
  -Math.sin(SUN_ELEVATION),
  -SUN_AZIMUTH.z * Math.cos(SUN_ELEVATION),
).normalize();

/** Ground offset (tiles per unit height) of a shadow: where blob shadows lean. */
export const SHADOW_LEAN = { x: SUN_DIRECTION.x / -SUN_DIRECTION.y, z: SUN_DIRECTION.z / -SUN_DIRECTION.y };

const SUN_INTENSITY = 1.05;
/** Shadow map size (px): low resolution, soft filtering. */
export const SHADOW_MAP_SIZE = 1024;

/** Which quality-dependent effects of the scene exist (tests; grading and vignette are the canvas overlays'). */
export interface Effects {
  quality: Quality;
  shadowMap: boolean;
  fxaa: boolean;
  /** The WebGL renderer is a software rasteriser (FXAA skipped). */
  software: boolean;
}

/** A lit material takes the sky fill (the scene's ambient colour); unlit materials must not. */
export function skyFill<T extends StandardMaterial>(m: T): T {
  m.ambientColor = Color3.White();
  return m;
}

export class SceneLighting {
  readonly sun: DirectionalLight;
  private shadows: ShadowGenerator | null = null;
  private fxaa: FxaaPostProcess | null = null;
  private level: Quality | null = null;
  private casters: AbstractMesh[] = [];

  constructor(
    scene: Scene,
    private readonly camera: Camera,
    quality: Quality,
    private readonly software = false,
  ) {
    this.sun = new DirectionalLight("sun", SUN_DIRECTION.clone(), scene);
    this.sun.diffuse = c3(LIGHT.sun);
    this.sun.specular = c3(LIGHT.sun).scale(0.6);
    this.sun.intensity = SUN_INTENSITY;
    this.sun.autoUpdateExtends = true;
    this.sun.autoCalcShadowZBounds = true;
    // Sky fill: the ambient term of the lit materials, at the fill ratio of the key.
    scene.ambientColor = c3(LIGHT.sky).scale(SUN_INTENSITY * LIGHT_VALUES.fill_ratio);
    this.setQuality(quality);
  }

  /** The quality in force. */
  quality(): Quality {
    return this.level ?? "low";
  }

  /** Creates or disposes the high-quality extras (the shadow map is never created at low). */
  setQuality(q: Quality): void {
    if (q === this.level) return;
    this.level = q;
    if (q === "high") {
      const sg = new ShadowGenerator(SHADOW_MAP_SIZE, this.sun);
      sg.usePercentageCloserFiltering = true;
      sg.filteringQuality = ShadowGenerator.QUALITY_LOW;
      sg.bias = 0.004;
      sg.normalBias = 0.02;
      sg.setDarkness(0.35);
      // Sun and casters are static: the map is drawn once per caster change (refreshShadows).
      const map = sg.getShadowMap();
      if (map) map.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
      this.shadows = sg;
      for (const m of this.casters) sg.addShadowCaster(m, false);
      if (!this.software) this.fxaa = new FxaaPostProcess("fxaa", 1, this.camera);
    } else {
      this.shadows?.dispose();
      this.shadows = null;
      this.fxaa?.dispose(this.camera);
      this.fxaa = null;
    }
  }

  /**
   * Meshes that cast into the shadow map (buildings and trees of the
   * islands at near LOD); the map is redrawn once (call it again after the
   * casters' instances changed).
   */
  setCasters(meshes: readonly AbstractMesh[]): void {
    const same = meshes.length === this.casters.length && meshes.every((m, i) => m === this.casters[i]);
    if (!same) {
      this.casters = [...meshes];
      const list = this.shadows?.getShadowMap()?.renderList;
      if (list) list.length = 0;
      if (this.shadows) for (const m of this.casters) this.shadows.addShadowCaster(m, false);
    }
    this.shadows?.getShadowMap()?.resetRefreshCounter();
  }

  effects(): Effects {
    return { quality: this.quality(), shadowMap: this.shadows !== null, fxaa: this.fxaa !== null, software: this.software };
  }
}

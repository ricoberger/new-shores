// Fixed golden-hour lighting (ART_DIRECTION §2, §8): one warm directional
// sun fixed to the world (it does not follow the camera's 90° steps), a
// cool hemispheric sky fill at LIGHT_VALUES.fill_ratio of the key, and the
// quality-dependent extras. "high" (desktop layout): a low-resolution sun
// shadow map from buildings and trees onto the ground, slight warm colour
// grading and FXAA; "low" (touch layouts): none of them is created. The
// soft vignette is part of both. Grading and vignette run in the materials'
// image processing (no extra full-screen pass); FXAA is the only post
// process. No bloom, SSAO or depth of field.
import type { Camera } from "@babylonjs/core/Cameras/camera";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import "@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent";
import { ColorCurves } from "@babylonjs/core/Materials/colorCurves";
import { ImageProcessingConfiguration } from "@babylonjs/core/Materials/imageProcessingConfiguration";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { FxaaPostProcess } from "@babylonjs/core/PostProcesses/fxaaPostProcess";
import type { Scene } from "@babylonjs/core/scene";
import type { Quality } from "../display/quality";
import { LIGHT, LIGHT_VALUES, UI } from "../theme/palette";
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

/** Hue (degrees) of a hex colour. */
function hue(hex: string): number {
  const c = c3(hex);
  const max = Math.max(c.r, c.g, c.b);
  const min = Math.min(c.r, c.g, c.b);
  if (max === min) return 0;
  const d = max - min;
  const h = max === c.r ? ((c.g - c.b) / d) % 6 : max === c.g ? (c.b - c.r) / d + 2 : (c.r - c.g) / d + 4;
  return (h * 60 + 360) % 360;
}

/** Which quality-dependent effects exist (tests). */
export interface Effects {
  quality: Quality;
  shadowMap: boolean;
  grading: boolean;
  fxaa: boolean;
  vignette: boolean;
}

export class SceneLighting {
  readonly sun: DirectionalLight;
  readonly sky: HemisphericLight;
  private shadows: ShadowGenerator | null = null;
  private fxaa: FxaaPostProcess | null = null;
  private level: Quality | null = null;
  private casters: AbstractMesh[] = [];

  constructor(
    private readonly scene: Scene,
    private readonly camera: Camera,
    quality: Quality,
  ) {
    this.sun = new DirectionalLight("sun", SUN_DIRECTION.clone(), scene);
    this.sun.diffuse = c3(LIGHT.sun);
    this.sun.specular = c3(LIGHT.sun).scale(0.6);
    this.sun.intensity = SUN_INTENSITY;
    this.sun.autoUpdateExtends = true;
    this.sun.autoCalcShadowZBounds = true;
    this.sky = new HemisphericLight("sky", new Vector3(0, 1, 0), scene);
    this.sky.diffuse = c3(LIGHT.sky);
    this.sky.groundColor = c3(LIGHT.ground);
    this.sky.specular.set(0, 0, 0);
    this.sky.intensity = SUN_INTENSITY * LIGHT_VALUES.fill_ratio;

    // Soft vignette at every quality (material image processing).
    const ip = scene.imageProcessingConfiguration;
    ip.vignetteEnabled = true;
    ip.vignetteBlendMode = ImageProcessingConfiguration.VIGNETTEMODE_MULTIPLY;
    const ink = c3(UI.ink);
    ip.vignetteColor = new Color4(ink.r, ink.g, ink.b, 0);
    ip.vignetteWeight = 1.6;
    ip.vignetteStretch = 0.4;
    ip.vignetteCameraFov = 0.9;
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
    const ip = this.scene.imageProcessingConfiguration;
    if (q === "high") {
      const sg = new ShadowGenerator(SHADOW_MAP_SIZE, this.sun);
      sg.usePercentageCloserFiltering = true;
      sg.filteringQuality = ShadowGenerator.QUALITY_LOW;
      sg.bias = 0.004;
      sg.normalBias = 0.02;
      sg.setDarkness(0.35);
      this.shadows = sg;
      for (const m of this.casters) sg.addShadowCaster(m, false);
      const curves = new ColorCurves();
      curves.globalHue = hue(LIGHT.grade);
      curves.globalDensity = 18;
      curves.globalSaturation = 8;
      curves.shadowsHue = hue(LIGHT.sky);
      curves.shadowsDensity = 8;
      ip.colorCurves = curves;
      ip.colorCurvesEnabled = true;
      this.fxaa = new FxaaPostProcess("fxaa", 1, this.camera);
    } else {
      this.shadows?.dispose();
      this.shadows = null;
      this.fxaa?.dispose(this.camera);
      this.fxaa = null;
      ip.colorCurvesEnabled = false;
    }
  }

  /** Meshes that cast into the shadow map (buildings and trees of the islands at near LOD). */
  setCasters(meshes: readonly AbstractMesh[]): void {
    const same = meshes.length === this.casters.length && meshes.every((m, i) => m === this.casters[i]);
    if (same) return;
    this.casters = [...meshes];
    const sg = this.shadows;
    if (!sg) return;
    const list = sg.getShadowMap()?.renderList;
    if (list) list.length = 0;
    for (const m of this.casters) sg.addShadowCaster(m, false);
  }

  effects(): Effects {
    const ip = this.scene.imageProcessingConfiguration;
    return {
      quality: this.quality(),
      shadowMap: this.shadows !== null,
      grading: ip.colorCurvesEnabled,
      fxaa: this.fxaa !== null,
      vignette: ip.vignetteEnabled,
    };
  }
}

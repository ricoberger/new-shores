// One draw for the variants of a thin-instance class (smoke puffs in four
// sizes). The mesh holds every variant's geometry, each vertex tagged with
// its variant (`lifeVar`); every instance names the variant it draws
// (`lifeSel`, a per-instance buffer) and the vertex shader throws the other
// variants' vertices out of the clip volume, so they rasterise nothing. The
// extra vertex work is a few hundred vertices per instance at most.
import type { Material } from "@babylonjs/core/Materials/material";
import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase";

/** Per-vertex variant index (float) and per-instance selected variant (float). */
export const VARIANT_VERTEX = "lifeVar";
export const VARIANT_INSTANCE = "lifeSel";

export class VariantPlugin extends MaterialPluginBase {
  constructor(material: Material) {
    super(material, "Variants", 230, { VARIANTS: false });
    this._enable(true);
  }

  override prepareDefines(defines: Record<string, unknown>): void {
    defines["VARIANTS"] = true;
  }

  override getClassName(): string {
    return "VariantPlugin";
  }

  override getAttributes(attributes: string[]): void {
    attributes.push(VARIANT_VERTEX, VARIANT_INSTANCE);
  }

  override getCustomCode(shaderType: string): Record<string, string> | null {
    if (shaderType !== "vertex") return null;
    return {
      CUSTOM_VERTEX_DEFINITIONS: `#ifdef VARIANTS\nattribute float ${VARIANT_VERTEX};\nattribute float ${VARIANT_INSTANCE};\n#endif`,
      CUSTOM_VERTEX_MAIN_END: `#ifdef VARIANTS\n  if (abs(${VARIANT_VERTEX} - ${VARIANT_INSTANCE}) > 0.5) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); }\n#endif`,
    };
  }
}

/** Adds the variant plugin to a material (once). */
export function addVariants<T extends Material>(m: T): T {
  if (!m.pluginManager?.getPlugin("Variants")) new VariantPlugin(m);
  return m;
}

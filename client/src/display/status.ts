// Status sentences and suggested fixes (MECHANICS §14, UI.md §7). These are
// string templates over server fields: no rule is evaluated here.
import type { BuildingDisplay, Content, DisplayState, IslandDisplay } from "../api/client";
import { STATUS } from "../theme/palette";
import { t } from "../i18n";
import { percent, perMin, units } from "./format";

export type StatusKey =
  | "paused_player"
  | "paused_unpaid"
  | "not_connected"
  | "warehouse_full"
  | "input_starved"
  | "throttled"
  | "short_of_workers"
  | "low_efficiency"
  | "not_adjacent"
  | "ok";

export interface StatusStyle {
  /** Glyph shown with the colour (never colour alone). */
  glyph: string;
  /** Colour-blind-safe colour (Okabe–Ito, from the palette's status group). */
  color: string;
}

export const STATUS_STYLES: Record<StatusKey, StatusStyle> = {
  paused_player: { glyph: "II", color: STATUS.paused_player },
  paused_unpaid: { glyph: "$", color: STATUS.paused_unpaid },
  not_connected: { glyph: "×", color: STATUS.not_connected },
  warehouse_full: { glyph: "▲", color: STATUS.warehouse_full },
  input_starved: { glyph: "?", color: STATUS.input_starved },
  throttled: { glyph: "»", color: STATUS.throttled },
  short_of_workers: { glyph: "W", color: STATUS.short_of_workers },
  low_efficiency: { glyph: "%", color: STATUS.low_efficiency },
  not_adjacent: { glyph: "∅", color: STATUS.not_adjacent },
  ok: { glyph: "✓", color: STATUS.ok },
};

/** The short status label ("Paused", "Not connected", …) shown with the glyph. */
export function statusLabel(key: StatusKey): string {
  return t(`status.label.${key}`);
}

export function statusKey(b: BuildingDisplay): StatusKey {
  if (b.status === "paused") {
    return b.paused_reason === "unpaid" ? "paused_unpaid" : "paused_player";
  }
  return b.status;
}

export interface StatusText {
  key: StatusKey;
  sentence: string;
  fix: string;
}

function goodName(content: Content, id: string): string {
  return content.goods.find((g) => g.id === id)?.name ?? id;
}

/**
 * The plural display name of the field type a farm accepts (content field
 * building name, e.g. "Pasture" -> "pastures"); "fields" when unknown.
 */
export function fieldsPlural(content: Content, farmType: string): string {
  const farm = content.buildings.find((d) => d.id === farmType);
  const field = content.buildings.find((d) => d.field !== undefined && d.field.type === farm?.fields?.type);
  return field ? t("status.fieldsPlural", { name: field.name.toLowerCase() }) : t("status.fields");
}

function tierName(content: Content, id: string): string {
  return content.tiers.find((t) => t.id === id)?.name ?? id;
}

/** The one-sentence status of a building with its suggested fix. */
export function statusText(b: BuildingDisplay, island: IslandDisplay, display: DisplayState, content: Content): StatusText {
  const key = statusKey(b);
  switch (key) {
    case "paused_player":
      return { key, sentence: t("status.paused_player.sentence"), fix: t("status.paused_player.fix") };
    case "paused_unpaid":
      return {
        key,
        sentence: t("status.paused_unpaid.sentence", { rate: perMin(display.balance_rate_per_min, true) }),
        fix: t("status.paused_unpaid.fix"),
      };
    case "not_connected": {
      const shipyard = content.buildings.find((d) => d.id === b.type)?.shipyard !== undefined;
      return {
        key,
        sentence: t("status.not_connected.sentence"),
        fix: shipyard ? t("status.not_connected.fixShipyard") : t("status.not_connected.fix"),
      };
    }
    case "input_starved": {
      const goods = (b.status_goods ?? []).map((g) => t("status.input_starved.good", { name: goodName(content, g), rate: perMin(island.inventory[g]?.rate_per_min ?? 0) }));
      return { key, sentence: t("status.input_starved.sentence", { goods: goods.join(", ") || t("status.input_starved.inputs") }), fix: t("status.input_starved.fix") };
    }
    case "warehouse_full": {
      const parts = (b.status_goods ?? []).map((g) => {
        const inv = island.inventory[g];
        return t("status.warehouse_full.good", { name: goodName(content, g), stock: units(inv?.stock ?? 0), capacity: units(inv?.capacity ?? 0) });
      });
      return { key, sentence: parts.join(", ") || t("status.warehouse_full.sentence"), fix: t("status.warehouse_full.fix") };
    }
    case "throttled": {
      const wh = island.buildings.find((w) => w.id === b.assigned_warehouse_id);
      const name = wh ? (content.buildings.find((d) => d.id === wh.type)?.name ?? wh.type) : t("status.throttled.collector");
      return {
        key,
        sentence: t("status.throttled.sentence", { name, load: percent(wh?.load_permille ?? 0) }),
        fix: t("status.throttled.fix"),
      };
    }
    case "short_of_workers": {
      const tier = b.workforce?.tier ?? "";
      return {
        key,
        sentence: t("status.short_of_workers.sentence", {
          required: units(b.workforce?.required ?? 0),
          tier: tierName(content, tier),
          available: units(island.workforce[tier]?.available ?? 0),
        }),
        fix: t("status.short_of_workers.fix"),
      };
    }
    case "low_efficiency":
      if (b.fields) {
        return {
          key,
          sentence: t("status.low_efficiency.fields", { active: b.fields.active, required: b.fields.required }),
          fix: t("status.low_efficiency.fixFields", { fields: fieldsPlural(content, b.type) }),
        };
      }
      return { key, sentence: t("status.low_efficiency.sentence", { percent: percent(b.efficiency_permille) }), fix: t("status.low_efficiency.fix") };
    case "not_adjacent":
      return { key, sentence: t("status.not_adjacent.sentence"), fix: t("status.not_adjacent.fix") };
    case "ok":
      return { key, sentence: t("status.ok.sentence"), fix: "" };
  }
}

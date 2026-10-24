// Status sentences and suggested fixes (MECHANICS §14, UI.md §7). These are
// string templates over server fields: no rule is evaluated here.
import type { BuildingDisplay, Content, DisplayState, IslandDisplay } from "../api/client";
import { STATUS } from "../theme/palette";
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
  label: string;
}

export const STATUS_STYLES: Record<StatusKey, StatusStyle> = {
  paused_player: { glyph: "II", color: STATUS.paused_player, label: "Paused" },
  paused_unpaid: { glyph: "$", color: STATUS.paused_unpaid, label: "Unpaid" },
  not_connected: { glyph: "×", color: STATUS.not_connected, label: "Not connected" },
  warehouse_full: { glyph: "▲", color: STATUS.warehouse_full, label: "Warehouse full" },
  input_starved: { glyph: "?", color: STATUS.input_starved, label: "Input missing" },
  throttled: { glyph: "»", color: STATUS.throttled, label: "Throttled" },
  short_of_workers: { glyph: "W", color: STATUS.short_of_workers, label: "Short of workers" },
  low_efficiency: { glyph: "%", color: STATUS.low_efficiency, label: "Low efficiency" },
  not_adjacent: { glyph: "∅", color: STATUS.not_adjacent, label: "Not adjacent" },
  ok: { glyph: "✓", color: STATUS.ok, label: "Running" },
};

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
  return field ? `${field.name.toLowerCase()}s` : "fields";
}

function tierName(content: Content, id: string): string {
  return content.tiers.find((t) => t.id === id)?.name ?? id;
}

/** The one-sentence status of a building with its suggested fix. */
export function statusText(b: BuildingDisplay, island: IslandDisplay, display: DisplayState, content: Content): StatusText {
  const key = statusKey(b);
  switch (key) {
    case "paused_player":
      return { key, sentence: "Paused by you", fix: "Resume it." };
    case "paused_unpaid":
      return {
        key,
        sentence: `Paused: insufficient gold (balance ${perMin(display.balance_rate_per_min, true)}/min)`,
        fix: "Demolish buildings, grow houses or resume manually.",
      };
    case "not_connected": {
      const shipyard = content.buildings.find((d) => d.id === b.type)?.shipyard !== undefined;
      return {
        key,
        sentence: "No road to the Trading Post or a Warehouse",
        fix: shipyard
          ? "Build a road next to it that leads to the Trading Post or a Warehouse; a shipyard can only order ships when connected."
          : "Build a road next to it that leads to the Trading Post or a Warehouse.",
      };
    }
    case "input_starved": {
      const goods = (b.status_goods ?? []).map(
        (g) => `${goodName(content, g)} (${perMin(island.inventory[g]?.rate_per_min ?? 0)}/min)`,
      );
      return { key, sentence: `Missing: ${goods.join(", ") || "inputs"}`, fix: "Build a producer of the missing good." };
    }
    case "warehouse_full": {
      const parts = (b.status_goods ?? []).map((g) => {
        const inv = island.inventory[g];
        return `${goodName(content, g)} at capacity (${units(inv?.stock ?? 0)}/${units(inv?.capacity ?? 0)})`;
      });
      return { key, sentence: parts.join(", ") || "Trading Post full", fix: "Upgrade the Trading Post or consume the good." };
    }
    case "throttled": {
      const wh = island.buildings.find((w) => w.id === b.assigned_warehouse_id);
      const name = wh ? (content.buildings.find((d) => d.id === wh.type)?.name ?? wh.type) : "Collector";
      return {
        key,
        sentence: `${name} overloaded (${percent(wh?.load_permille ?? 0)})`,
        fix: "Build a Warehouse nearby or upgrade the collector.",
      };
    }
    case "short_of_workers": {
      const tier = b.workforce?.tier ?? "";
      return {
        key,
        sentence: `Needs ${units(b.workforce?.required ?? 0)} ${tierName(content, tier)} on this island (${units(
          island.workforce[tier]?.available ?? 0,
        )} available)`,
        fix: "Build houses on this island.",
      };
    }
    case "low_efficiency":
      if (b.fields) {
        return {
          key,
          sentence: `${b.fields.active} / ${b.fields.required} fields`,
          fix: `Add more ${fieldsPlural(content, b.type)} next to the farm or its fields.`,
        };
      }
      return { key, sentence: `Only ${percent(b.efficiency_permille)} usable land in range`, fix: "Move it to more suitable land." };
    case "not_adjacent":
      return { key, sentence: "Not connected to its farm", fix: "Add or rebuild the fields between it and the farm." };
    case "ok":
      return { key, sentence: "Running", fix: "" };
  }
}

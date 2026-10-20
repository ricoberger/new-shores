// Status sentences and suggested fixes (MECHANICS §14, UI.md §7). These are
// string templates over server fields: no rule is evaluated here.
import type { BuildingDisplay, Content, DisplayState, IslandDisplay } from "../api/client";
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
  | "ok";

export interface StatusStyle {
  /** Glyph shown with the colour (never colour alone). */
  glyph: string;
  /** Colour-blind-safe colour (Okabe–Ito palette). */
  color: string;
  label: string;
}

export const STATUS_STYLES: Record<StatusKey, StatusStyle> = {
  paused_player: { glyph: "II", color: "#56B4E9", label: "Paused" },
  paused_unpaid: { glyph: "$", color: "#D55E00", label: "Unpaid" },
  not_connected: { glyph: "×", color: "#CC79A7", label: "Not connected" },
  warehouse_full: { glyph: "▲", color: "#E69F00", label: "Warehouse full" },
  input_starved: { glyph: "?", color: "#F0E442", label: "Input missing" },
  throttled: { glyph: "»", color: "#0072B2", label: "Throttled" },
  short_of_workers: { glyph: "W", color: "#999999", label: "Short of workers" },
  low_efficiency: { glyph: "%", color: "#009E73", label: "Low efficiency" },
  ok: { glyph: "✓", color: "#009E73", label: "Running" },
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
    case "not_connected":
      return { key, sentence: "No road to a warehouse", fix: "Build a road next to it that leads to a warehouse." };
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
      return { key, sentence: parts.join(", ") || "Warehouse full", fix: "Upgrade the warehouse or consume the good." };
    }
    case "throttled": {
      const wh = island.buildings.find((w) => w.id === b.assigned_warehouse_id);
      return {
        key,
        sentence: `Warehouse overloaded (${percent(wh?.load_permille ?? 0)})`,
        fix: "Build a second warehouse nearby.",
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
      return { key, sentence: `Only ${percent(b.efficiency_permille)} usable land in range`, fix: "Move it to more suitable land." };
    case "ok":
      return { key, sentence: "Running", fix: "" };
  }
}

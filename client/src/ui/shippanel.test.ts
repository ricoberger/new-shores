import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Content, DisplayState, ShipDisplay } from "../api/client";
import { ShipPanel } from "./ShipPanel";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "server", "testdata", "display");
const model = (JSON.parse(readFileSync(join(fixtureDir, "settlers_grow.json"), "utf8")) as { base: DisplayState }).base;
const text = (html: string) => html.replace(/<[^>]+>/g, "");

const content = {
  goods: [],
  ships: [{ id: "sloop", name: "Sloop", slots: 4, slot_size: 50_000, speed_permille: 1400, build_ms: 1, upkeep_per_min: 1_000, cost: { gold: 0, materials: {} } }],
} as unknown as Content;

describe("ship panel", () => {
  it("shows upkeep, speed and capacity of the ship type", () => {
    const ship = { id: 1, type: "sloop", state: "idle", island_id: model.islands[0]!.id, route_id: 0, stop_index: 0, leg: null, cargo: [], slots: 4, slot_size: 50_000, upkeep_per_min: 1_000, paused: false, paused_reason: "", position: null, queued_at: null, berth_until: null } as unknown as ShipDisplay;
    const noop = () => {};
    const html = renderToStaticMarkup(
      createElement(ShipPanel, { ship, model, content, nowMs: 0, onAssign: noop, onOpenRoutes: noop, onUnassign: noop, onSend: noop, onFound: noop, onScrap: noop, onClose: noop } as never),
    );
    expect(text(html)).toContain("Upkeep 1.0 $/minSpeed 1.4×Capacity 4 slots of 50 each");
  });
});

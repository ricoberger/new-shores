import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Content, DisplayState, ShipDisplay } from "../api/client";
import { ShipmentDialog } from "./ShipmentDialog";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "server", "testdata", "display");
const base = (JSON.parse(readFileSync(join(fixtureDir, "settlers_grow.json"), "utf8")) as { base: DisplayState }).base;
const home = base.islands[0]!;
// A second, unsettled island as the destination.
const model = { ...base, islands: [home, { ...home, id: "isle-02", name: "Second", settled: false, scenic: false, inventory: {} }] } as DisplayState;

const content = {
  goods: [{ id: "planks", name: "Planks" }],
  ships: [{ id: "cog", name: "Cog", slots: 2, slot_size: 50_000, speed_permille: 1400, build_ms: 1, upkeep_per_min: 1_000, cost: { gold: 0, materials: {} } }],
} as unknown as Content;

const ship = { id: 1, type: "cog", name: "Gull", state: "idle", island_id: home.id, route_id: 0, stop_index: 0, leg: null, cargo: [], slots: 2, slot_size: 50_000, upkeep_per_min: 1_000, paused: false, paused_reason: "", position: null, queued_at: null, berth_until: null } as unknown as ShipDisplay;

const sendButton = (html: string) => html.match(/<button[^>]*data-testid="shipment-send"[^>]*>/)?.[0] ?? "";

describe("shipment dialog", () => {
  it("enables Send for an empty ship once a destination is chosen", () => {
    const noop = () => {};
    const html = renderToStaticMarkup(createElement(ShipmentDialog, { ship, initialTo: "isle-02", model, content, onSend: noop, onClose: noop }));
    expect(html).toContain('value="isle-02"');
    expect(sendButton(html)).not.toBe("");
    expect(sendButton(html)).not.toContain("disabled");
    // The slot line stays (0 of 2 slots, no warning).
    expect(html).toMatch(/data-testid="shipment-slots">[^<]*0[^<]*2/);
  });

  it("keeps Send disabled without a destination", () => {
    const noop = () => {};
    const alone = { ...model, islands: [home] } as DisplayState;
    const html = renderToStaticMarkup(createElement(ShipmentDialog, { ship, model: alone, content, onSend: noop, onClose: noop }));
    expect(sendButton(html)).toContain("disabled");
  });
});

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Content, DisplayState, ShipDisplay } from "../api/client";
import { ShipmentDialog, shipmentCommand } from "./ShipmentDialog";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "server", "testdata", "display");
const base = (JSON.parse(readFileSync(join(fixtureDir, "settlers_grow.json"), "utf8")) as { base: DisplayState }).base;
const home = base.islands[0]!;
// A second, unsettled island as the destination.
const model = { ...base, islands: [home, { ...home, id: "oc-02", name: "Second", settled: false, scenic: false, inventory: {} }] } as DisplayState;

const content = {
  goods: [{ id: "planks", name: "Planks" }],
  ships: [{ id: "cog", name: "Cog", slots: 2, slot_size: 50_000, speed_permille: 1400, build_ms: 1, upkeep_per_min: 1_000, cost: { gold: 0, materials: {} } }],
} as unknown as Content;

const ship = { id: 1, type: "cog", name: "Gull", state: "idle", island_id: home.id, route_id: 0, stop_index: 0, leg: null, cargo: [], slots: 2, slot_size: 50_000, upkeep_per_min: 1_000, paused: false, paused_reason: "", position: null, queued_at: null, berth_until: null } as unknown as ShipDisplay;

const sendButton = (html: string) => html.match(/<button[^>]*data-testid="shipment-send"[^>]*>/)?.[0] ?? "";

describe("shipment dialog", () => {
  it("enables Send for an empty ship once a destination is chosen", () => {
    const noop = () => {};
    const html = renderToStaticMarkup(createElement(ShipmentDialog, { ship, initialTo: "oc-02", model, content, onSend: noop, onClose: noop }));
    expect(html).toContain('value="oc-02"');
    expect(sendButton(html)).not.toBe("");
    expect(sendButton(html)).not.toContain("disabled");
    // The slot line stays (0 of 2 slots, no warning).
    expect(html).toMatch(/data-testid="shipment-slots">[^<]*0[^<]*2/);
  });

  it("disables Send while the cargo exceeds the ship's slots; the warning line stays", () => {
    const noop = () => {};
    // 60 t of planks (2 slots of 50 t) and 10 t of wood (1): 3 of 2 slots.
    const over = { ...ship, cargo: [{ good: "planks", amount: 60_000 }, { good: "wood", amount: 10_000 }] } as unknown as ShipDisplay;
    const html = renderToStaticMarkup(createElement(ShipmentDialog, { ship: over, initialTo: "oc-02", model, content, onSend: noop, onClose: noop }));
    expect(sendButton(html)).toContain("disabled");
    expect(html).toMatch(/class="[^"]*warn[^"]*" data-testid="shipment-slots">[^<]*3[^<]*2/);
    // Within the slots (2 of 2) Send stays enabled.
    const full = { ...ship, cargo: [{ good: "planks", amount: 60_000 }] } as unknown as ShipDisplay;
    const ok = renderToStaticMarkup(createElement(ShipmentDialog, { ship: full, initialTo: "oc-02", model, content, onSend: noop, onClose: noop }));
    expect(sendButton(ok)).not.toContain("disabled");
    expect(ok).not.toMatch(/class="[^"]*warn[^"]*" data-testid="shipment-slots"/);
  });

  it("keeps Send disabled without a destination", () => {
    const noop = () => {};
    const alone = { ...model, islands: [home] } as DisplayState;
    const html = renderToStaticMarkup(createElement(ShipmentDialog, { ship, model: alone, content, onSend: noop, onClose: noop }));
    expect(sendButton(html)).toContain("disabled");
  });
});

describe("shipmentCommand", () => {
  const aboard = [{ good: "planks", amount: 10_000 }];
  it("sails an empty ship with sail_ship (the server rejects an empty manual_shipment)", () => {
    expect(shipmentCommand(1, "oc-02", [], [])).toEqual({ type: "sail_ship", ship_id: 1, to_island_id: "oc-02" });
  });
  it("ships goods with manual_shipment when something is chosen or already aboard", () => {
    const cargo = [{ good: "planks", amount: 5_000 }];
    expect(shipmentCommand(1, "oc-02", cargo, [])).toEqual({ type: "manual_shipment", ship_id: 1, to_island_id: "oc-02", cargo });
    expect(shipmentCommand(1, "oc-02", [], aboard)).toEqual({ type: "manual_shipment", ship_id: 1, to_island_id: "oc-02", cargo: [] });
  });
  it("shows the empty hint only for an empty ship without chosen cargo", () => {
    const noop = () => {};
    const html = renderToStaticMarkup(createElement(ShipmentDialog, { ship, initialTo: "oc-02", model, content, onSend: noop, onClose: noop }));
    expect(html).toContain('data-testid="shipment-empty"');
    const loaded = { ...ship, cargo: aboard } as unknown as ShipDisplay;
    const html2 = renderToStaticMarkup(createElement(ShipmentDialog, { ship: loaded, initialTo: "oc-02", model, content, onSend: noop, onClose: noop }));
    expect(html2).not.toContain('data-testid="shipment-empty"');
  });
});

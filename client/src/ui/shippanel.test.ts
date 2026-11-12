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
  ships: [{ id: "cog", name: "Cog", slots: 4, slot_size: 50_000, speed_permille: 1400, build_ms: 1, upkeep_per_min: 1_000, cost: { gold: 0, materials: {} } }],
} as unknown as Content;

describe("ship panel", () => {
  it("shows upkeep, speed and capacity of the ship type", () => {
    const ship = { id: 1, type: "cog", name: "Cog 1", state: "idle", island_id: model.islands[0]!.id, route_id: 0, stop_index: 0, leg: null, cargo: [], slots: 4, slot_size: 50_000, upkeep_per_min: 1_000, paused: false, paused_reason: "", position: null, queued_at: null, berth_until: null } as unknown as ShipDisplay;
    const noop = () => {};
    const html = renderToStaticMarkup(
      createElement(ShipPanel, { ship, model, content, nowMs: 0, onAssign: noop, onOpenRoutes: noop, onUnassign: noop, onSend: noop, onFound: noop, onScrap: noop, onClose: noop } as never),
    );
    expect(text(html)).toContain("Maintenance 1.0 gold/minSpeed 1.4×Capacity 4 slots of 50\u00a0t each");
  });

  it("is titled with the ship's name, its type below, and renames it in the header like an island (D-055)", () => {
    const ship = { id: 2, type: "cog", name: "Gull", state: "idle", island_id: model.islands[0]!.id, route_id: 0, stop_index: 0, leg: null, cargo: [], slots: 4, slot_size: 50_000, upkeep_per_min: 1_000, paused: false, paused_reason: "", position: null, queued_at: null, berth_until: null } as unknown as ShipDisplay;
    const noop = () => {};
    const props = { ship, model, content, nowMs: 0, onAssign: noop, onOpenRoutes: noop, onUnassign: noop, onPatrol: noop, onSend: noop, onFound: noop, onScrap: noop, onClose: noop, onRename: () => Promise.resolve(true) };
    const html = renderToStaticMarkup(createElement(ShipPanel, props));
    expect(html).toMatch(/data-testid="ship-panel-name">Gull<\/h2>/);
    expect(html).toMatch(/data-testid="ship-panel-type">Cog</);
    // A "Details" heading between the type line and the state (the building panels' heading).
    expect(text(html)).toMatch(/^GullCogDetailsIdle/);
    // A "Slots" heading over the cargo slots, no divider entry around them.
    expect(html).toMatch(/data-testid="ship-panel-slots-title">Slots<\/div><div class="[^"]*" data-testid="ship-panel-cargo"/);
    expect(html).not.toMatch(/class="[^"]*shipEntry[^"]*"[^>]*data-testid="ship-panel-cargo"/);
    expect(text(html)).not.toContain("#2");
    expect(html).toMatch(/<button[^>]*aria-label="Rename the ship"[^>]*data-testid="ship-rename"><svg/);
    expect(html).toContain('data-testid="ship-panel-close"');
    const naming = renderToStaticMarkup(createElement(ShipPanel, { ...props, initiallyRenaming: true }));
    expect(naming).toMatch(/<input[^>]*aria-label="Ship name"[^>]*data-testid="ship-rename-input" value="Gull"/);
    expect(naming).toMatch(/<button type="submit"[^>]*aria-label="Rename"[^>]*data-testid="ship-rename-save"><svg/);
    expect(naming).toMatch(/<button type="button"[^>]*aria-label="Cancel renaming"[^>]*data-testid="ship-rename-cancel"><svg/);
    expect(naming).not.toContain('data-testid="ship-panel-name"');
    expect(naming).not.toContain('data-testid="ship-panel-close"');
  });

  it("a warship (D-077 §6): attack without effect, no cargo, Patrol… when idle; a patrolling ship names its island and stops", () => {
    const warContent = { goods: [], ships: [{ id: "war_cog", name: "War cog", slots: 0, slot_size: 0, speed_permille: 1000, attack: 4, build_ms: 1, upkeep_per_min: 2_000, cost: { gold: 0, materials: {} } }] } as unknown as Content;
    const island = model.islands[0]!;
    const base = { id: 3, type: "war_cog", name: "War cog 3", state: "idle", island_id: island.id, region_id: island.region_id, route_id: 0, stop_index: 0, leg: null, cargo: [], slots: 0, slot_size: 0, upkeep_per_min: 2_000, paused: false, paused_reason: "", position: null, queued_at: null, berth_until: null };
    const noop = () => {};
    const props = { model, content: warContent, nowMs: 0, onAssign: noop, onOpenRoutes: noop, onUnassign: noop, onPatrol: noop, onSend: noop, onFound: noop, onScrap: noop, onClose: noop, onRename: () => Promise.resolve(true) };
    const idle = renderToStaticMarkup(createElement(ShipPanel, { ...props, ship: base as unknown as ShipDisplay }));
    expect(text(idle)).toContain("Attack 4 (no effect yet)");
    expect(text(idle)).toContain("Carries no cargo");
    expect(idle).not.toContain('data-testid="ship-panel-slots-title"');
    expect(idle).toMatch(/data-testid="ship-panel-patrol">Patrol…</);
    const patrol = { island_id: island.id, started_at: "2026-01-01T00:00:00.000Z", approach: [], approach_ms: 0, loop: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }], loop_ms: 60_000 };
    const on = renderToStaticMarkup(createElement(ShipPanel, { ...props, ship: { ...base, state: "patrolling", island_id: "", patrol } as unknown as ShipDisplay }));
    expect(on).toMatch(new RegExp(`data-testid="ship-panel-state">Patrolling: ${island.name || island.id}<`));
    expect(on).toMatch(/data-testid="ship-panel-stop-patrol">Stop patrol</);
    expect(on).not.toContain('data-testid="ship-panel-patrol"');
  });
});

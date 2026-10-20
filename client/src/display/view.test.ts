import { describe, expect, it } from "vitest";
import { initialViewState, type ViewAction, viewReducer, type ViewState, ZOOM_OUT_RESET_MS, ZOOM_OUT_THRESHOLD } from "./view";

const run = (s: ViewState, ...actions: ViewAction[]) => actions.reduce(viewReducer, s);
const island = (id = "start") => initialViewState({ kind: "island", id });
const arch = () => initialViewState({ kind: "archipelago" });
const draft = { name: "", stops: [] };

describe("view transitions", () => {
  it("switches to the archipelago only after the zoom-out threshold at the island maximum", () => {
    const tick = 300;
    let s = run(island(), { type: "zoomOutAtMax", amount: tick, atMs: 0 });
    expect(s.view).toEqual({ kind: "island", id: "start" }); // one tick never switches
    s = run(s, { type: "zoomOutAtMax", amount: ZOOM_OUT_THRESHOLD - tick - 1, atMs: 100 });
    expect(s.view.kind).toBe("island");
    s = run(s, { type: "zoomOutAtMax", amount: 1, atMs: 200 });
    expect(s.view).toEqual({ kind: "archipelago" });
    expect(s.zoomOut.amount).toBe(0);
  });

  it("forgets the accumulated zoom-out on another zoom or after a pause", () => {
    const half = ZOOM_OUT_THRESHOLD / 2;
    expect(run(island(), { type: "zoomOutAtMax", amount: half, atMs: 0 }, { type: "zoomReset" }, { type: "zoomOutAtMax", amount: half, atMs: 10 }).view.kind).toBe(
      "island",
    );
    expect(
      run(island(), { type: "zoomOutAtMax", amount: half, atMs: 0 }, { type: "zoomOutAtMax", amount: half, atMs: ZOOM_OUT_RESET_MS + 1 }).view.kind,
    ).toBe("island");
    // Zooming in the archipelago never switches back.
    expect(run(arch(), { type: "zoomOutAtMax", amount: 10_000, atMs: 0 }, { type: "zoomReset" }).view.kind).toBe("archipelago");
  });

  it("enters an island by a second tap, Enter or enterIsland and goes back", () => {
    let s = run(arch(), { type: "tapIsland", id: "island2" });
    expect(s.view.kind).toBe("archipelago");
    expect(s.selection).toEqual({ kind: "island", id: "island2" });
    s = run(s, { type: "tapIsland", id: "island2" });
    expect(s.view).toEqual({ kind: "island", id: "island2" });
    expect(s.selection).toEqual({ kind: "none" });
    s = run(s, { type: "keyBack" });
    expect(s.view).toEqual({ kind: "archipelago" });
    s = run(s, { type: "tapIsland", id: "start" }, { type: "keyEnter" });
    expect(s.view).toEqual({ kind: "island", id: "start" });
    expect(run(s, { type: "toArchipelago" }, { type: "enterIsland", id: "island2" }).view).toEqual({ kind: "island", id: "island2" });
    // Enter without a selected island does nothing.
    expect(run(arch(), { type: "keyEnter" }).view.kind).toBe("archipelago");
  });

  it("switching views clears the building selection but keeps a ship selection and the editor", () => {
    const s = run(island(), { type: "selectBuilding", id: 4 }, { type: "toArchipelago" });
    expect(s.selection).toEqual({ kind: "none" });
    const t = run(island(), { type: "selectShip", id: 1 }, { type: "toArchipelago" });
    expect(t.selection).toEqual({ kind: "ship", id: 1 });
    const e = run(arch(), { type: "openEditor", routeId: null, draft }, { type: "selectShip", id: 2 }, { type: "toArchipelago" });
    expect(e.editor.kind).toBe("open");
    // Entering an island closes the editor (it lives in the archipelago view).
    expect(run(e, { type: "enterIsland", id: "start" }).editor.kind).toBe("closed");
  });
});

describe("selection", () => {
  it("ships before islands, sea clears", () => {
    let s = run(arch(), { type: "tapShip", id: 3 });
    expect(s.selection).toEqual({ kind: "ship", id: 3 });
    s = run(s, { type: "tapIsland", id: "start" });
    expect(s.selection).toEqual({ kind: "island", id: "start" });
    s = run(s, { type: "tapSea" });
    expect(s.selection).toEqual({ kind: "none" });
    expect(run(island(), { type: "selectBuilding", id: 7 }, { type: "selectBuilding", id: null }).selection).toEqual({ kind: "none" });
  });
});

describe("route editor", () => {
  it("opens in the archipelago, appends tapped islands (also repeated ones), removes and reorders stops", () => {
    let s = run(island(), { type: "openEditor", routeId: null, draft, pickingShip: 1 });
    expect(s.view.kind).toBe("archipelago");
    expect(s.editor).toMatchObject({ kind: "open", routeId: null, pickingShip: 1 });
    s = run(s, { type: "tapIsland", id: "a" }, { type: "tapIsland", id: "b" }, { type: "tapIsland", id: "b" }, { type: "appendStop", island: "c" });
    const stops = () => (s.editor.kind === "open" ? s.editor.draft.stops.map((x) => x.island) : []);
    expect(stops()).toEqual(["a", "b", "b", "c"]);
    // Taps append stops instead of selecting or entering.
    expect(s.selection).toEqual({ kind: "none" });
    expect(s.view.kind).toBe("archipelago");
    s = run(s, { type: "removeStop", index: 1 });
    expect(stops()).toEqual(["a", "b", "c"]);
    s = run(s, { type: "moveStop", index: 2, delta: -1 });
    expect(stops()).toEqual(["a", "c", "b"]);
    s = run(s, { type: "moveStop", index: 0, delta: -1 }, { type: "moveStop", index: 2, delta: 1 });
    expect(stops()).toEqual(["a", "c", "b"]);
    // A sea tap keeps the editor and its draft.
    s = run(s, { type: "tapSea" });
    expect(s.editor.kind).toBe("open");
  });

  it("save failure keeps the draft with the error; success keeps the editor on the saved route", () => {
    let s = run(arch(), { type: "openEditor", routeId: null, draft }, { type: "appendStop", island: "a" });
    const session = s.editor.kind === "open" ? s.editor.session : -1;
    s = run(s, { type: "saveFailed", session, error: "route_invalid: stops 0 and 1 are both at a" });
    expect(s.editor).toMatchObject({ kind: "open", routeId: null, error: "route_invalid: stops 0 and 1 are both at a" });
    expect(s.editor.kind === "open" && s.editor.draft.stops.length).toBe(1);
    s = run(s, { type: "saved", session, routeId: 4 });
    expect(s.editor).toMatchObject({ kind: "open", routeId: 4, error: null });
    s = run(s, { type: "setDraft", draft: { name: "Fish", stops: [] } });
    expect(s.editor.kind === "open" && s.editor.draft.name).toBe("Fish");
    expect(run(s, { type: "closeEditor" }).editor.kind).toBe("closed");
  });

  it("a delayed save response of another editor session changes nothing", () => {
    const routeA = { name: "A", stops: [{ island: "a", load: [], unload: [] }] };
    const routeB = { name: "B", stops: [{ island: "b", load: [], unload: [] }] };
    // Save route A (pending), then open route B before A's response arrives.
    let s = run(arch(), { type: "openEditor", routeId: 1, draft: routeA, pickingShip: 7 });
    const sessionA = s.editor.kind === "open" ? s.editor.session : -1;
    s = run(s, { type: "openEditor", routeId: 2, draft: routeB });
    const sessionB = s.editor.kind === "open" ? s.editor.session : -1;
    expect(sessionB).not.toBe(sessionA);
    const late = run(
      s,
      { type: "saved", session: sessionA, routeId: 1 },
      { type: "saveFailed", session: sessionA, error: "late" },
      { type: "clearPickingShip", session: sessionA },
    );
    expect(late).toBe(s);
    expect(late.editor).toMatchObject({ kind: "open", session: sessionB, routeId: 2, draft: routeB, error: null });
    // A new unsaved route is not given A's ID either.
    const fresh = run(arch(), { type: "openEditor", routeId: null, draft }, { type: "closeEditor" }, { type: "openEditor", routeId: null, draft });
    expect(run(fresh, { type: "saved", session: 1, routeId: 9 }).editor).toMatchObject({ routeId: null });
    // The session's own response applies.
    expect(run(s, { type: "saved", session: sessionB, routeId: 2 }).editor).toMatchObject({ routeId: 2 });
  });

  it("selecting a ship (scene or list) or an island suspends the editor; clearing the selection resumes it", () => {
    const editing = run(arch(), { type: "openEditor", routeId: 3, draft }, { type: "appendStop", island: "a" });
    for (const pick of [{ type: "tapShip", id: 5 } as const, { type: "selectShip", id: 5 } as const]) {
      const s = run(editing, pick);
      expect(s.selection).toEqual({ kind: "ship", id: 5 });
      expect(s.editor).toMatchObject({ kind: "open", active: false, routeId: 3 });
      // While suspended, island taps select islands instead of adding stops.
      const t = run(s, { type: "tapIsland", id: "b" });
      expect(t.selection).toEqual({ kind: "island", id: "b" });
      expect(t.editor.kind === "open" && t.editor.draft.stops.map((x) => x.island)).toEqual(["a"]);
      // Closing the panel (clear selection), Esc or a sea tap resumes the editor with its draft.
      for (const back of [{ type: "clearSelection" } as const, { type: "escape" } as const, { type: "tapSea" } as const]) {
        const r = run(t, back);
        expect(r.selection).toEqual({ kind: "none" });
        expect(r.editor).toMatchObject({ kind: "open", active: true });
      }
      expect(run(s, { type: "resumeEditor" }).editor).toMatchObject({ active: true });
    }
    // "Assign to route…" opens the editor active with the ship still selected.
    const assign = run(arch(), { type: "selectShip", id: 5 }, { type: "openEditor", routeId: null, draft, pickingShip: 5 });
    expect(assign.editor).toMatchObject({ kind: "open", active: true, pickingShip: 5 });
  });
});

describe("manual shipment", () => {
  it("drag and drop on another island opens the dialog with the destination; the sea or the same island cancels", () => {
    const drag = run(arch(), { type: "dragShip", shipId: 1, from: "start" });
    expect(drag.shipment).toEqual({ kind: "dragging", shipId: 1, from: "start" });
    expect(run(drag, { type: "dropShip", island: "island2" })).toMatchObject({ shipment: { kind: "none" }, dialog: { shipId: 1, to: "island2" } });
    expect(run(drag, { type: "dropShip", island: null })).toMatchObject({ shipment: { kind: "none" }, dialog: null });
    expect(run(drag, { type: "dropShip", island: "start" })).toMatchObject({ shipment: { kind: "none" }, dialog: null });
    // Not in the island view.
    expect(run(island(), { type: "dragShip", shipId: 1, from: "start" }).shipment.kind).toBe("none");
  });

  it("click–click: Send to… then a tap on the target island", () => {
    let s = run(arch(), { type: "selectShip", id: 1 }, { type: "sendTo", shipId: 1, from: "start" });
    expect(s.shipment.kind).toBe("awaitingTarget");
    s = run(s, { type: "tapIsland", id: "island2" });
    expect(s).toMatchObject({ shipment: { kind: "none" }, dialog: { shipId: 1, to: "island2" }, selection: { kind: "ship", id: 1 } });
    expect(run(s, { type: "closeShipment" }).dialog).toBeNull();
    const cancelled = run(arch(), { type: "sendTo", shipId: 1, from: "start" }, { type: "tapSea" });
    expect(cancelled).toMatchObject({ shipment: { kind: "none" }, dialog: null });
    expect(run(arch(), { type: "openShipment", shipId: 2, to: null }).dialog).toEqual({ shipId: 2, to: null });
  });
});

describe("Esc", () => {
  it("closes the shipment interaction, then the editor's pick, then the editor, then the selection — one step per press", () => {
    let s = run(
      arch(),
      { type: "selectShip", id: 1 },
      { type: "openEditor", routeId: null, draft, pickingShip: 1 },
      { type: "dragShip", shipId: 1, from: "start" },
    );
    s = run(s, { type: "escape" });
    expect(s.shipment.kind).toBe("none");
    expect(s.editor).toMatchObject({ kind: "open", pickingShip: 1 });
    s = run(s, { type: "escape" });
    expect(s.editor).toMatchObject({ kind: "open", pickingShip: null });
    s = run(s, { type: "escape" });
    expect(s.editor.kind).toBe("closed");
    expect(s.selection).toEqual({ kind: "ship", id: 1 });
    s = run(s, { type: "escape" });
    expect(s.selection).toEqual({ kind: "none" });
    expect(run(s, { type: "escape" })).toBe(s);
  });
});

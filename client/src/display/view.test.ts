import { describe, expect, it } from "vitest";
import { initialViewState, type ViewAction, viewReducer, type ViewState } from "./view";

const run = (s: ViewState, ...actions: ViewAction[]) => actions.reduce(viewReducer, s);
const fresh = () => initialViewState();
const draft = { name: "", stops: [] };

describe("one continuous world (no view mode)", () => {
  it("has no view, zoom-out or enter/back state", () => {
    const s = fresh();
    expect(Object.keys(s).sort()).toEqual(["dialog", "editor", "editorSessions", "selection", "shipment"]);
  });

  it("a tap on island land at near LOD selects the building under it or deselects", () => {
    let s = run(fresh(), { type: "tapIsland", id: "start", building: 7 });
    expect(s.selection).toEqual({ kind: "building", id: 7 });
    s = run(s, { type: "tapIsland", id: "island2", building: null });
    expect(s.selection).toEqual({ kind: "none" });
  });

  it("a tap on island land at mid/far LOD (or its label) selects the island; again keeps it", () => {
    let s = run(fresh(), { type: "tapIsland", id: "island2" });
    expect(s.selection).toEqual({ kind: "island", id: "island2" });
    s = run(s, { type: "tapIsland", id: "island2" });
    expect(s.selection).toEqual({ kind: "island", id: "island2" });
    expect(run(s, { type: "tapIsland", id: "start" }).selection).toEqual({ kind: "island", id: "start" });
  });

  it("the editor and Send to… work at every LOD: island taps with or without a building append stops or pick the destination", () => {
    let s = run(fresh(), { type: "openEditor", routeId: null, draft });
    s = run(s, { type: "tapIsland", id: "a", building: 4 }, { type: "tapIsland", id: "b", building: null }, { type: "tapIsland", id: "c" });
    expect(s.editor.kind === "open" && s.editor.draft.stops.map((x) => x.island)).toEqual(["a", "b", "c"]);
    expect(s.selection).toEqual({ kind: "none" });
    const send = run(fresh(), { type: "selectShip", id: 1 }, { type: "sendTo", shipId: 1, from: "start" }, { type: "tapIsland", id: "island2", building: 3 });
    expect(send).toMatchObject({ shipment: { kind: "none" }, dialog: { shipId: 1, to: "island2" }, selection: { kind: "ship", id: 1 } });
    // The ship's own island cancels.
    expect(run(fresh(), { type: "sendTo", shipId: 1, from: "start" }, { type: "tapIsland", id: "start" })).toMatchObject({ shipment: { kind: "none" }, dialog: null });
  });

  it("opening the editor keeps the selection state otherwise unchanged (no view switch)", () => {
    const s = run(fresh(), { type: "selectBuilding", id: 4 }, { type: "openEditor", routeId: null, draft });
    expect(s.editor).toMatchObject({ kind: "open", active: true });
    expect(s.selection).toEqual({ kind: "building", id: 4 });
  });
});

describe("selection", () => {
  it("ships before islands, sea clears", () => {
    let s = run(fresh(), { type: "tapShip", id: 3 });
    expect(s.selection).toEqual({ kind: "ship", id: 3 });
    s = run(s, { type: "tapIsland", id: "start" });
    expect(s.selection).toEqual({ kind: "island", id: "start" });
    s = run(s, { type: "tapSea" });
    expect(s.selection).toEqual({ kind: "none" });
    expect(run(fresh(), { type: "selectBuilding", id: 7 }, { type: "selectBuilding", id: null }).selection).toEqual({ kind: "none" });
  });
});

describe("route editor", () => {
  it("opens anywhere, appends tapped islands (also repeated ones), removes and reorders stops", () => {
    let s = run(fresh(), { type: "openEditor", routeId: null, draft, pickingShip: 1 });
    expect(s.editor).toMatchObject({ kind: "open", routeId: null, pickingShip: 1 });
    s = run(s, { type: "tapIsland", id: "a" }, { type: "tapIsland", id: "b" }, { type: "tapIsland", id: "b" }, { type: "appendStop", island: "c" });
    const stops = () => (s.editor.kind === "open" ? s.editor.draft.stops.map((x) => x.island) : []);
    expect(stops()).toEqual(["a", "b", "b", "c"]);
    // Taps append stops instead of selecting.
    expect(s.selection).toEqual({ kind: "none" });
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
    let s = run(fresh(), { type: "openEditor", routeId: null, draft }, { type: "appendStop", island: "a" });
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
    let s = run(fresh(), { type: "openEditor", routeId: 1, draft: routeA, pickingShip: 7 });
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
    const newRoute = run(fresh(), { type: "openEditor", routeId: null, draft }, { type: "closeEditor" }, { type: "openEditor", routeId: null, draft });
    expect(run(newRoute, { type: "saved", session: 1, routeId: 9 }).editor).toMatchObject({ routeId: null });
    // The session's own response applies.
    expect(run(s, { type: "saved", session: sessionB, routeId: 2 }).editor).toMatchObject({ routeId: 2 });
  });

  it("selecting a ship (scene or list) or an island suspends the editor; clearing the selection resumes it", () => {
    const editing = run(fresh(), { type: "openEditor", routeId: 3, draft }, { type: "appendStop", island: "a" });
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
      // "Back to route editor" resumes it and closes the ship panel.
      expect(run(s, { type: "resumeEditor" })).toMatchObject({ selection: { kind: "none" }, editor: { active: true } });
    }
    // "Assign to route…" opens the editor active with the ship still selected.
    const assign = run(fresh(), { type: "selectShip", id: 5 }, { type: "openEditor", routeId: null, draft, pickingShip: 5 });
    expect(assign.editor).toMatchObject({ kind: "open", active: true, pickingShip: 5 });
  });
});

describe("manual shipment", () => {
  it("drag and drop on another island opens the dialog with the destination; the sea or the same island cancels", () => {
    const drag = run(fresh(), { type: "dragShip", shipId: 1, from: "start" });
    expect(drag.shipment).toEqual({ kind: "dragging", shipId: 1, from: "start" });
    expect(run(drag, { type: "dropShip", island: "island2" })).toMatchObject({ shipment: { kind: "none" }, dialog: { shipId: 1, to: "island2" } });
    expect(run(drag, { type: "dropShip", island: null })).toMatchObject({ shipment: { kind: "none" }, dialog: null });
    expect(run(drag, { type: "dropShip", island: "start" })).toMatchObject({ shipment: { kind: "none" }, dialog: null });
  });

  it("click–click: Send to… then a tap on the target island", () => {
    let s = run(fresh(), { type: "selectShip", id: 1 }, { type: "sendTo", shipId: 1, from: "start" });
    expect(s.shipment.kind).toBe("awaitingTarget");
    s = run(s, { type: "tapIsland", id: "island2" });
    expect(s).toMatchObject({ shipment: { kind: "none" }, dialog: { shipId: 1, to: "island2" }, selection: { kind: "ship", id: 1 } });
    expect(run(s, { type: "closeShipment" }).dialog).toBeNull();
    const cancelled = run(fresh(), { type: "sendTo", shipId: 1, from: "start" }, { type: "tapSea" });
    expect(cancelled).toMatchObject({ shipment: { kind: "none" }, dialog: null });
    expect(run(fresh(), { type: "openShipment", shipId: 2, to: null }).dialog).toEqual({ shipId: 2, to: null });
  });
});

describe("Esc", () => {
  it("closes the shipment interaction, then the editor's pick, then the editor, then the selection — one step per press", () => {
    let s = run(
      fresh(),
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

// View state of the client (UI only, D-027: it chooses what to look at and
// edits drafts; no game rule). Pure and framework-free: a reducer over the
// view (one island or the archipelago), the selection, the route editor and
// the manual-shipment interaction.

export type View = { kind: "island"; id: string } | { kind: "archipelago" };

export type Selection =
  | { kind: "none" }
  | { kind: "building"; id: number }
  | { kind: "ship"; id: number }
  | { kind: "island"; id: string };

/** Editable stop of a route draft (amounts in whole units). */
export interface DraftStop {
  island: string;
  load: { good: string; max: number }[];
  unload: string[];
}

export interface Draft {
  name: string;
  stops: DraftStop[];
}

export type Editor =
  | { kind: "closed" }
  | {
      kind: "open";
      /**
       * Identity of this editor session (a new one per openEditor): save
       * responses and follow-up assignments apply only to the session that
       * issued them.
       */
      session: number;
      /**
       * The editor owns the panel and island clicks append stops. Selecting
       * a ship or an island suspends it (their panel shows, clicks select);
       * clearing that selection or resumeEditor makes it active again.
       */
      active: boolean;
      /** The saved route being edited, null for a new (unsaved) route. */
      routeId: number | null;
      draft: Draft;
      /** A ship to assign once the route is saved ("Assign to route…" from the ship panel). */
      pickingShip: number | null;
      /** The last save error (server message), shown inline. */
      error: string | null;
    };

export type Shipment =
  | { kind: "none" }
  /** An idle ship is being dragged from island `from`. */
  | { kind: "dragging"; shipId: number; from: string }
  /** "Send to…": the next tap on an island is the destination. */
  | { kind: "awaitingTarget"; shipId: number; from: string };

export interface ViewState {
  view: View;
  selection: Selection;
  editor: Editor;
  shipment: Shipment;
  /** The shipment dialog (destination preset, still changeable), or null. */
  dialog: { shipId: number; to: string | null } | null;
  /** Zoom-out accumulated at the island view's maximum extent (wheel delta units). */
  zoomOut: { amount: number; atMs: number };
  /** Last editor session number handed out. */
  editorSessions: number;
}

/**
 * Wheel delta (CSS pixels of deltaY) that must accumulate while the island
 * view is already at its maximum extent before it switches to the
 * archipelago. One wheel tick is about 100 (line mode) to 300 (some mice);
 * the threshold needs at least two ticks of 300, or six of 100.
 */
export const ZOOM_OUT_THRESHOLD = 600;
/** The accumulated zoom-out is forgotten after this pause between gestures. */
export const ZOOM_OUT_RESET_MS = 800;

export type ViewAction =
  /** A zoom-out gesture while the island view is at its maximum extent. */
  | { type: "zoomOutAtMax"; amount: number; atMs: number }
  /** Any other zoom (zoom in, or not at the maximum): resets the accumulator. */
  | { type: "zoomReset" }
  | { type: "enterIsland"; id: string }
  | { type: "toArchipelago" }
  | { type: "tapIsland"; id: string }
  | { type: "tapShip"; id: number }
  | { type: "tapSea" }
  | { type: "selectBuilding"; id: number | null }
  | { type: "selectShip"; id: number }
  | { type: "selectIsland"; id: string }
  | { type: "clearSelection" }
  | { type: "openEditor"; routeId: number | null; draft: Draft; pickingShip?: number | null }
  | { type: "setDraft"; draft: Draft }
  | { type: "appendStop"; island: string }
  | { type: "removeStop"; index: number }
  | { type: "moveStop"; index: number; delta: -1 | 1 }
  /** Save results and the pending ship's assignment, for the editor session that saved. */
  | { type: "saveFailed"; session: number; error: string }
  | { type: "saved"; session: number; routeId: number }
  | { type: "clearPickingShip"; session: number }
  | { type: "resumeEditor" }
  | { type: "closeEditor" }
  | { type: "dragShip"; shipId: number; from: string }
  /** The dragged ship was dropped on an island (null: the sea). */
  | { type: "dropShip"; island: string | null }
  | { type: "sendTo"; shipId: number; from: string }
  | { type: "openShipment"; shipId: number; to: string | null }
  | { type: "closeShipment" }
  | { type: "escape" }
  | { type: "keyEnter" }
  | { type: "keyBack" };

export function initialViewState(view: View = { kind: "island", id: "" }): ViewState {
  return {
    view,
    selection: { kind: "none" },
    editor: { kind: "closed" },
    shipment: { kind: "none" },
    dialog: null,
    zoomOut: { amount: 0, atMs: 0 },
    editorSessions: 0,
  };
}

const NO_ZOOM = { amount: 0, atMs: 0 };

/** Switches the view: the building selection is cleared (the caller clears tools). */
function switchView(s: ViewState, view: View): ViewState {
  const selection = s.selection.kind === "building" || s.selection.kind === "island" ? ({ kind: "none" } as const) : s.selection;
  return {
    ...s,
    view,
    selection,
    // The editor and a "Send to…" target pick live in the archipelago view only.
    editor: view.kind === "island" ? { kind: "closed" } : s.editor,
    shipment: view.kind === "island" ? { kind: "none" } : s.shipment,
    zoomOut: NO_ZOOM,
  };
}

function enter(s: ViewState, id: string): ViewState {
  if (s.view.kind === "island" && s.view.id === id) return { ...s, zoomOut: NO_ZOOM };
  return switchView(s, { kind: "island", id });
}

function toArchipelago(s: ViewState): ViewState {
  if (s.view.kind === "archipelago") return s;
  return switchView(s, { kind: "archipelago" });
}

/** A selection made while the editor is open suspends it; clearing the selection resumes it. */
function select(s: ViewState, selection: Selection): ViewState {
  const editor = s.editor.kind === "open" ? { ...s.editor, active: selection.kind === "none" } : s.editor;
  return { ...s, selection, editor };
}

/** The editor session that issued a save, if it is still the open one. */
function sessionEditor(s: ViewState, session: number) {
  return s.editor.kind === "open" && s.editor.session === session ? s.editor : null;
}

function withStops(s: ViewState, f: (stops: DraftStop[]) => DraftStop[]): ViewState {
  if (s.editor.kind !== "open") return s;
  return { ...s, editor: { ...s.editor, draft: { ...s.editor.draft, stops: f(s.editor.draft.stops) } } };
}

/** A new stop at an island with nothing loaded or unloaded. */
export function blankStop(island: string): DraftStop {
  return { island, load: [], unload: [] };
}

export function viewReducer(s: ViewState, a: ViewAction): ViewState {
  switch (a.type) {
    case "zoomOutAtMax": {
      if (s.view.kind !== "island") return s;
      const prev = a.atMs - s.zoomOut.atMs > ZOOM_OUT_RESET_MS ? 0 : s.zoomOut.amount;
      const amount = prev + Math.max(0, a.amount);
      if (amount >= ZOOM_OUT_THRESHOLD) return toArchipelago(s);
      return { ...s, zoomOut: { amount, atMs: a.atMs } };
    }
    case "zoomReset":
      return s.zoomOut.amount === 0 ? s : { ...s, zoomOut: NO_ZOOM };
    case "enterIsland":
      return enter(s, a.id);
    case "toArchipelago":
      return toArchipelago(s);
    case "tapIsland": {
      if (s.view.kind !== "archipelago") return s;
      const sh = s.shipment;
      if (sh.kind === "awaitingTarget") {
        const dialog = a.id === sh.from ? null : { shipId: sh.shipId, to: a.id };
        return { ...s, shipment: { kind: "none" }, dialog };
      }
      if (s.editor.kind === "open" && s.editor.active) {
        return withStops(s, (stops) => [...stops, blankStop(a.id)]);
      }
      if (s.selection.kind === "island" && s.selection.id === a.id) return enter(s, a.id);
      return select(s, { kind: "island", id: a.id });
    }
    case "tapShip":
      if (s.shipment.kind !== "none") return { ...s, shipment: { kind: "none" } };
      return select(s, { kind: "ship", id: a.id });
    case "tapSea":
      if (s.shipment.kind !== "none") return { ...s, shipment: { kind: "none" } };
      if (s.editor.kind === "open" && s.editor.active) return s;
      return s.selection.kind === "none" ? s : select(s, { kind: "none" });
    case "selectBuilding":
      return select(s, a.id === null ? { kind: "none" } : { kind: "building", id: a.id });
    case "selectShip":
      return select(s, { kind: "ship", id: a.id });
    case "selectIsland":
      return select(s, { kind: "island", id: a.id });
    case "clearSelection":
      return select(s, { kind: "none" });
    case "openEditor": {
      const t = toArchipelago(s);
      const session = s.editorSessions + 1;
      return {
        ...t,
        shipment: { kind: "none" },
        editorSessions: session,
        editor: { kind: "open", session, active: true, routeId: a.routeId, draft: a.draft, pickingShip: a.pickingShip ?? null, error: null },
      };
    }
    case "resumeEditor":
      return s.editor.kind === "open" ? { ...s, editor: { ...s.editor, active: true } } : s;
    case "setDraft":
      return s.editor.kind === "open" ? { ...s, editor: { ...s.editor, draft: a.draft } } : s;
    case "appendStop":
      return withStops(s, (stops) => [...stops, blankStop(a.island)]);
    case "removeStop":
      return withStops(s, (stops) => stops.filter((_, i) => i !== a.index));
    case "moveStop":
      return withStops(s, (stops) => {
        const j = a.index + a.delta;
        if (a.index < 0 || a.index >= stops.length || j < 0 || j >= stops.length) return stops;
        const out = [...stops];
        [out[a.index], out[j]] = [out[j] as DraftStop, out[a.index] as DraftStop];
        return out;
      });
    case "saveFailed": {
      const ed = sessionEditor(s, a.session);
      return ed ? { ...s, editor: { ...ed, error: a.error } } : s;
    }
    case "saved": {
      const ed = sessionEditor(s, a.session);
      return ed ? { ...s, editor: { ...ed, routeId: a.routeId, error: null } } : s;
    }
    case "clearPickingShip": {
      const ed = sessionEditor(s, a.session);
      return ed ? { ...s, editor: { ...ed, pickingShip: null } } : s;
    }
    case "closeEditor":
      return s.editor.kind === "closed" ? s : { ...s, editor: { kind: "closed" } };
    case "dragShip":
      return s.view.kind === "archipelago" ? { ...s, shipment: { kind: "dragging", shipId: a.shipId, from: a.from } } : s;
    case "dropShip": {
      const sh = s.shipment;
      if (sh.kind !== "dragging") return s;
      const dialog = a.island === null || a.island === sh.from ? null : { shipId: sh.shipId, to: a.island };
      return { ...s, shipment: { kind: "none" }, dialog };
    }
    case "sendTo":
      return s.view.kind === "archipelago" ? { ...s, shipment: { kind: "awaitingTarget", shipId: a.shipId, from: a.from } } : s;
    case "openShipment":
      return { ...s, shipment: { kind: "none" }, dialog: { shipId: a.shipId, to: a.to } };
    case "closeShipment":
      return s.dialog === null ? s : { ...s, dialog: null };
    case "escape":
      // One step per press: the shipment interaction, then the editor's
      // pick mode (a pending ship pick first, then the editor itself),
      // then the selection. A suspended editor comes back when the
      // selection that suspended it is cleared.
      if (s.shipment.kind !== "none") return { ...s, shipment: { kind: "none" } };
      if (s.editor.kind === "open" && s.editor.active) {
        if (s.editor.pickingShip !== null) return { ...s, editor: { ...s.editor, pickingShip: null } };
        return { ...s, editor: { kind: "closed" } };
      }
      return s.selection.kind === "none" ? s : select(s, { kind: "none" });
    case "keyEnter":
      if (s.view.kind === "archipelago" && s.selection.kind === "island") return enter(s, s.selection.id);
      return s;
    case "keyBack":
      return toArchipelago(s);
  }
}

/** The island shown in the island view, or null in the archipelago view. */
export function viewIsland(s: ViewState): string | null {
  return s.view.kind === "island" ? s.view.id : null;
}

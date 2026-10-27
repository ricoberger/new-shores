import { useState } from "react";
import type { Content, DisplayState, ShipDisplay } from "../api/client";
import { perMin, units } from "../display/format";
import { ShipStatusLine } from "./ShipsPanel";
import { goodIcon, toolIcon } from "../theme/iconSet";
import { CloseButton } from "./CloseButton";
import { RouteSummary } from "./RouteSummary";
import styles from "./hud.module.css";
import { Icon } from "./Icon";
import { NameEditor } from "./NameEditor";

interface Props {
  ship: ShipDisplay;
  model: DisplayState;
  content: Content;
  nowMs: number;
  /** Assigns the ship to an existing route (routes are created in the Routes list). */
  onAssign: (routeId: number) => void;
  /** Opens the Routes list (to create a route). */
  onOpenRoutes: () => void;
  onUnassign: () => void;
  onSend: () => void;
  onFound: () => void;
  /** The island this ship sails to found (a founding chained by the client, D-051); null when none. */
  pendingFounding?: string | null;
  onScrap: () => void;
  onClose: () => void;
  /** Renames the ship (`rename_ship`, D-055); resolves whether the server accepted the name. */
  onRename: (name: string) => Promise<boolean>;
  /** Start with the name editor open (tests). */
  initiallyRenaming?: boolean;
}

/**
 * Ship info panel (UI.md §4): name (renamed in the header, D-055), type, state, cargo slots, current leg with a
 * live countdown, route and upkeep. Actions are offered only in the states
 * the server accepts them; the server validates.
 */
export function ShipPanel({
  ship: s,
  model,
  content,
  nowMs,
  onAssign,
  onOpenRoutes,
  onUnassign,
  onSend,
  onFound,
  pendingFounding = null,
  onScrap,
  onClose,
  onRename,
  initiallyRenaming = false,
}: Props) {
  const islandName = (id: string) => model.islands.find((i) => i.id === id)?.name || id;
  const goodName = (id: string) => content.goods.find((g) => g.id === id)?.name ?? id;
  const shipType = content.ships.find((t) => t.id === s.type);
  const type = shipType?.name ?? s.type;
  const idle = s.state === "idle";
  const [choosing, setChoosing] = useState(false);
  // The name editor in the header (the island card's pattern); the name is saved at once.
  const [draft, setDraft] = useState<{ ship: number; name: string } | null>(initiallyRenaming ? { ship: s.id, name: s.name } : null);
  const [busy, setBusy] = useState(false);
  const editing = draft && draft.ship === s.id ? draft : null;
  const rename = () => {
    if (!editing || busy) return;
    setBusy(true);
    void onRename(editing.name).then((ok) => {
      setBusy(false);
      if (ok) setDraft(null);
    });
  };
  const here = model.islands.find((i) => i.id === s.island_id);
  const route = model.routes.find((r) => r.id === s.route_id);
  // No actions (a ship under way): no empty divider block.
  const hasActions = idle || s.route_id !== 0 || s.state === "anchored_unpaid";
  return (
    <div className={`${styles.panel} ${styles.infoPanel}`} data-testid="ship-panel">
      <div className={editing ? `${styles.row} ${styles.nowrap}` : styles.row}>
        {editing ? (
          <NameEditor
            value={editing.name}
            onChange={(name) => setDraft({ ship: s.id, name })}
            onSubmit={rename}
            onCancel={() => setDraft(null)}
            label="Ship name"
            testId="ship-rename"
            busy={busy}
          />
        ) : (
          <>
            <h2 className={styles.title} data-testid="ship-panel-name">
              {s.name}
            </h2>
            <button
              type="button"
              className={styles.closeButton}
              onClick={() => setDraft({ ship: s.id, name: s.name })}
              aria-label="Rename the ship"
              title="Rename the ship"
              data-testid="ship-rename"
            >
              <Icon path={toolIcon("rename")} />
            </button>
          </>
        )}
        {/* While renaming, the cancel icon takes the close button's place (the same icon: one per row). */}
        {!editing && <div className={styles.spacer} />}
        {!editing && <CloseButton onClick={onClose} testId="ship-panel-close" />}
      </div>
      <div className={styles.small} data-testid="ship-panel-type">
        {type}
      </div>
      <div className={styles.panelBody}>
        <ShipStatusLine ship={s} nowMs={nowMs} islandName={islandName} className={styles.small} stateTestId="ship-panel-state" etaTestId="ship-panel-eta" routeName={route?.name} />
        {s.leg && (
          <div className={styles.small} data-testid="ship-panel-journey">
            {islandName(s.leg.from_island_id)} → {islandName(s.leg.to_island_id)}
          </div>
        )}
        {/* On a route the status line names it; any other state with a route (berth wait, unpaid) says so here. */}
        {route && s.state !== "on_route" && (
          <div className={styles.small} data-testid="ship-panel-route">
            Route: {route.name}
          </div>
        )}
        <div className={styles.small}>Upkeep {perMin(s.upkeep_per_min)} $/min</div>
        {shipType && (
          <div className={styles.small} data-testid="ship-panel-speed">
            Speed {(shipType.speed_permille / 1000).toFixed(1)}×
          </div>
        )}
        <div className={styles.small} data-testid="ship-panel-capacity">
          Capacity {s.slots} slots of {units(s.slot_size)} each
        </div>
        {s.state === "waiting_for_berth" && (
          <div className={styles.small} data-testid="ship-panel-berth">
            Waiting for a free berth at the Trading Post since {new Date(s.queued_at ?? 0).toLocaleTimeString()} — its cargo is handled when one frees.
          </div>
        )}
        {pendingFounding && (
          <div className={styles.small} data-testid="ship-panel-pending-founding">
            Sails to found {pendingFounding}.
          </div>
        )}
        <div className={`${styles.shipEntry} ${styles.slots}`} data-testid="ship-panel-cargo" aria-label={`Cargo, ${s.slots} slots`}>
          {Array.from({ length: s.slots }, (_, i) => {
            const c = s.cargo[i];
            return c ? (
              <div key={i} className={styles.slot} title={goodName(c.good)} data-testid={`ship-panel-slot-${i}`}>
                <Icon path={goodIcon(c.good)} />
                <span className={styles.small}>
                  {units(c.amount)} / {units(s.slot_size)}
                </span>
                <span className={styles.srOnly}>{goodName(c.good)}</span>
              </div>
            ) : (
              <div key={i} className={`${styles.slot} ${styles.slotEmpty}`} data-testid={`ship-panel-slot-${i}`}>
                <span className={styles.srOnly}>Empty slot</span>
              </div>
            );
          })}
        </div>
        {choosing && idle && (
          <div className={styles.shipEntry} data-testid="ship-panel-route-picker">
            <div className={styles.sectionTitle}>Assign to route</div>
            {model.routes.length === 0 && (
              <div className={styles.small} data-testid="ship-panel-no-routes">
                No routes yet. Create one in the{" "}
                <button type="button" className={styles.link} onClick={onOpenRoutes}>
                  Routes list
                </button>
                .
              </div>
            )}
            {model.routes.map((r) => (
              <button
                key={r.id}
                type="button"
                className={`${styles.trayEntry} ${styles.routeChoice}`}
                onClick={() => {
                  setChoosing(false);
                  onAssign(r.id);
                }}
                data-testid={`ship-panel-assign-${r.id}`}
              >
                <span>
                  <RouteSummary route={r} islandName={islandName} />
                </span>
              </button>
            ))}
            <button type="button" className={styles.link} onClick={() => setChoosing(false)} data-testid="ship-panel-assign-cancel">
              Cancel
            </button>
          </div>
        )}
        {hasActions && !(choosing && idle) && (
        <div className={`${styles.row} ${styles.shipEntry}`}>
          {idle && (
            <button type="button" className={styles.button} onClick={() => setChoosing(true)} data-testid="ship-panel-assign">
              Assign to route…
            </button>
          )}
          {s.route_id !== 0 && (
            <button type="button" className={styles.button} onClick={onUnassign} data-testid="ship-panel-unassign">
              Unassign
            </button>
          )}
          {idle && here && (
            <button type="button" className={styles.button} onClick={onSend} data-testid="ship-panel-send">
              Send…
            </button>
          )}
          {idle && here && !here.settled && (
            <button type="button" className={styles.button} onClick={onFound} data-testid="ship-panel-found">
              Found settlement
            </button>
          )}
          {(idle || s.state === "anchored_unpaid") && (
            <button type="button" className={`${styles.button} ${styles.danger}`} onClick={onScrap} data-testid="ship-panel-scrap">
              Scrap
            </button>
          )}
        </div>
        )}
      </div>
    </div>
  );
}

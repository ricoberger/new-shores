import { type FormEvent, useState } from "react";
import type { Content, DisplayState, Island } from "../api/client";
import { units } from "../display/format";
import { islandKind, islandResources } from "../display/hud";
import { CloseButton } from "./CloseButton";
import styles from "./hud.module.css";
import { toolIcon } from "../theme/iconSet";
import { Icon } from "./Icon";
import { ResourceBadges } from "./ResourceBadges";

interface Props {
  islandId: string;
  model: DisplayState;
  content: Content;
  /** Static island data (fertilities, deposits); undefined while loading. */
  statics: Island | undefined;
  onClose: () => void;
  /** Renames the island (`rename_island`); resolves whether the server accepted the name. */
  onRename: (name: string) => Promise<boolean>;
}

/**
 * Island card (UI.md §1/§6): an overview of what the island is: its
 * population per tier and its resources (fertilities, deposits, coast),
 * from display numbers and static data, with its size class (D-053). The
 * only action: a settled island's owner renames it (the pencil; the server
 * validates the name).
 */
export function IslandCard({ islandId, model, content, statics, onClose, onRename }: Props) {
  const [draft, setDraft] = useState<{ island: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const is = model.islands.find((i) => i.id === islandId);
  if (!is) return null;
  const defs = new Map(content.buildings.map((b) => [b.id, b]));
  const resources = statics && statics.id === is.id ? islandResources(statics, is, defs) : null;
  const kind = islandKind(is, content);
  const editing = draft && draft.island === is.id ? draft : null;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!editing || busy) return;
    setBusy(true);
    void onRename(editing.name).then((ok) => {
      setBusy(false);
      if (ok) setDraft(null);
    });
  };
  return (
    <div className={`${styles.panel} ${styles.infoPanel}`} data-testid="island-card">
      <div className={editing ? `${styles.row} ${styles.nowrap}` : styles.row}>
        {editing ? (
          <form className={styles.renameForm} onSubmit={submit} data-testid="island-rename-form">
            <input
              className={`${styles.input} ${styles.renameInput}`}
              value={editing.name}
              onChange={(e) => setDraft({ island: is.id, name: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.stopPropagation();
                  setDraft(null);
                }
              }}
              aria-label="Island name"
              autoFocus
              disabled={busy}
              data-testid="island-rename-input"
            />
            <button type="submit" className={styles.button} disabled={busy} data-testid="island-rename-save">
              Rename
            </button>
            <button type="button" className={styles.link} onClick={() => setDraft(null)} data-testid="island-rename-cancel">
              cancel
            </button>
          </form>
        ) : (
          <>
            <h2 className={styles.title} data-testid="island-card-name">
              {is.name || is.id}
            </h2>
            {is.settled && (
              <button
                type="button"
                className={styles.closeButton}
                onClick={() => setDraft({ island: is.id, name: is.name })}
                aria-label="Rename the island"
                title="Rename the island"
                data-testid="island-rename"
              >
                <Icon path={toolIcon("rename")} />
              </button>
            )}
          </>
        )}
        {!editing && <div className={styles.spacer} />}
        <CloseButton onClick={onClose} testId="island-card-close" />
      </div>
      {kind && (
        <div className={styles.small} data-testid="island-card-kind">
          {is.rock ? kind : `${kind} island`}
        </div>
      )}
      <div className={styles.panelBody}>
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Population</div>
          <table className={styles.table}>
            <tbody>
              {content.tiers.map((t) => (
                <tr key={t.id}>
                  <td>
                    <span className={styles.withIcon}>
                      <Icon path={toolIcon("population")} />
                      {t.name}
                    </span>
                  </td>
                  <td data-testid={`island-card-population-${t.id}`}>{units(is.population[t.id] ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className={`${styles.section} ${styles.divided}`}>
          <div className={styles.sectionTitle}>Resources</div>
          <div className={styles.small} data-testid="island-card-resources-row">
            {resources ? <ResourceBadges resources={resources} prefix="island-card" stacked /> : "…"}
          </div>
        </div>
      </div>
    </div>
  );
}

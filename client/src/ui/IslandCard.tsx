import { useState } from "react";
import type { Content, DisplayState, Island } from "../api/client";
import { units } from "../display/format";
import { islandKind, islandResources } from "../display/hud";
import { CloseButton } from "./CloseButton";
import { t } from "../i18n";
import styles from "./hud.module.css";
import { toolIcon } from "../theme/iconSet";
import { Icon } from "./Icon";
import { NameEditor } from "./NameEditor";
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
  /** Start with the rename editor open (tests). */
  initiallyRenaming?: boolean;
}

/**
 * Island card (UI.md §1/§6): an overview of what the island is: its
 * population per tier and its resources (fertilities, deposits, coast),
 * from display numbers and static data, with its size class (D-053). The
 * only action: a settled island's owner renames it (the pencil; the server
 * validates the name; the editor's Rename and Cancel are icons).
 */
export function IslandCard({ islandId, model, content, statics, onClose, onRename, initiallyRenaming = false }: Props) {
  const [draft, setDraft] = useState<{ island: string; name: string } | null>(() => {
    const is = initiallyRenaming ? model.islands.find((i) => i.id === islandId) : undefined;
    return is ? { island: is.id, name: is.name } : null;
  });
  const [busy, setBusy] = useState(false);
  const is = model.islands.find((i) => i.id === islandId);
  if (!is) return null;
  const defs = new Map(content.buildings.map((b) => [b.id, b]));
  const resources = statics && statics.id === is.id ? islandResources(statics, is, defs) : null;
  const kind = islandKind(is, content);
  const editing = draft && draft.island === is.id ? draft : null;
  const submit = () => {
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
          <NameEditor
            value={editing.name}
            onChange={(name) => setDraft({ island: is.id, name })}
            onSubmit={submit}
            onCancel={() => setDraft(null)}
            label={t("islandCard.nameLabel")}
            testId="island-rename"
            busy={busy}
          />
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
                aria-label={t("islandCard.rename")}
                title={t("islandCard.rename")}
                data-testid="island-rename"
              >
                <Icon path={toolIcon("rename")} />
              </button>
            )}
          </>
        )}
        {/* While renaming, the cancel icon takes the close button's place (the same icon: one per row). */}
        {!editing && <div className={styles.spacer} />}
        {!editing && <CloseButton onClick={onClose} testId="island-card-close" />}
      </div>
      {kind && (
        <div className={styles.small} data-testid="island-card-kind">
          {is.rock ? kind : t("islandCard.kindIsland", { kind })}
        </div>
      )}
      <div className={styles.panelBody}>
        <div className={styles.section}>
          <div className={styles.sectionTitle}>{t("islandCard.population")}</div>
          <table className={styles.table}>
            <tbody>
              {content.tiers.map((tier) => (
                <tr key={tier.id}>
                  <td>
                    <span className={styles.withIcon}>
                      <Icon path={toolIcon("population")} />
                      {tier.name}
                    </span>
                  </td>
                  <td data-testid={`island-card-population-${tier.id}`}>{units(is.population[tier.id] ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className={`${styles.section} ${styles.divided}`}>
          <div className={styles.sectionTitle}>{t("islandCard.resources")}</div>
          <div className={styles.small} data-testid="island-card-resources-row">
            {resources ? <ResourceBadges resources={resources} prefix="island-card" stacked /> : <span data-testid="island-card-loading">{t("common.loading")}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

import { toolIcon, type ToolIcon } from "../theme/iconSet";
import styles from "./hud.module.css";
import { Icon } from "./Icon";

export type DockPanel = "warnings" | "quests" | "ships" | "routes";

interface Props {
  /** The open panel, or "none". */
  active: DockPanel | "none";
  /** Opens the panel, or closes it when it is open. */
  onToggle: (panel: DockPanel) => void;
  counts: Record<DockPanel, number>;
  /** Whether the build menu at the bottom is shown, and its toggle (independent of the panels). */
  buildOpen: boolean;
  onToggleBuild: () => void;
}

const ITEMS: { id: DockPanel; label: string; icon: ToolIcon }[] = [
  { id: "warnings", label: "Warnings", icon: "warnings" },
  { id: "quests", label: "Quests", icon: "quests" },
  { id: "ships", label: "Ships", icon: "ships" },
  { id: "routes", label: "Routes", icon: "routes" },
];

/**
 * Icon buttons down the left edge (no backing panel): the build menu
 * toggle, then warnings, quests, ships and routes, each with a count badge when it is above zero (quests:
 * rewards to claim). A click opens that panel, a second one closes it; the
 * build toggle is independent of them.
 */
export function SideDock({ active, onToggle, counts, buildOpen, onToggleBuild }: Props) {
  return (
    <nav className={styles.dock} aria-label="Lists" data-testid="side-dock">
      <button
        type="button"
        className={`${styles.dockButton} ${buildOpen ? styles.dockActive : ""}`}
        aria-pressed={buildOpen}
        aria-label="Build menu"
        title="Build menu"
        onClick={onToggleBuild}
        data-testid="dock-build"
      >
        <Icon path={toolIcon("build")} />
      </button>
      {ITEMS.map(({ id, label, icon }) => (
        <button
          key={id}
          type="button"
          className={`${styles.dockButton} ${active === id ? styles.dockActive : ""}`}
          aria-pressed={active === id}
          aria-label={counts[id] > 0 ? `${label}, ${counts[id]}` : label}
          title={label}
          onClick={() => onToggle(id)}
          data-testid={`dock-${id}`}
        >
          <Icon path={toolIcon(icon)} />
          {counts[id] > 0 && (
            <span className={styles.dockCount} data-testid={`dock-${id}-count`}>
              {counts[id]}
            </span>
          )}
        </button>
      ))}
    </nav>
  );
}

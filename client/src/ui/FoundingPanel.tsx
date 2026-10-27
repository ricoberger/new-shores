import { useState } from "react";
import styles from "./hud.module.css";

interface Props {
  /** The focused (unsettled) island's name. */
  name: string;
  /** No island is settled yet: the "Choose your home island" hint leads. */
  seafaring: boolean;
  /** What founding here takes ("Found settlement here" lets you …). */
  detail: string;
  /** A founding waiting for its ship, with a cancel link (replaces the Found button). */
  pending: string | null;
  onCancelPending: () => void;
  /** Absent when no ship can found here (no button). */
  onFound?: () => void;
  /** Absent when the archipelago cannot be rerolled (no button). */
  onReroll?: () => void;
  /**
   * Phone layouts: a one-line sheet, collapsed by default, with an expand
   * chevron for the full text. Desktop: the full text, centred at the
   * bottom while choosing the home island (the start dialog), else docked
   * bottom-left beside the side dock. The buttons show in all.
   */
  sheet: boolean;
  /** Start expanded (tests). */
  initiallyExpanded?: boolean;
}

/** The panel of a focused unsettled island: the founding hint, Found and Another archipelago. */
export function FoundingPanel({ name, seafaring, detail, pending, onCancelPending, onFound, onReroll, sheet, initiallyExpanded = false }: Props) {
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const full = !sheet || expanded;
  const placement = sheet ? "sheet" : seafaring ? "centred" : "docked";
  return (
    <div
      className={`${styles.panel} ${styles.unsettledPanel} ${placement === "sheet" ? styles.foundingSheet : placement === "docked" ? styles.foundingDocked : ""}`}
      data-placement={placement}
      data-testid={seafaring ? "seafaring-panel" : "unsettled-panel"}
      data-expanded={sheet ? String(expanded) : undefined}
    >
      {sheet && (
        <div className={styles.foundingLine}>
          <span className={styles.foundingLineText} data-testid="founding-line">
            {seafaring ? (
              <>
                <strong>Choose your home island:</strong> {name}
              </>
            ) : (
              <>
                <strong>{name}</strong> is not settled.
              </>
            )}
          </span>
          <button
            type="button"
            className={styles.foundingChevron}
            onClick={() => setExpanded((e) => !e)}
            aria-expanded={expanded}
            aria-label={expanded ? "Show less" : "Show more"}
            data-testid="founding-expand"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <path d="M3 10l5-5 5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      )}
      {full && seafaring && (
        <div data-testid="seafaring-hint">
          <strong>Choose your home island.</strong> Your sloop carries the planks and sails. Use the minimap to see the whole
          archipelago and tap it to look around; look at the islands&apos; fertilities and deposits (tap one for its card) and found a
          Trading Post where you want to start.
        </div>
      )}
      {full && (
        <div>
          <strong>{name}</strong> is not settled. {detail}
        </div>
      )}
      {pending && (
        <div className={styles.small} data-testid="pending-founding">
          {pending}{" "}
          <button type="button" className={styles.link} onClick={onCancelPending} data-testid="pending-founding-cancel">
            cancel
          </button>
        </div>
      )}
      {((onFound && !pending) || onReroll) && (
        <div className={`${styles.buttons} ${placement === "docked" ? "" : styles.centred}`}>
          {onFound && !pending && (
            <button type="button" className={styles.button} onClick={onFound} data-testid="found-settlement-here">
              Found settlement here
            </button>
          )}
          {onReroll && (
            <button type="button" className={styles.button} onClick={onReroll} data-testid="reroll-archipelago">
              Another archipelago
            </button>
          )}
        </div>
      )}
    </div>
  );
}

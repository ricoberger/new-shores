import type { FormEvent } from "react";
import { toolIcon } from "../theme/iconSet";
import styles from "./hud.module.css";
import { Icon } from "./Icon";

interface Props {
  value: string;
  onChange: (name: string) => void;
  /** Rename (the ✓ icon, Enter). */
  onSubmit: () => void;
  /** Cancel (the ⊗ icon, Escape). */
  onCancel: () => void;
  /** Accessible name of the input ("Island name"). */
  label: string;
  /** Test ID prefix: `<prefix>-form`, `<prefix>-input`, `<prefix>-save`, `<prefix>-cancel`. */
  testId: string;
  busy?: boolean;
  maxLength?: number;
  placeholder?: string;
}

/**
 * The name editor in a panel's header (island card, route editor, ship
 * panel): the input with Rename and Cancel icon buttons. The panel hides
 * its close button meanwhile (Cancel has the same icon).
 */
export function NameEditor({ value, onChange, onSubmit, onCancel, label, testId, busy = false, maxLength, placeholder }: Props) {
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!busy) onSubmit();
  };
  return (
    <form className={styles.renameForm} onSubmit={submit} data-testid={`${testId}-form`}>
      <input
        className={`${styles.input} ${styles.renameInput}`}
        maxLength={maxLength}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onCancel();
          }
        }}
        aria-label={label}
        autoFocus
        disabled={busy}
        data-testid={`${testId}-input`}
      />
      <button type="submit" className={styles.closeButton} disabled={busy} aria-label="Rename" title="Rename" data-testid={`${testId}-save`}>
        <Icon path={toolIcon("confirm")} />
      </button>
      <button type="button" className={styles.closeButton} onClick={onCancel} aria-label="Cancel renaming" title="Cancel renaming" data-testid={`${testId}-cancel`}>
        <Icon path={toolIcon("cancel")} />
      </button>
    </form>
  );
}

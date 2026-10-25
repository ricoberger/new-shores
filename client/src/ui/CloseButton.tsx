import { toolIcon } from "../theme/iconSet";
import { Icon } from "./Icon";
import styles from "./hud.module.css";

interface Props {
  onClick: () => void;
  testId: string;
  /** Accessible name (the button shows only the icon). */
  label?: string;
}

/** The icon-only close button in the header of a side panel (and the phone sheet). */
export function CloseButton({ onClick, testId, label = "Close" }: Props) {
  return (
    <button type="button" className={styles.closeButton} onClick={onClick} aria-label={label} title={label} data-testid={testId}>
      <Icon path={toolIcon("close")} />
    </button>
  );
}

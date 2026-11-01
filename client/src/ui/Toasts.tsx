import { t } from "../i18n";
import { toolIcon } from "../theme/iconSet";
import styles from "./hud.module.css";
import { Icon } from "./Icon";

export interface Toast {
  id: number;
  text: string;
  /** "unlock": a tier unlock (D-056) — a brass slip with a title that stays longer (UNLOCK_TOAST_MS); else a notice or an error. */
  kind?: "unlock";
}

/** How long a toast stays (ms); a tier unlock longer, it is a milestone, not a notice. */
export const TOAST_MS = 5000;
export const UNLOCK_TOAST_MS = 10000;

export function toastDuration(kind: Toast["kind"]): number {
  return kind === "unlock" ? UNLOCK_TOAST_MS : TOAST_MS;
}

export function Toasts({ toasts, onDismiss, phone = false }: { toasts: Toast[]; onDismiss: (id: number) => void; phone?: boolean }) {
  return (
    <div className={`${styles.toasts} ${phone ? styles.toastsPhone : ""}`}>
      {toasts.map((tl) =>
        tl.kind === "unlock" ? (
          <div key={tl.id} className={`${styles.toast} ${styles.toastUnlock}`} role="status" data-testid="toast" data-kind="unlock" onClick={() => onDismiss(tl.id)}>
            <Icon path={toolIcon("population")} />
            <span className={styles.toastBody}>
              <strong className={styles.toastTitle}>{t("toast.unlockTitle")}</strong>
              <span>{tl.text}</span>
            </span>
          </div>
        ) : (
          <div key={tl.id} className={styles.toast} role="alert" data-testid="toast" onClick={() => onDismiss(tl.id)}>
            {tl.text}
          </div>
        ),
      )}
    </div>
  );
}

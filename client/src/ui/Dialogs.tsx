import { t } from "../i18n";
import { DialogPanel } from "./DialogPanel";
import styles from "./hud.module.css";

export interface ConfirmRequest {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
}

export function ConfirmDialog({ request, onClose }: { request: ConfirmRequest; onClose: () => void }) {
  return (
    <div className={styles.backdrop} onClick={onClose}>
      <DialogPanel className={`${styles.panel} ${styles.dialog}`} labelledBy="confirm-dialog-title" testId="dialog" onClick={(e) => e.stopPropagation()}>
        <h2 className={styles.title} id="confirm-dialog-title">
          {request.title}
        </h2>
        <p>{request.body}</p>
        <div className={styles.buttons}>
          <button
            type="button"
            className={`${styles.button} ${styles.danger}`}
            data-testid="dialog-confirm"
            onClick={() => {
              onClose();
              request.onConfirm();
            }}
          >
            {request.confirmLabel}
          </button>
          <button type="button" className={styles.button} onClick={onClose} data-testid="dialog-cancel">
            {t("common.cancel")}
          </button>
        </div>
      </DialogPanel>
    </div>
  );
}

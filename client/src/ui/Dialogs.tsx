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
      <div
        className={`${styles.panel} ${styles.dialog}`}
        role="dialog"
        aria-modal="true"
        data-testid="dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className={styles.title}>{request.title}</h2>
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
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

import styles from "./hud.module.css";

export interface Toast {
  id: number;
  text: string;
}

export function Toasts({ toasts, onDismiss, phone = false }: { toasts: Toast[]; onDismiss: (id: number) => void; phone?: boolean }) {
  return (
    <div className={`${styles.toasts} ${phone ? styles.toastsPhone : ""}`}>
      {toasts.map((t) => (
        <div key={t.id} className={styles.toast} role="alert" data-testid="toast" onClick={() => onDismiss(t.id)}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

import styles from "./hud.module.css";

export interface Toast {
  id: number;
  text: string;
}

export function Toasts({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div className={styles.toasts}>
      {toasts.map((t) => (
        <div key={t.id} className={styles.toast} role="alert" data-testid="toast" onClick={() => onDismiss(t.id)}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

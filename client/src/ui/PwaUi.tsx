import { useSyncExternalStore } from "react";
import { installPrompt, updates } from "../pwa";
import styles from "./hud.module.css";

const never = () => () => {};

/** "Update available" toast with Reload while a new service worker waits. */
export function UpdateToast() {
  const flow = updates();
  const available = useSyncExternalStore(flow?.subscribe ?? never, () => flow?.available() ?? false);
  if (!flow || !available) return null;
  return (
    <div className={`${styles.toast} ${styles.updateToast}`} role="status" data-testid="update-toast">
      <span>A new version of New Shores is available.</span>
      <button type="button" className={styles.button} onClick={() => flow.apply()} data-testid="update-reload">
        Reload
      </button>
    </div>
  );
}

/** Whether the browser offered installation (beforeinstallprompt) and the player has not declined. */
export function useInstallAvailable(): boolean {
  return useSyncExternalStore(installPrompt.subscribe, () => installPrompt.available());
}

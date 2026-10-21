// PWA wiring: the install prompt and the service-worker update flow as
// module singletons. The service worker is registered in production
// builds only (the Vite dev server has none).
import { InstallPrompt, type InstallPromptEvent } from "./install";
import { UpdateFlow } from "./update";

/** Update check while the page stays open. */
const UPDATE_CHECK_MS = 30 * 60_000;

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export const installPrompt = new InstallPrompt(storage());

let updateFlow: UpdateFlow | null = null;

/** The update flow (null without service-worker support). */
export function updates(): UpdateFlow | null {
  return updateFlow;
}

export function initPwa(): void {
  window.addEventListener("beforeinstallprompt", (e) => installPrompt.capture(e as unknown as InstallPromptEvent));
  window.addEventListener("appinstalled", () => installPrompt.installed());
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  const container = navigator.serviceWorker;
  updateFlow = new UpdateFlow(container, () => window.location.reload());
  const flow = updateFlow;
  window.addEventListener("load", () => {
    container.register("/sw.js").then(
      (reg) => {
        flow.watch(reg);
        const check = () => void reg.update().catch(() => undefined);
        setInterval(check, UPDATE_CHECK_MS);
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") check();
        });
      },
      (err: unknown) => console.warn("service worker registration failed", err),
    );
  });
}

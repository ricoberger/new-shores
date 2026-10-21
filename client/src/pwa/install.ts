// Install prompt (framework-free, tested with fakes): the browser's
// beforeinstallprompt event is kept so that an "Install app" action can
// show it later; the action is available only while an event is held and
// the player has not dismissed the prompt before (remembered in
// localStorage). Browsers without the event (iOS Safari) show nothing.

export const INSTALL_DISMISSED_KEY = "new-shores.install-dismissed";

/** The non-standard BeforeInstallPromptEvent (Chromium). */
export interface InstallPromptEvent {
  preventDefault(): void;
  prompt(): Promise<unknown>;
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export type StorageLike = Pick<Storage, "getItem" | "setItem">;

export class InstallPrompt {
  private event: InstallPromptEvent | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly storage: StorageLike | null) {}

  /** beforeinstallprompt: suppress the browser's mini-infobar and keep the event. */
  capture(e: InstallPromptEvent): void {
    e.preventDefault();
    this.event = e;
    this.emit();
  }

  /** appinstalled: nothing left to offer. */
  installed(): void {
    this.event = null;
    this.emit();
  }

  available(): boolean {
    if (!this.event) return false;
    try {
      return this.storage?.getItem(INSTALL_DISMISSED_KEY) !== "1";
    } catch {
      return true;
    }
  }

  /** Shows the browser's prompt (once per event); a dismissal is remembered. */
  async prompt(): Promise<"accepted" | "dismissed" | "unavailable"> {
    const e = this.event;
    if (!e || !this.available()) return "unavailable";
    this.event = null;
    this.emit();
    await e.prompt();
    const { outcome } = await e.userChoice;
    if (outcome === "dismissed") this.dismiss();
    return outcome;
  }

  /** The player does not want the app installed: never offer it again. */
  dismiss(): void {
    try {
      this.storage?.setItem(INSTALL_DISMISSED_KEY, "1");
    } catch {
      // storage unavailable (private mode): only this session forgets it
      this.event = null;
    }
    this.emit();
  }

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  private emit(): void {
    for (const l of this.listeners) l();
  }
}

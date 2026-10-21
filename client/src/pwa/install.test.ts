import { describe, expect, it } from "vitest";
import { INSTALL_DISMISSED_KEY, InstallPrompt, type InstallPromptEvent, type StorageLike } from "./install";

function memoryStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

function promptEvent(outcome: "accepted" | "dismissed") {
  const e = {
    prevented: false,
    prompted: 0,
    preventDefault() {
      e.prevented = true;
    },
    prompt() {
      e.prompted++;
      return Promise.resolve();
    },
    userChoice: Promise.resolve({ outcome }),
  };
  return e satisfies InstallPromptEvent;
}

describe("InstallPrompt", () => {
  it("is available only after beforeinstallprompt", () => {
    const p = new InstallPrompt(memoryStorage());
    expect(p.available()).toBe(false);
    const e = promptEvent("accepted");
    let notified = 0;
    p.subscribe(() => notified++);
    p.capture(e);
    expect(e.prevented).toBe(true);
    expect(p.available()).toBe(true);
    expect(notified).toBe(1);
  });

  it("prompts once; accepting leaves nothing to offer", async () => {
    const s = memoryStorage();
    const p = new InstallPrompt(s);
    const e = promptEvent("accepted");
    p.capture(e);
    expect(await p.prompt()).toBe("accepted");
    expect(e.prompted).toBe(1);
    expect(p.available()).toBe(false);
    expect(await p.prompt()).toBe("unavailable");
    expect(s.data.has(INSTALL_DISMISSED_KEY)).toBe(false);
  });

  it("remembers a dismissal in storage and never offers again", async () => {
    const s = memoryStorage();
    const p = new InstallPrompt(s);
    p.capture(promptEvent("dismissed"));
    expect(await p.prompt()).toBe("dismissed");
    expect(s.data.get(INSTALL_DISMISSED_KEY)).toBe("1");
    // A later event (next visit) is not offered.
    const again = new InstallPrompt(s);
    again.capture(promptEvent("accepted"));
    expect(again.available()).toBe(false);
  });

  it("appinstalled clears the offer; no storage still works", () => {
    const p = new InstallPrompt(null);
    p.capture(promptEvent("accepted"));
    expect(p.available()).toBe(true);
    p.installed();
    expect(p.available()).toBe(false);
  });
});

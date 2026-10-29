// Almanac routes: /almanac/<section>[/<id>]. A pathname check and the
// History API are enough (no router library); the alternative would be a
// small router with route objects, worth it only when the app gets more
// routes than the game and the almanac.
import { useSyncExternalStore } from "react";
import type { SectionId } from "./model";

export const ALMANAC_BASE = "/almanac";

export const SECTIONS: { id: SectionId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "buildings", label: "Buildings" },
  { id: "goods", label: "Goods" },
  { id: "needs", label: "Needs" },
  { id: "ships", label: "Ships" },
  { id: "quests", label: "Quests" },
  { id: "islands", label: "Islands" },
];

export interface Route {
  section: SectionId;
  id?: string;
}

/** Whether a pathname belongs to the almanac. */
export function isAlmanacPath(pathname: string): boolean {
  return pathname === ALMANAC_BASE || pathname.startsWith(`${ALMANAC_BASE}/`);
}

/** The route of a pathname; an unknown section is the overview. */
export function parseRoute(pathname: string): Route {
  const parts = pathname.split("/").filter(Boolean).slice(1);
  const section = SECTIONS.find((s) => s.id === parts[0])?.id ?? "overview";
  let id: string | undefined;
  try {
    id = parts[1] ? decodeURIComponent(parts[1]) : undefined;
  } catch {
    id = undefined;
  }
  return SECTIONS.some((s) => s.id === parts[0]) && id ? { section, id } : { section };
}

/** Pathname of a section page or of one entry of it. */
export function routePath(section: SectionId, id?: string): string {
  if (section === "overview" && !id) return ALMANAC_BASE;
  return `${ALMANAC_BASE}/${section}${id ? `/${encodeURIComponent(id)}` : ""}`;
}

const EVENT = "almanac:navigate";

/** Goes to a pathname (history entry, no reload). */
export function navigate(path: string): void {
  if (globalThis.location?.pathname === path) return;
  globalThis.history.pushState(null, "", path);
  globalThis.dispatchEvent(new Event(EVENT));
}

function subscribe(cb: () => void): () => void {
  globalThis.addEventListener("popstate", cb);
  globalThis.addEventListener(EVENT, cb);
  return () => {
    globalThis.removeEventListener("popstate", cb);
    globalThis.removeEventListener(EVENT, cb);
  };
}

const pathname = () => globalThis.location?.pathname ?? ALMANAC_BASE;

/** The current almanac route; follows back/forward and `navigate`. */
export function useRoute(): Route & { path: string } {
  const path = useSyncExternalStore(subscribe, pathname, () => ALMANAC_BASE);
  return { ...parseRoute(path), path };
}

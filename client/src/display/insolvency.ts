// The insolvency banner (MECHANICS §7): one sentence from the server's
// insolvency block; no rule is evaluated here.
import type { DisplayState } from "../api/client";
import { perMin } from "./format";

/** The banner sentence, or null when nothing is paused for insolvency. */
export function insolvencyBanner(model: DisplayState | null): string | null {
  const ins = model?.insolvency;
  if (!ins || ins.unpaid_buildings + ins.unpaid_ships === 0) return null;
  const ships = ins.unpaid_ships > 0 ? `, ${ins.unpaid_ships} ships` : "";
  return (
    `Your city cannot afford its upkeep: ${perMin(ins.balance_if_resumed_per_min, true)} gold/min. ` +
    `Paused: ${ins.unpaid_buildings} buildings${ships}. Demolish, resume manually, or grow your tax base.`
  );
}

// The insolvency banner (MECHANICS §7): one sentence from the server's
// insolvency block; no rule is evaluated here.
import type { DisplayState } from "../api/client";
import { t } from "../i18n";
import { perMin } from "./format";

/** The banner sentence, or null when nothing is paused for insolvency. */
export function insolvencyBanner(model: DisplayState | null): string | null {
  const ins = model?.insolvency;
  if (!ins || ins.unpaid_buildings + ins.unpaid_ships === 0) return null;
  const ships = ins.unpaid_ships > 0 ? t("insolvency.ships", { count: ins.unpaid_ships }) : "";
  return t("insolvency.banner", { rate: perMin(ins.balance_if_resumed_per_min, true), buildings: ins.unpaid_buildings, ships });
}

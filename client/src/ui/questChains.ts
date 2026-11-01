import type { Content, DisplayState } from "../api/client";
import { t } from "../i18n";

/** One open quest of a chain: claimable (completed, rewards waiting) or active. */
export interface ChainQuest {
  id: string;
  claimable: boolean;
  /** 1-based position in its chain (content order). */
  step: number;
}

/** A quest chain with its open quests, for the quest list. */
export interface QuestChain {
  id: string;
  name: string;
  total: number;
  /** Quests of the chain before its first open one (claimed). */
  done: number;
  open: ChainQuest[];
  /** The chain's next quest after its last open one (not started yet), if any. */
  next: string | null;
}

/** The chain of a quest: its ID prefix (intro_…, citizens_…), as in the almanac. */
export function questChainOf(id: string): string {
  const i = id.indexOf("_");
  return i > 0 ? id.slice(0, i) : id;
}

/** The chain's name: the tier of the same ID, "Intro" for the tutorial, else the ID. */
export function questChainName(content: Content, chain: string): string {
  if (chain === "intro") return t("quests.chainIntro");
  return content.tiers.find((x) => x.id === chain)?.name ?? chain;
}

/**
 * The open quests grouped by chain, chains and quests in content order.
 * Quests the content does not know form their own chain at the end. Pure
 * display: the server says which quests are claimable and active.
 */
export function questChains(model: DisplayState, content: Content): QuestChain[] {
  const quests = content.quests ?? [];
  const claimable = new Set(model.quests.claimable);
  const open = new Set([...claimable, ...model.quests.active.map((q) => q.id)]);
  const ids = [...quests.map((q) => q.id), ...[...open].filter((id) => !quests.some((q) => q.id === id))];
  const chains = new Map<string, string[]>();
  for (const id of ids) {
    const c = questChainOf(id);
    chains.set(c, [...(chains.get(c) ?? []), id]);
  }
  const out: QuestChain[] = [];
  for (const [chain, members] of chains) {
    const steps = members.flatMap((id, i) => (open.has(id) ? [{ id, claimable: claimable.has(id), step: i + 1 }] : []));
    const first = steps[0];
    const last = steps[steps.length - 1];
    if (!first || !last) continue;
    out.push({
      id: chain,
      name: questChainName(content, chain),
      total: members.length,
      done: first.step - 1,
      open: steps,
      next: members[last.step] ?? null,
    });
  }
  return out;
}

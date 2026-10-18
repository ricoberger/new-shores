# New Shores — Monetisation

Status: **Agreed** (D-021). One deliberately deferred item (§6).

## 1. Principles

1. **Nothing that affects the game can be bought.** No time, no resources, no
   gold, no slots, no power. The game is identical for payers and non-payers.
2. **Two currencies that never touch.**
   - **Gold** — in-game. Earned only from taxes. Spent on construction and
     upkeep. Never purchasable, never transferable between players.
   - **Doubloons** — premium. Bought with real money. Spent only in the
     cosmetic shop. Never earned in-game, never transferable, never
     convertible to gold.
3. **No gambling.** No loot boxes, random bundles or gacha. Every purchase is
   a known item at a known price.
4. **Honest pacing.** Because nothing is sold to relieve friction, there is no
   incentive to add friction (see D-006).

This is a **low-revenue model** by design, appropriate for an indie/passion
project. Expected conversion is a few percent of active players.

## 2. Catalogue

| Category | Examples | Effect |
|---|---|---|
| Decorations | hedges, flower beds, lanterns, wells, statues, fountains, ponds, trees, bell tower, pillory, graveyard, maypole | none (count toward cosmetic "prestige" leaderboard only) |
| Ship skins | sail colours/patterns, hull paint, figureheads | none |
| Building variants | alternative facades/roofs per tier for houses, warehouse, church | none |
| Seasonal | winter/harvest/festival decorations, time-limited availability but permanent ownership | none |

Decorations are placed like buildings (footprint, no road requirement, no
upkeep). They can be moved and stored without loss; they are never destroyed.
Owned items are account-wide across regions and devices.

## 3. Pricing (provisional, EUR, incl. VAT)

| Pack | Doubloons | Price |
|---|---|---|
| Handful | 100 | 1.99 |
| Purse | 300 | 4.99 |
| Chest | 700 | 9.99 |

Items: small decoration 20–40, large decoration 80–150, ship skin 100–200,
building variant set 150–300. No bonus Doubloons for larger packs beyond the
listed amounts (keeps the "known price" principle simple). No free Doubloons at
start (decided); a small number of **free decorations** may be granted as quest
or achievement rewards instead.

## 4. Payments

- **Web:** Stripe Checkout (cards, PayPal, Apple Pay, Google Pay), Stripe Tax
  for VAT, webhooks → entitlement ledger. Purchase history and receipts in the
  account page.
- **Native apps (later, D-028):** mandatory store IAP (App Store / Google Play)
  for digital goods. Server-side receipt validation → same ledger. Prices are
  aligned to store tiers; the store cut (15–30 %) is accepted.
- **Entitlement ledger** (server): append-only `ledger(player_id, delta,
  currency=doubloons, reason, provider, provider_ref, at)`; balance is the sum.
  Provider adapters are the only code that knows about Stripe or stores.
  Idempotent on `provider_ref`. Refunds create negative entries; if the
  balance goes negative, the shop is locked until settled (items are not
  removed from placed decorations).

## 5. Legal and practical

- Prices shown in local currency with tax included where required (EU).
- 14-day withdrawal right handled per EU rules for digital content (explicit
  consent to immediate delivery at checkout).
- Terms, privacy policy, imprint; purchase requires an account with verified
  email.
- Age: no purchases for accounts flagged as under 16 (self-declared DOB);
  no chat means no additional minor-safety features are needed at launch.

## 6. Deferred — revisit after launch

- **Doubloons → Gold conversion.** Rejected for launch because it sells
  progress, undermines fairness with trading and future raids, makes gold
  real-money-backed (RMT/alt risk), and would create pressure to slow the game.
  To be reconsidered with launch data on retention and revenue. The ledger and
  gold are already separate accounts; adding a conversion would be a policy
  and UI change, not a schema change.
- **Convenience items that do not change outcomes** (layout templates,
  extra statistics panels, archipelago themes) — acceptable middle ground if
  revenue is insufficient.
- Supporter badge/subscription with cosmetic monthly items.

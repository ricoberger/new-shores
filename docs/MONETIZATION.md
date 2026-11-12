# New Shores — Monetisation

Status: **Agreed** (D-021, amended by D-077 §1: a supporter subscription
instead of Doubloons and a cosmetic shop). Nothing is implemented or gated
yet.

## 1. Principles

1. **Nothing that affects the game can be bought.** No time, no resources, no
   gold, no slots, no power. The game is identical for supporters and
   everyone else (D-021).
2. **One in-game currency, never bought.** **Gold** is earned only from
   taxes, spent on construction, upkeep and the ornaments (D-077 §2), never
   purchasable, never transferable between players. There is no premium
   currency: the Doubloons of the original D-021 plan are dropped (D-077
   §1), so nothing can ever convert into gold.
3. **No gambling.** No loot boxes, random bundles or gacha. The one thing
   sold is a known subscription at a known price.
4. **Honest pacing.** Because nothing is sold to relieve friction, there is no
   incentive to add friction (see D-006).

This is a **low-revenue model** by design, appropriate for an indie/passion
project. Expected conversion is a few percent of active players.

## 2. The supporter subscription (D-077 §1)

- **Monthly**, renewing until cancelled. No per-item shop, no balance, no
  ledger of a currency.
- The server stores one **entitlement** per player: the subscription is
  active **until** a timestamp, extended by each paid period (and shortened
  by a refund). "Is a supporter" means "active until is in the future";
  nothing else is stored about the payment in the game's state.
- **Supporter badge:** the visible sign of an active subscription (account
  page, and later wherever players see each other, ONLINE.md).
- **Nothing is gated yet.** Every building, ornament, ship and feature is
  usable without the subscription. What a player built while subscribed
  always stays when the subscription lapses — nothing is ever removed or
  disabled.
- The ornaments (hedges, flower beds, wells, statues, fountains, ponds,
  trees, maypole, pillory, cemetery, the square, gold statue — the old
  Doubloon catalogue's decorations) are **gold buildings** in the
  Ornaments category for everyone (D-077 §2, CONTENT.md); their price in
  gold is the sink.

## 3. What the subscription may unlock later

Possible later gates, each needing **its own decision** checked against
D-021's principle (no gameplay advantage): content **access**, never
**advantage**.

| Candidate | Why it could be acceptable | Caveat |
|---|---|---|
| Region 2 (a further archipelago, D-076) | new content to visit, not a stronger economy in region 1 | a region's goods must not make region-1 play easier for supporters; trading between regions would conflict |
| Online features (ONLINE.md) | social reach, not production | nothing that changes prices, raids or trades in a supporter's favour |
| Cosmetic extras (ship skins, building variants, seasonal decorations) | no effect, like the ornaments | they become content of the subscription, never single purchases with a currency |
| Convenience that does not change outcomes (layout templates, extra statistics panels, archipelago themes) | saves clicks, not time in the simulation | must not shorten a timer, raise a cap or show information that wins trades |

Until such a decision exists, nothing is gated and the subscription is a
way to support the game.

## 4. Payments

- **Web:** Stripe Checkout (cards, PayPal, Apple Pay, Google Pay) in
  subscription mode, Stripe Tax for VAT; the customer portal handles
  cancelling, invoices and receipts. Webhooks (paid period, renewal,
  cancellation, refund) → the entitlement's "active until".
- **Native apps (later, D-028):** mandatory store subscriptions (App Store /
  Google Play). Server-side receipt and notification validation → the same
  entitlement. Prices are aligned to store tiers; the store cut (15–30 %) is
  accepted.
- **Entitlement** (server): `entitlements(player_id, active_until,
  provider, provider_ref, updated_at)`, plus an append-only audit log of the
  provider events applied (`provider_ref` idempotent). Provider adapters
  are the only code that knows about Stripe or stores. A refund or
  chargeback only moves "active until"; it never removes anything placed.
- Price: one monthly price, provisional, set before launch (EUR, incl.
  VAT).

## 5. Legal and practical

- Prices shown in local currency with tax included where required (EU).
- 14-day withdrawal right handled per EU rules for digital services
  (explicit consent to immediate start at checkout); cancellation as easy as
  subscribing.
- Terms, privacy policy, imprint; subscribing requires an account with a
  verified email.
- Age: no subscription for accounts flagged as under 16 (self-declared DOB);
  no chat means no additional minor-safety features are needed at launch.

## 6. Rejected or deferred

- **Doubloons and a cosmetic shop** — replaced by the subscription (D-077
  §1). A premium currency with per-item prices is not planned.
- **Selling gold or anything convertible to gold** — rejected (D-021): it
  sells progress, undermines fairness with trading and future raids, makes
  gold real-money-backed (RMT/alt risk) and would create pressure to slow
  the game. Without a premium currency there is nothing to convert.
- **Gates for the subscription** — see §3; each needs its own decision.

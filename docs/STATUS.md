# New Shores — Status (read this first)

One page for anyone (human or agent) starting work. Updated with every
docs sync; details live in the linked documents. Last update: after C3 (#35, tier 3 Merchants) — tiers 1–3 playable,
every tier 2–4 model on main.

## What exists

| Area | State | Where |
|---|---|---|
| Simulation (pure Go, lazy, deterministic) | tiers 1–3 complete: production, logistics via collectors (Trading Post + Warehouses), needs/categories, workforce, taxes, insolvency with trial resume, fields by adjacency chains, ships/routes, start at sea + founding, berth queues, quests, away summary, seeded archipelago generator with reroll and rename, batch field placement, terrain table, ship names, weighted need shares with cumulative tiers and a services category, building levels (`upgrade_building`), recipe input alternatives, upgrade gate ≥ 0.6, founding cargo exempt from slots, berths spaced by ship length, tier-3 deposits; schema 10 | `server/internal/sim`, MECHANICS.md |
| Content | `old_coast` 0.12.0: D-054 footprints/costs/fields, D-056 need model (shares 1.0 lone / 0.6, cumulative lower-tier rates, `services`), tiers 1–3 complete with two alternatives per category from tier 2 (Citizens bread/cheese, cider/mead, linen/leather_jerkins; Merchants sausages/pies, beer/brandy, coats/dyed_garments, books/soap), salt / bricks / coal, `school`, `church`, `theatre`, `market` levels 1–3, Patricians declared without goods or house, islands 192/112/64/16 with iron/clay/salt/coal deposits, `smoke`/`boat` flags, sloop (2 slots, tier 2) / brig (tier 3) / galleon, 12 intro + 5 tier-2 + 6 tier-3 quests | `content/old_coast`, CONTENT.md |
| Server | Go + PostgreSQL + Redis; accounts (guest/email), sessions, CSRF, scheduled-events worker, WebSocket push, dev mode with in-memory store and `POST /api/v1/dev/reset` | `server/internal/*`, ARCHITECTURE.md |
| Client | Vite/React/Babylon; one continuous world with LOD (full models near/mid, lite far), free camera + compass, HUD with island resources and workforce, start-at-sea flow, harbour panels, touch layouts, PWA; `make shots` / `make model-sheet` for looking at the result (no e2e/visual/perf suites, D-052) | `client/`, UI.md |
| Art | KayKit SOURCE kits only; recipe-driven Blender build (`npm run assets`), AO/two-tone vertex colours, diorama islands; 123 recipes — every tier 1–4 building, module, field and ship modelled (tiers 3–4 ahead of content via `assets/build/planned/`); thumbnails; life layer (carts, walkers, smoke, sails, boats, gulls, strollers, sheep, cattle/pig anchors, construction stages) with device budgets; models folder 20.2 of 24 MiB | `assets/`, ART_DIRECTION.md |
| CI | label-gated (`ci`): server (fmt/vet/lint/test), client (lint/typecheck/Vitest/build/assets-check), integration (Postgres + Redis) | `.github/workflows/ci.yaml` |

## Binding rules in one breath

Server owns the truth; `internal/sim` is pure (no clock, no I/O); no tick
loop — lazy advance + scheduled events applied at `due_at`; content is
data; no game rules in the client (it extrapolates from rates); every
commit type-checks, lints, builds and passes its tests; docs change only
in the sync after a task unless the task says otherwise; nobody adds the
`ci` label but the owner.

## Decisions most relevant right now

- **D-050** chunky stylised flat-shaded look, KayKit lead, real models at
  every zoom, device-validated perf.
- **D-052** flows and perf validated by playtest on the device; no
  e2e/visual/perf suites; `make shots` PNGs in every look-changing PR.
- **D-051**: complete — start at sea, Trading Post (capacity, berths) vs
  Warehouse (collector), water-edge footprints, fields v2 (edge-adjacent
  chains from the farm panel, bound to a farm instance), berths with
  per-unit handling, free camera, per-house satisfaction.

## Next tasks (in order)

1. **Content depth (D-056 decided; CONTENT §2/§5/§7/§8/§12 are the
   spec):**
   - ~~S1 need model + tier-2 completion~~ merged (#34); ~~M2 / M3 /
     M4 models~~ merged (#31–#33).
   - ~~C3 tier 3~~ merged (#35): targets 225 / 235 / 283; the smoke and
     boat flags, berth spacing by `length_tiles` and the `market` rename
     landed with it.
   - **Playtest round on tiers 2–3** (owner, `citizens` / `merchants`
     fixtures): second chains, market levels, school/church/theatre,
     unlock toast, quest chains, house cards with carried needs, brig
     at the piers.
   - **C4 tier 4** content session: Patricians per CONTENT §5/§7, the
     reference game written with the chains spread over ≥ 2 production
     islands (home island for houses) — `islands.json` changes only if
     that still does not fit (D-054/D-056 as built).
   - **Art-style prototype (voxels)** running in parallel on its own
     branch (do-not-merge PR) as evidence for a D-057 interview: look
     side by side, phone fps, authoring effort per model.
   - Before deployment: quantised GLB export (KHR_mesh_quantization) to
     roughly halve the models folder (≈ 63 bytes/triangle today; limit
     24 MiB).

## Known follow-ups

- **Decision candidates** (owner + design lead): unload amounts per
  route stop (touches D-015); a meaning for fields above `required`
  (D-051 part 4); ship and fisher-boat routing around islands.
- **Server tasks:** an in-transit *rate* per good in the display (the
  client treats the in-transit amount as fixed between updates, so it
  drifts while ships load — C3); a per-ship-type quest condition (the
  brig quest asks for three ships); the unlock toast for a tier unlocked
  while away (add it to the letter); `upgrade_available` (or the blocking reason) on the
  house display so the Upgrade button shows only when it would succeed
  (D-027 forbids computing it in the client); `preview_variant` hint for
  the house ghost; content validation that a building need's
  `needs.json: radius` equals the building's `service.radius`.
- **Client tasks:** `client/src/api/sync.test.ts` fails intermittently on
  real timers (rewrite with fake timers end to end); landscape phone —
  dock vs. half-open sheet and expanded minimap overlap; details-in-place
  for the dock lists; life budget per *visible* island; stage models for
  fields; comfort/luxury need icons (with tier 3); a `citizens` dev fixture
  (Citizens unlocked, a wheat farm) so presets can paint 140 fields.
- API, store and event tests still run on the old hand-made two-island
  world (fine: they test the store, not the map).
- Dev seed 1053001 (`--seed`); the pre-D-054 content lives in
  `server/testdata/content/old_coast_pre_d054` (hand-made scenarios,
  mechanics tests, two client tests) — see the PR #27 notes.
- Local dev databases older than schema 7 must be recreated (`make down
  VOLUMES=1 && make up`); 7→8 migrates (ship names).
- **First frame** ≈ 200 ms cold / 115 ms warm on desktop (PR #30 notes):
  the world and content requests start only after the engine is set up
  (~117 ms); fetching them in parallel saves ≈ 35–40 ms — client
  follow-up. The unused `unsettled` palette role can be removed.

## How to run

`make dev` (local), `make dev HOST=<lan-ip>` / `make preview HOST=<lan-ip>`
(phone over LAN, `?stats=1` fps badge, `?fixture=<name>` dev fixtures),
`make up` (Compose stack), `make check`, `make assets` /
`make assets-check` (needs Blender 5.2 and `NEW_SHORES_KITS_DIR`).

**Looking at the result:** `make shots` (18 PNGs: showcase / settled /
dense-2x400 × near / mid / far × desktop / phone, fixed camera and
clock, ≈ 30 s; `FIXTURE= VIEW= DEVICE= ROTATION= ISLAND= ZOOM= HUD=0`,
`PRESET=<name>|all`; the names are in `client/e2e/tools/shots-args.ts`,
e.g. `info-panel`, `house-card`, `ship-panel`, `route-editor`, `build-menu`,
`island-card`, `top-bar-popups`, `farm-selected`) and `make model-sheet
RECIPE=sawmill` (contact sheet, 3 s). Attach these to reports instead
of writing ad-hoc screenshot scripts.

**Check loop by change type** (CI runs everything on the `ci` label):
- client UI / art / render: `cd client && npm run lint && npm run
  typecheck && npm test`, then `make shots` for the affected view
  (attach the PNGs to the report). There are no e2e, visual or perf
  suites (D-052); flows and fps are the owner's playtest.
- content / sim / server: `make check`; `make server-integration` when
  API or store code changed.

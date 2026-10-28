# D-057 V1 — voxel is the only renderer (clean cut)

Branch `adhoc.20261028-171906-d-057-v1-voxel-is-the-only-renderer-clea`,
based on the prototype branch (PR #36, `.experiment/voxel/NOTES.md`),
rebased onto main (C4 #37 included). Supersedes #36.

## Steps

| # | Step | State |
|---|------|-------|
| 1 | `assets/voxel` becomes the asset build | done |
| 2 | Delete the kit assets | done |
| 3 | Client: one render path | open |
| 4 | Tests and fixtures | open |
| 5 | Device numbers | open |
| 6 | Docs | open |

## Step 1 — pipeline

- `assets/voxel/build.py` writes `client/public/models/` (GLBs, `manifest.json`,
  `thumbs/`); the build owns the folder and removes stale files.
  `client/public/models-voxel/` is gone.
- `make assets` / `make assets-check` (rebuild into a temp dir, byte
  compare, lists changed/missing/stale) / `make assets-test`
  (`assets/voxel/tests`, part of `make check`) / `make model-sheet
  RECIPE=a,b` (sheet in `.experiment/sheets/<ids>.png`; without `RECIPE` the
  ID list). `voxel`, `voxel-test`, `voxel-sheet` and `voxel-compare` are
  dropped (no aliases); `compare.py` is deleted with `voxel-compare`.
- Kept from nsassets (moved into `assets/voxel/nsvoxel/`): `glb.py`
  (writer; `geometry.normal` inlined), `palette.py`, `content.py`
  (content + planned loader, precedence, smoke/boat/pasture anchors),
  `schema.py` (validator only). `config.py` is new and trimmed to what
  the voxel build uses. `assets/build/planned/` → `assets/voxel/planned/`
  (server tests updated: `merchants_test.go`, `patricians_test.go`).
- Deleted: the Blender build (`assets/build/`: build.py, nsassets
  pipeline/recipes/kits/blender_ops/atlas/validate/geometry, all its
  tests), `client/scripts/assets.mjs` and the `npm run assets` script.
- Decor/life IDs now come from the voxel recipe files (`decor_*`,
  `life_*`), not from the old kit manifest.
- Manifest: `missing_recipes` and `kit_sources` dropped; `placeholders`
  (content IDs built by `auto.py`), `voxels_per_tile`, `generator`
  added; `ModelManifest` in `client/src/render/models.ts` follows.
- Rebase fix: the prototype's `market_small.py` recipe was orphaned by the
  content rename `market_small` → `market` (#35); renamed to `market.py`
  (5 × 6, levels 1–3 unchanged). A test now rejects orphan recipes.
- Cart wheel anchors: the voxel carts have them at 0.15 tiles (kit
  0.1474); `WHEEL_AHEAD` follows (`client/src/display/lifeplan.ts`).
- CI: a separate `assets` job (setup-python 3.14.7, pinned), runs
  `make assets-test` and `make assets-check` — no skip, no Blender.

## Step 2 — kit assets

- Deleted: `assets/recipes/` (123 kit-bash recipe JSONs + `schema.json`),
  `assets/kits/MANIFEST.json` and `assets/kits/README.md`.
- The kit GLBs and thumbnails were already replaced in step 1: the voxel
  build writes the same file names into `client/public/models/` and removes
  the rest (12 kit-only files: the merchants/patricians house variants
  v0–v2 + lite, now single placeholder models).
  `client/public/models/` holds only voxel output.
- `assets/build/planned` is not deleted: it is the voxel pipeline's own
  footprint source now (`assets/voxel/planned/`, moved in step 1; the
  server's content tests read it).
- `.gitignore` keeps an `assets/kits/*` ignore (local kit copies), the
  `!MANIFEST.json`/`!README.md` exceptions are gone.

### Budgets (D-054 area scaling, re-based for voxels)

Per footprint tile, prototype max × ~1.5 (`assets/voxel/nsvoxel/config.py`),
enforced by the build (a model over budget fails it) and by
`tests/test_committed.py`:

| Class | Prototype max full / tile | Budget full / tile | Prototype max lite / tile | Budget lite / tile |
|-------|---------------------------|--------------------|---------------------------|--------------------|
| Buildings | 328 (chapel) | 500 | 26.0 | 40 |
| Houses | 354 (house_citizens) | 540 | 28.9 | 45 |
| Fields | 270 (orchard_plot) | 410 | — (no lite) | — |

Flat budgets: ships sloop 2 800 / brig 6 000 / galleon 7 600 (prototype
1 882 / 3 948 / 5 096), cargo 300 (192), decor 580 (384, decor_tree_a),
life 760 (506, life_cart_merchant), construction stages 2 100 (1 370).
The old `BUDGET_FACTOR = 2.0` tolerance is gone: the budget is the limit.

Folder: committed GLBs 19.1 MiB (manifest-listed bytes; thumbnails 0.54 MiB more; the kit-era folder was 20.3 MiB in total); limit 24 MiB
(`MODELS_FOLDER_LIMIT`, the kit-era ceiling kept).

## Open questions

1. **numpy.** The task asked for "Python + numpy, versions pinned" in CI.
   The voxel pipeline is standard-library only (the prototype never used
   numpy; numpy is not installed on the workstation). Stricter reading
   taken: no new dependency (AGENTS.md: standard library first); CI pins
   Python 3.14.7 only and AGENTS.md says Python 3 without numpy.
   Alternative: add numpy (e.g. for a faster mesher) with a pinned
   `requirements.txt` when a change actually uses it.
2. **Folder limit.** Kept at 24 MiB (≈ 25 % headroom over 19.1 MiB). A
   tighter limit (e.g. 20 MiB) would fail as soon as ~15 placeholders get
   real recipes; a quantised export would shrink the files by ~50 % but
   changes the GLB profile (V2).
3. **`voxel-sheet` alias.** Dropped rather than kept as an alias of
   `model-sheet` (one name per target).

"""Build configuration of the voxel asset pipeline (D-057): paths, budgets and manifest constants.

Everything here is data that determines the exported models or what the
checks accept; changing a value changes the output or the checks (the
drift check, `make assets-check`, reports it).
"""

import os

VOXEL_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS_DIR = os.path.dirname(VOXEL_DIR)
REPO_ROOT = os.path.dirname(ASSETS_DIR)

RECIPES_DIR = os.path.join(VOXEL_DIR, "recipes")
PALETTE_PATH = os.path.join(ASSETS_DIR, "palette.json")
#: The content the models are fitted to (D-054 footprints).
CONTENT_DIR = os.path.join(REPO_ROOT, "content", "old_coast")
#: Environment variable that points to another content directory (default
#: CONTENT_DIR): footprints, kinds and levels are read from there, e.g. a
#: content draft the models are fitted to before it lands.
CONTENT_ENV = "NEW_SHORES_CONTENT_DIR"
#: Planned footprints (D-056 model sessions): buildings and ships whose
#: models are made before the content defines them. Every *.json in this
#: directory except schema.json is read beneath the content (content wins
#: per ID), so models build before the content lands.
PLANNED_DIR = os.path.join(VOXEL_DIR, "planned")
PLANNED_SCHEMA_PATH = os.path.join(PLANNED_DIR, "schema.json")
#: Pasture modules (field IDs, else field types) → (animal, count): the
#: life layer instances that many animals at the anchors <animal>_1 … and
#: walks them in through the gate anchor (LIFE_LAYER §7; D-054 modules).
PASTURE_ANIMALS = {"pasture": ("sheep", 3), "cattle_pasture": ("cattle", 3), "pig_pen": ("pig", 4)}
#: Content tier IDs by tier number (planned entries give the number).
TIER_NAMES = ("settlers", "citizens", "merchants", "patricians")
#: The committed output: GLBs, manifest.json and thumbs/ (the client serves it as /models/).
MODELS_DIR = os.path.join(REPO_ROOT, "client", "public", "models")
#: Build-card thumbnail edge in pixels (shown at 64 CSS px: sharp at 2× density).
THUMB_PX = 128

#: Manifest format version (client/src/render/models.ts reads it).
MANIFEST_VERSION = 1
#: The glTF asset.generator and manifest generator string (no version or timestamp: determinism).
GENERATOR = "new-shores voxel build"
#: Voxels per tile of the full building models by default (the manifest's
#: top-level `voxels_per_tile`; the lite level: LITE_DOWNSAMPLE times fewer).
VOXELS_PER_TILE = 8
#: Voxels per tile a building or field recipe may declare (`VOXELS_PER_TILE`
#: in the recipe module, V7): finer detail on the larger D-062 footprints.
#: The exporter scales to tile units and writes the value into the model's
#: manifest entry; budgets stay per footprint tile.
ALLOWED_VOXELS_PER_TILE = (8, 12, 16)
#: Voxels per tile of every lite (far) model, whatever the full model's
#: density (D-057 §2; the far-budget mitigation of the prototype, dense far
#: 442k → 152k).
LITE_VOXELS_PER_TILE = 2
#: Downsampling of a default-density (8 per tile) model's lite level: 8 → 2.
LITE_DOWNSAMPLE = VOXELS_PER_TILE // LITE_VOXELS_PER_TILE

#: Palette groups whose colour names are valid roles (material colours;
#: UI, status, route and light colours are not).
ROLE_GROUPS = ("buildings", "terrain", "fields", "water", "island")
#: Palette group with the shadow tone of every role (the baked occlusion blends toward it).
SHADOW_GROUP = "shadows"

#: Triangle budgets (D-054 area scaling, re-based for voxels in D-057 V1):
#: triangles per footprint tile of the full model and of the lite model,
#: by model class. Set from the prototype's densest model of each class
#: with ~50 % headroom (.experiment/voxel-v1/NOTES.md): buildings 328 / 26
#: per tile (chapel, rendering_house), houses 354 / 29 (house_citizens),
#: fields 270 (orchard_plot). A model's budget is the class's per-tile
#: number times its footprint area; no floor and no cap (the per-tile
#: densities were measured on 1 × 1 to 8 × 12 footprints).
BUDGET_PER_TILE = {"building": 500, "house": 540, "field": 410}
LITE_BUDGET_PER_TILE = {"building": 40, "house": 45}
#: Ships (no footprint): prototype sloop 1 882, brig 3 948, galleon 5 096
#: triangles, cargo attachments 192, each with ~50 % headroom.
BUDGET_SHIPS = {"sloop": 2800, "brig": 6000, "galleon": 7600}
BUDGET_SHIP_CARGO = 300
#: Lite (far LOD) ship models (V7): a recipe's `lite` builder at its scale /
#: SHIP_LITE_DOWNSAMPLE voxels per tile (20 → 5: at the far ship scale about
#: 2 voxels per world tile, like the buildings' lite level); hull, masts and
#: sail silhouettes, no cargo attachment. Budgets from the far-budget
#: brief (sloop / brig / galleon ≈ 300 / 600 / 800).
SHIP_LITE_DOWNSAMPLE = 4
LITE_BUDGET_SHIPS = {"sloop": 300, "brig": 600, "galleon": 800}
#: Decoration (kind "decor": trees, bushes, rocks, crags, tufts, stumps,
#: outcrops; merged by the hundreds per island chunk): prototype max 384
#: (decor_tree_a).
BUDGET_DECOR = 580
#: Life-layer elements (kind "life": thin-instanced by the dozen per
#: island): prototype max 506 (life_cart_merchant); the construction
#: stages stand in for a building for seconds only: max 1 370 (life_stage);
#: the sized stage classes (life_stage_<n>, n tiles per side) get
#: BUDGET_LIFE_STAGE × n / 4 from n = 4 up.
BUDGET_LIFE = 760
BUDGET_LIFE_STAGE = 2100
#: Ceiling of the committed GLBs (bytes; manifest-listed files). The voxel
#: output is ≈ 19.1 MiB with 66 placeholders; the limit of the kit-bashed
#: models (24 MiB) is kept until a quantised export (KHR_mesh_quantization)
#: shrinks the files (open question in the V1 notes).
MODELS_FOLDER_LIMIT = 24 * 1024 * 1024

#: Decoration and life IDs (not content IDs) start with these prefixes.
DECOR_PREFIX = "decor_"
LIFE_PREFIX = "life_"
LIFE_STAGE_PREFIX = "life_stage"

#: Default status anchor height above the model (tiles).
STATUS_ABOVE = 0.25

#: Content IDs that need a model: tier 1–4 buildings except roads (fields
#: included) and these ships (D-056 ship ladder); planned IDs always do.
MODEL_TIERS = ("settlers", "citizens", "merchants", "patricians")
MODEL_SHIPS = ("sloop", "brig", "galleon")

#: Positions and normals are rounded to this many decimals before export (stable bytes).
POSITION_DECIMALS = 5
NORMAL_DECIMALS = 5


def content_dir():
    """The content directory: NEW_SHORES_CONTENT_DIR if set, else CONTENT_DIR."""
    env = os.environ.get(CONTENT_ENV, "").strip()
    return os.path.abspath(env) if env else CONTENT_DIR

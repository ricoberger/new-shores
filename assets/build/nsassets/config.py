"""Build configuration: paths, kit scale factors, budgets and kit material defaults.

Everything here is data that determines the exported models; changing a
value changes the GLBs (and the drift check reports it).
"""

import os

BUILD_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS_DIR = os.path.dirname(BUILD_DIR)
REPO_ROOT = os.path.dirname(ASSETS_DIR)

RECIPES_DIR = os.path.join(ASSETS_DIR, "recipes")
SCHEMA_PATH = os.path.join(RECIPES_DIR, "schema.json")
PALETTE_PATH = os.path.join(ASSETS_DIR, "palette.json")
KITS_MANIFEST_PATH = os.path.join(ASSETS_DIR, "kits", "MANIFEST.json")
KITS_README = "assets/kits/README.md"
CONTENT_DIR = os.path.join(REPO_ROOT, "content", "old_coast")
MODELS_DIR = os.path.join(REPO_ROOT, "client", "public", "models")
SHEETS_DIR = os.path.join(BUILD_DIR, "out")

#: Environment variable that points to the kit root (default <repo>/assets/kits).
KITS_ENV = "NEW_SHORES_KITS_DIR"

#: Manifest format version (client/src/render/models.ts reads it).
MANIFEST_VERSION = 1
#: The glTF asset.generator string (no version or timestamp: determinism).
GENERATOR = "new-shores assets build"

#: 1 tile = 4 m (ART_DIRECTION §5).
METRES_PER_TILE = 4.0

#: Kit unit (metre) → tiles. Both Quaternius kits are authored in metres
#: (Medieval walls are 2 m wide and 3.12 m high), so 1 / 4 m.
KIT_SCALE = {
    "medieval": 0.25,
    "pirate": 0.25,
}

#: Per-file overrides of the kit factor. The Pirate Kit's Ship_Small hull is
#: 5.15 m long; at 0.35 tiles/m it is 1.80 tiles, and with the procedural
#: bowsprit the sloop measures 2.0 tiles (the near-LOD length of the former
#: placeholder, so berths, legs and the ship blob stay valid).
FILE_SCALE = {
    "pirate:glTF/Ship_Small.gltf": 0.35,
}

#: Palette groups whose colour names are valid roles (material colours;
#: UI, status, route and light colours are not).
ROLE_GROUPS = ("buildings", "terrain", "fields", "water")

#: Kit material defaults: material name → (role, shade). The Medieval kit's
#: textured materials are replaced by flat palette colours.
KIT_MATERIALS = {
    "medieval": {
        "MI_Plaster": ("plaster", 1.0),
        "MI_WoodTrim": ("timber", 1.0),
        "MI_WoodTrim_Wear": ("timber", 0.85),
        "MI_RockTrim": ("stone", 1.0),
        "MI_Brick": ("stone", 0.92),
        "MI_UnevenBrick": ("stone", 0.95),
        "MI_RoundRocks": ("stone", 0.9),
        "MI_RedBrick": ("terracotta", 0.9),
        "MI_RoundTiles": ("terracotta", 1.0),
        "MI_FlatTiles": ("terracotta", 0.9),
        "MI_MetalOrnaments": ("iron", 1.0),
        "MI_WindowGlass": ("window", 1.0),
        "MI_Vine": ("tree-crown", 1.0),
    },
}

#: Atlas kits: every face samples the atlas at its UV centroid and takes the
#: nearest swatch (sRGB distance). The face's material is renamed to
#: "Atlas/<swatch>"; a recipe's `roles` map may use those names.
KIT_ATLAS_SWATCHES = {
    "pirate": [
        # name, reference sRGB hex, role, shade
        ("wood_dark", "#3A2A20", "timber", 0.75),
        ("wood", "#6B4A30", "timber", 1.0),
        ("wood_light", "#A07850", "thatch", 1.0),
        ("sand", "#C8A878", "thatch", 1.1),
        ("metal", "#7C7C80", "iron", 1.0),
        ("black", "#1C1C1C", "iron", 0.8),
        ("red", "#8E1E1E", "terracotta", 0.85),
        ("white", "#D8D8D0", "canvas", 1.0),
        ("gold", "#D8A830", "brass", 1.0),
        ("blue", "#4A80B8", "dye-blue", 1.0),
        ("green", "#5A9A20", "tree-crown", 1.0),
    ],
}

#: Triangle budgets per exported file (ART_DIRECTION §7; ships aligned with buildings).
BUDGET_BUILDING = 1500
BUDGET_BUILDING_EXCEPTION = 3000
BUDGET_HOUSE = 400
BUDGET_FIELD = 60
BUDGET_SHIP = 1500
BUDGET_ATTACHMENT = 150
#: Budget of a lite model (parts with lod "full" left out) relative to its
#: full model's budget. The client draws the lite models at the near-LOD
#: default zoom (full ones at a half extent ≤ 10), where a dense town is
#: hundreds of houses: measured on the dense fixture (software WebGL, 412 ×
#: 915, 4× throttling) every ~10 house triangles cost ~0.4 ms per frame, so
#: houses get a fifth of their budget (80) and the few other buildings
#: half (750). Lite models are validated like full ones (footprint fit and
#: coverage, palette, export profile).
LITE_FACTOR = 0.5
LITE_FACTOR_HOUSE = 0.2
#: Buildings that may declare a budget_exception (×2).
EXCEPTION_ALLOWED = ("warehouse", "shipyard", "chapel", "market_small")

#: Footprint fit tolerance (tiles) and ship length tolerance.
FOOTPRINT_TOLERANCE = 0.3
SHIP_LENGTH_TOLERANCE = 0.1
#: The lowest point of a building or field must lie this close to the ground (tiles).
GROUND_RANGE = (-0.3, 0.05)

#: Palette check tolerance per channel.
COLOR_TOLERANCE = 1.0 / 255.0

#: Default status anchor height above the model (tiles).
STATUS_ABOVE = 0.25

#: Content IDs that need a model: tier 1–2 buildings except roads (fields included) and these ships.
MODEL_TIERS = ("settlers", "citizens")
MODEL_SHIPS = ("sloop",)

#: Blender version the determinism guarantee holds for.
BLENDER_MAJOR_MINOR = (5, 2)

#: Positions are rounded to this many decimals before export (stable bytes).
POSITION_DECIMALS = 5
NORMAL_DECIMALS = 5


def kits_root():
    """The kit root: NEW_SHORES_KITS_DIR if set, else <repo>/assets/kits."""
    env = os.environ.get(KITS_ENV, "").strip()
    return os.path.abspath(env) if env else os.path.join(ASSETS_DIR, "kits")

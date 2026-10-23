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
    # KayKit Medieval Hexagon: home_A (0.79 × 0.85 kit units) on the 2 × 2
    # house footprint → 1.82 × 1.96 tiles, 2.1 tiles tall (the chunky,
    # exaggerated silhouette of the restyle). Props need a part scale.
    "kaykit_hexagon": 2.3,
    # KayKit Forest Nature: Tree_1_A is 3.9 units tall → 1.2 tiles
    # (provisional until the nature pass measures it in the client).
    "kaykit_forest": 0.3,
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
ROLE_GROUPS = ("buildings", "terrain", "fields", "water", "island")

#: Palette group with the two-tone shadow tone of every role.
SHADOW_GROUP = "shadows"

#: Ambient occlusion baked into the vertex colours (Blender BVH ray casts,
#: deterministic): every triangle corner casts AO_RAYS fixed cosine-weighted
#: rays into its face's hemisphere up to AO_DISTANCE tiles (buildings and
#: fields also against the ground plane z = 0); the hit share is quantised
#: to AO_LEVELS steps and blends the corner colour toward the role's shadow
#: tone by up to AO_STRENGTH. Quantised levels keep the colours a small,
#: checkable set (palette × shade blended toward shadow × shade).
AO_RAYS = 24
AO_DISTANCE = 0.45
AO_LEVELS = 4
AO_STRENGTH = 0.75
#: Recipes with "ao": "crevices" (small decoration) drop this many levels
#: from every corner: open and lightly occluded faces keep the palette
#: colour, only the crevices darken.
AO_CREVICE_CUT = 2
#: Shadow chroma bias per role (the two-tone of thatch): a roof slope
#: turned from the sun is lit by the blue sky fill alone and turns
#: grey-olive. Two parts:
#: - SHADOW_CHROMA: the darker a colour of the role (dark gradient bands,
#:   baked occlusion) is than the role's palette colour, the more its
#:   chroma is raised about its own luminance — by up to this share at
#:   black. Lit colours are unchanged.
#: - NORMAL_TILT: the role's normals are tilted toward up by this much
#:   (n + k·up, normalised), so the slope away from the sun still catches
#:   some warm sunlight and the lit slope a little less: the two sides move
#:   closer and the shadow side keeps the straw's chroma.
SHADOW_CHROMA = {"thatch": 0.9}
NORMAL_TILT = {"thatch": 0.7}

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

#: Gradient-atlas kits (KayKit, nsassets/atlas.py): a face's material is
#: "Atlas/<swatch>@<band>" from the grid cell of its UV centroid (exact:
#: no triangle spans cells) and the band of the cell's vertical gradient
#: (0 = light top … 2 = dark bottom). Cells map to (swatch, role, shade);
#: the band multiplies the shade (KayKit's two-tone read without the
#: texture), capped so that no channel clamps. A recipe's `roles` map may
#: re-colour "Atlas/<swatch>" or one band "Atlas/<swatch>@<band>".
#: See assets/kits/README.md for the cell survey.
KIT_ATLAS_CELLS = {
    "kaykit_hexagon": {
        "grid": (8, 4),
        "bands": (1.1, 1.0, 0.86),
        "default": ("other", "stone", 1.0),
        "cells": {
            (0, 0): ("black", "iron", 0.75),
            (1, 0): ("white", "plaster", 1.0),
            (2, 0): ("stone", "stone", 1.0),
            (3, 0): ("stone_dark", "slate", 1.0),
            (4, 0): ("charcoal", "iron", 1.0),
            (5, 0): ("wood_light", "timber", 1.2),
            (6, 0): ("wood", "timber", 1.0),
            (7, 0): ("orange", "terracotta", 1.1),
            (0, 1): ("water", "shallows", 1.0),
            (1, 1): ("blue", "dye-blue", 1.0),
            (2, 1): ("brown", "timber", 0.9),
            (3, 1): ("straw", "wheat", 1.0),
            (4, 1): ("green", "hemp", 1.0),
            (5, 1): ("tan", "canvas", 0.92),
            (6, 1): ("grey", "stone", 0.85),
            (7, 1): ("taupe", "mountain", 0.8),
            (0, 2): ("grass", "grass-b", 1.0),
            (1, 2): ("leaf", "tree-crown", 1.0),
            (2, 2): ("rock", "mountain", 1.0),
            (3, 2): ("sand", "sand", 0.95),
            (4, 2): ("sand", "sand", 0.95),
            (5, 2): ("cream", "canvas", 1.0),
            (6, 2): ("red", "terracotta", 1.1),
            (7, 2): ("pink", "orchard-mark", 1.0),
            # The team colour (roofs, flags, awnings): the only difference
            # between the blue/red/yellow/green building files.
            (0, 3): ("team", "thatch", 1.0),
            (1, 3): ("team", "thatch", 1.0),
            (2, 3): ("team", "thatch", 1.0),
            (3, 3): ("team", "thatch", 1.0),
            (4, 3): ("amber", "ochre", 1.0),
            (5, 3): ("beige", "canvas", 0.85),
            (6, 3): ("dust", "road-dirt", 0.9),
            (7, 3): ("umber", "mountain", 0.7),
        },
    },
    "kaykit_forest": {
        "grid": (8, 4),
        "bands": (1.1, 1.0, 0.86),
        # Only column 0 is painted; the rest is a grey placeholder gradient.
        "default": ("other", "mountain", 1.0),
        "cells": {
            (0, 0): ("foliage", "tree-crown", 1.0),
            (0, 1): ("bark", "timber", 1.1),
            (0, 2): ("rock", "mountain", 1.0),
        },
    },
}

#: Whole kit buildings a recipe can reference by name (`kit_building`): name
#: → (kit, file, front rotation about z in degrees). KayKit buildings face
#: −y; our front is +y, so they turn 180° (the recipe's rotation adds to
#: it). The blue files are used everywhere: the colour variants differ only
#: in the `team` swatch, which recipes re-colour.
_HEX_BUILDINGS = "Assets/gltf/buildings/"
KIT_BUILDINGS = {
    **{
        name: ("kaykit_hexagon", f"{_HEX_BUILDINGS}blue/building_{name}_blue.gltf", 180.0)
        for name in (
            "archeryrange", "barracks", "blacksmith", "castle", "church", "home_A", "home_B", "lumbermill",
            "market", "mine", "tavern", "tower_A", "tower_B", "tower_base", "tower_catapult", "watermill",
            "well", "windmill",
        )
    },
    **{
        name: ("kaykit_hexagon", f"{_HEX_BUILDINGS}neutral/building_{name}.gltf", 180.0)
        for name in ("destroyed", "dirt", "grain", "scaffolding", "stage_A", "stage_B", "stage_C")
    },
}

#: Triangle budgets per exported file (restyle: chunky KayKit-led models;
#: ships unchanged).
BUDGET_BUILDING = 6000
BUDGET_BUILDING_EXCEPTION = 12000
BUDGET_HOUSE = 2500
BUDGET_FIELD = 300
BUDGET_SHIP = 1500
BUDGET_ATTACHMENT = 150
#: Decoration pieces (kind "decor": trees, bushes, rocks, tufts, stumps,
#: outcrops) are merged by the hundreds per island chunk: small budgets.
BUDGET_DECOR = 300
#: Decoration recipe IDs start with this prefix (they are not content IDs).
DECOR_PREFIX = "decor_"
#: Lite models (drawn at the near-LOD default zoom, full ones at a half
#: extent ≤ 10) are generated, not authored: every building's model
#: without its lod-"full" parts is decimated by Blender's edge collapse to
#: the first ratio of LITE_RATIOS whose result still fits and covers the
#: footprint and touches the ground (collapse can eat a thin yard or
#: plinth), never below LITE_MIN_TRIS triangles; then it is validated like
#: the full model (footprint, palette, export profile) against
#: LITE_FACTOR × the full budget.
#: Whether building models get a generated lite file at all. The client
#: draws the full file where a model has no lite one, so turning this off
#: drops the lite tier (kept switchable for devices that need it).
LITE_MODELS = True
LITE_RATIOS = (0.25, 0.35, 0.5, 0.7, 1.0)
LITE_MIN_TRIS = 150
#: Houses (dozens on screen at the default zoom) aim lower: their lite model
#: is decimated toward LITE_HOUSE_TRIS first (stepping up by
#: LITE_HOUSE_STEP while the footprint check fails), then LITE_RATIOS.
LITE_HOUSE_TRIS = 120
LITE_HOUSE_STEP = 1.25
LITE_FACTOR = 0.25
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

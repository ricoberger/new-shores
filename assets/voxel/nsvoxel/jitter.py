"""
Jitter classes (D-057 V2): the client's model shader perturbs each voxel's
colour by a hash of its position, with a strength per material class
(client/src/render/jitter.ts JITTER_CLASSES). The class rides in the
COLOR_0 alpha byte of rigid vertices: 255 − class (248..255); swaying
vertices keep their sway alpha (≤ SWAY_ALPHA_MAX) and get the shader's
cloth/leaf strength.
"""

NONE, STONE, ROOF, PLASTER, WOOD, GROUND, FOLIAGE, METAL = range(8)

#: Every material role (palette groups buildings, terrain, fields, water,
#: island) and its class; a role missing here is a build error.
ROLE_CLASS = {
    # Stone and rock: strong.
    "stone": STONE,
    "rock": STONE,
    "rock-deep": STONE,
    "rock-light": STONE,
    "cliff": STONE,
    "cliff-foot": STONE,
    "cliff-ledge": STONE,
    "cliff-lower": STONE,
    "cliff-upper": STONE,
    "mountain": STONE,
    "deposit-iron": STONE,
    "road-paved": STONE,
    "road-border": STONE,
    # Roofs: strong.
    "terracotta": ROOF,
    "thatch": ROOF,
    "slate": ROOF,
    # Plaster, painted and woven surfaces: light.
    "plaster": PLASTER,
    "ochre": PLASTER,
    "canvas": PLASTER,
    "dye-blue": PLASTER,
    # Wood: medium.
    "timber": WOOD,
    # Ground and crops: medium.
    "grass-a": GROUND,
    "grass-b": GROUND,
    "sand": GROUND,
    "sand-rim": GROUND,
    "dry": GROUND,
    "forest-floor": GROUND,
    "road-dirt": GROUND,
    "pasture": GROUND,
    "pasture-mark": GROUND,
    "wheat": GROUND,
    "wheat-mark": GROUND,
    "hemp": GROUND,
    "hemp-mark": GROUND,
    "orchard": GROUND,
    "orchard-mark": GROUND,
    "unsettled": GROUND,
    # Leaves and flowers: medium.
    "tree-crown": FOLIAGE,
    "moss": FOLIAGE,
    "flower": FOLIAGE,
    # Metal: light.
    "iron": METAL,
    "brass": METAL,
    # Glass, water and haze: none.
    "window": NONE,
    "foam": NONE,
    "shallows": NONE,
    "deep": NONE,
    "haze": NONE,
}

#: Largest alpha byte of a swaying vertex (below the class codes 248..255).
SWAY_ALPHA_MAX = 245


def alpha_of(role):
    """COLOR_0 alpha byte of a rigid vertex of a role: 255 − its class."""
    return 255 - ROLE_CLASS[role]

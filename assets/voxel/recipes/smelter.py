"""
Smelter (4 × 6; V7 rework after the Anno 1404 iron smelter, tier II): a
battered blast furnace of dark ashlar with an arched mouth glowing orange
and a slim brick-capped stack (smoke), beside a rubble-and-half-timber
casting house under terracotta; a stepped hot-slag bed, heaps of ore and
charcoal, ingots stacked pale on a pallet and a cart. 12 voxels per tile.
"""

from nsvoxel import parts as P
from nsvoxel import parts_kit as K
from nsvoxel import parts_v7 as W
from nsvoxel.grid import mat
from nsvoxel.mats import IRON, IRON_ORE, STONE, STONE_DARK, TIMBER_DARK

VOXELS_PER_TILE = 12
GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

GLOW = mat("ochre", 1.7)
EMBER = mat("terracotta", 1.5)
INGOT = mat("iron", 2.0)
SOOT = mat("iron", 0.6)
ASHLAR = mat("stone", 0.8)


def build(ctx):
    v = ctx.vox()  # 48 × 72
    seed = 109
    K.ground(v, 24, 50, 20, 18, seed)
    # The furnace: a battered tower of ashlar, narrowing from 16 to 10.
    cx, cy = 14, 18
    for z in range(1, 30):
        r = 8 - 3 * z / 30
        x0, x1, y0, y1 = int(cx - r), int(cx + r), int(cy - r), int(cy + r)
        for x in range(x0, x1):
            for y in range(y0, y1):
                if x in (x0, x1 - 1) or y in (y0, y1 - 1):
                    v.set(x, y, z, ASHLAR if (z // 3) % 2 else mat("stone", 0.7))
        if z == 29:
            v.box(x0, y0, z, x1, y1, z + 1, ASHLAR)
    W.stack(v, cx - 1, cy - 1, 29, 38, 2, 2)
    v.anchor("chimney", cx, cy, 38)
    v.anchor("smoke", cx, cy, 39)
    # The arched mouth, glowing.
    v.box(cx - 3, cy + 5, 1, cx + 3, cy + 9, 8, None)
    v.box(cx - 2, cy + 6, 1, cx + 2, cy + 8, 6, EMBER)
    v.box(cx - 1, cy + 6, 1, cx + 1, cy + 8, 4, GLOW)
    # Casting house at the east.
    K.hall(v, 26, 8, 44, 34, 2, "y", seed, door=("x-", 22), wins=[], chimney=False)
    # Slag bed, ore and charcoal heaps, ingots.
    for i in range(4):
        v.box(4 + i * 3, 36, 1, 6 + i * 3, 42, 2 + (i % 2), EMBER if i == 0 else SOOT)
    from nsvoxel import detail_v4 as V
    V.heap(v, 8, 52, r=5, h=5, m=IRON_ORE, seed=seed)
    V.heap(v, 22, 56, r=4, h=4, m=SOOT, seed=seed + 1)
    for k in range(3):
        v.box(30, 40 + k * 4, 1, 40, 43 + k * 4, 3, INGOT)
    v.box(30, 40, 3, 38, 43, 5, INGOT)
    P.handcart(v, 28, 60, 1, along="x", load=INGOT)
    v.anchor("cart", 34, 68, 1)
    K.tufts(v, seed)
    return P.colour_jitter(v, seed=seed)

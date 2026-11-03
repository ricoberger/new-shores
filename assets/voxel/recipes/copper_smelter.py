"""
Copper smelter (4 × 6; V7 rework, tier IV): a battered ashlar furnace tower with a
glowing mouth and a slim stack (smoke) beside a cream-plaster casting hall
under slate, stacked copper ingots, a cart. Its own outbuilding on the camera
side (V7 leftovers): a tall brick stack and two plank ore bins heaped with
green-tinged ore. 12 voxels per tile.
"""

from nsvoxel import parts as P
from nsvoxel import parts_kit as K
from nsvoxel.grid import mat, shade_of
from nsvoxel.mats import STONE_LIGHT

VOXELS_PER_TILE = 12
GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

GOODS = mat("terracotta", 1.3)
GLOW = mat("ochre", 1.7)
ORE = mat("moss", 0.95)  # green-tinged copper ore (malachite)
BRK = mat("brick", 1.0)


def brick_stack(v, x, y, base=8, top=6, h=34):
    """A tall square brick stack: a battered 8 × 8 foot, a 6 × 6 shaft in alternating courses, a stone cap, a dark flue and an arched firebox."""
    o = (base - top) // 2
    for z in range(1, h):
        w0 = 0 if z < 4 else o
        x0, y0 = x + w0, y + w0
        x1, y1 = x + base - w0, y + base - w0
        for i in range(x0, x1):
            for j in range(y0, y1):
                edge = i in (x0, x1 - 1) or j in (y0, y1 - 1)
                if edge or z == h - 1:
                    v.set(i, j, z, shade_of(BRK, 1.0 if z % 2 else 0.88))
    v.box(x + o - 1, y + o - 1, h, x + base - o + 1, y + base - o + 1, h + 1, mat("stone", 1.0))
    v.box(x + o + 1, y + o + 1, h, x + base - o - 1, y + base - o - 1, h + 1, mat("iron", 0.5))
    v.box(x + 2, y + base - 1, 1, x + base - 2, y + base, 5, mat("iron", 0.45))  # firebox arch
    v.box(x + 3, y + base - 1, 4, x + base - 3, y + base, 5, STONE_LIGHT)


def build(ctx):
    v = ctx.vox()  # 48 × 72
    seed = 141
    K.ground(v, 24, 50, 20, 18, seed, "paved")
    K.furnace(v, 14, 18, glow=GLOW)
    K.workshop(v, 26, 8, 44, 34, 4, "a", seed, door=("x-", 22), wins=[])
    for i in range(3):
        v.box(30, 38 + i * 4, 1, 40, 41 + i * 4, 3, GOODS)
    v.box(30, 38, 3, 38, 41, 5, GOODS)
    brick_stack(v, 37, 56, 9, 7, 30)
    K.ore_bin(v, 5, 54, 16, 63, 1, 5, ORE, seed)
    K.ore_bin(v, 18, 54, 29, 63, 1, 5, shade_of(ORE, 1.1), seed + 3)
    P.handcart(v, 30, 64, 1, along="x", load=GOODS)
    v.anchor("cart", 34, 68, 1)
    K.tufts(v, seed, 0.02)
    return P.colour_jitter(v, seed=seed)

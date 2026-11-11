"""
Copper smelter (4 × 6; V7 rework, tier IV): a battered ashlar furnace tower with a
glowing mouth and a slim stack (smoke) beside a cream-plaster casting hall
under slate, stacked copper ingots, a cart. Its own outbuilding on the camera
side (V7 leftovers): a tall ashlar stack to the roofline (brick firebox and cap only) and two plank ore bins heaped with
green-tinged ore. 12 voxels per tile.
Re-dressed in the workshop look (D-075 §3, `look: workshop`): the tier-II look —
rubble ground floor, half-timber and terracotta tiles — whatever the unlock tier;
the special roofs and signature props are unchanged.
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
BRK = mat("brick", 1.0)  # an accent: the firebox and the stack cap only (D-064 §3)
STONE = mat("stone", 1.0)


def stack(v, x, y, base=9, top=7, h=36):
    """A tall stone stack to the hall's roofline: a battered 9 × 9 foot, a 7 × 7 ashlar shaft in alternating courses,
    a brick firebox at the foot (with the arched mouth), a two-course brick cap round a dark flue."""
    o = (base - top) // 2
    for z in range(1, h):
        w0 = 0 if z < 4 else o
        x0, y0 = x + w0, y + w0
        x1, y1 = x + base - w0, y + base - w0
        for i in range(x0, x1):
            for j in range(y0, y1):
                edge = i in (x0, x1 - 1) or j in (y0, y1 - 1)
                if not edge:
                    continue
                if z < 9:
                    m = shade_of(BRK, 1.0 if z % 2 else 0.88)  # the firebox
                elif z >= h - 2:
                    m = shade_of(BRK, 1.0 if z % 2 else 0.88)  # the cap
                else:
                    m = shade_of(STONE, 1.0 if z % 2 else 0.9)
                v.set(i, j, z, m)
    v.box(x + o - 1, y + o - 1, h, x + base - o + 1, y + base - o + 1, h + 1, BRK)
    v.box(x + o + 1, y + o + 1, h - 2, x + base - o - 1, y + base - o - 1, h + 1, mat("iron", 0.5))
    v.box(x + 2, y + base - 1, 1, x + base - 2, y + base, 5, mat("iron", 0.45))  # firebox arch
    v.box(x + 3, y + base - 1, 4, x + base - 3, y + base, 5, STONE_LIGHT)


def build(ctx):
    v = ctx.vox()  # 48 × 72
    seed = 141
    K.ground(v, 24, 50, 20, 18, seed, "paved")
    K.furnace(v, 14, 18, glow=GLOW)
    K.workshop(v, 26, 8, 44, 34, 2, "a", seed, door=("x-", 22), wins=[])
    for i in range(3):
        v.box(30, 38 + i * 4, 1, 40, 41 + i * 4, 3, GOODS)
    v.box(30, 38, 3, 38, 41, 5, GOODS)
    stack(v, 37, 56, 9, 7, 36)
    K.ore_bin(v, 5, 54, 16, 63, 1, 5, ORE, seed)
    K.ore_bin(v, 18, 54, 29, 63, 1, 5, shade_of(ORE, 1.1), seed + 3)
    P.handcart(v, 30, 64, 1, along="x", load=GOODS)
    v.anchor("cart", 34, 68, 1)
    K.tufts(v, seed, 0.02)
    return P.colour_jitter(v, seed=seed)

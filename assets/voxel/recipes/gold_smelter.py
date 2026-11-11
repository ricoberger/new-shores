"""
Gold smelter (4 × 6; V7 rework, tier IV): a battered ashlar furnace tower with a
glowing mouth and a slim stack (smoke) beside a cream-plaster casting hall
under slate, a cart. Its own outbuildings on the camera side (V7 leftovers): a
small ashlar strongroom with an iron-banded door and a barred window, and a
crucible hearth with a pyramid of brass ingots. 12 voxels per tile.
Re-dressed in the workshop look (D-075 §3, `look: workshop`): the tier-II look —
rubble ground floor, half-timber and terracotta tiles — whatever the unlock tier;
the special roofs and signature props are unchanged.
"""

from nsvoxel import parts as P
from nsvoxel import parts_kit as K
from nsvoxel import detail_v5 as Q
from nsvoxel import parts_v7 as W
from nsvoxel.grid import mat, shade_of
from nsvoxel.mats import BRASS, IRON, SLATE, STONE, STONE_DARK, STONE_LIGHT, TIMBER_DARK

VOXELS_PER_TILE = 12
GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

GOODS = mat("ochre", 1.6)
GLOW = mat("ochre", 1.9)


def strongroom(v, x0, y0, x1, y1, seed):
    """A small ashlar strongroom: dressed walls, a hipped slate roof, an iron-banded door on y+ and a barred slit window on x-."""
    h = 11
    W.coursed_stone_2(v, x0, y0, x1, y1, 1, h, STONE, seed)
    v.box(x0, y0, h, x1, y1, h + 1, STONE_LIGHT)  # cornice
    P.roof(v, x0, x1, y0, y1, h + 1, "slate", along="x", rise=1.0, ov=1, gable=STONE, seed=seed, m=SLATE, hip=True, ridge=mat("slate", 0.6))
    f = P.Face(v, "y+", y1 - 1)
    P.entrance(f, (x0 + x1) // 2 - 2, 2, 4, 7, leaf=IRON, frame=STONE_LIGHT, lintel=STONE_LIGHT, hinges=True, steps=1)
    for j in (2, 5):
        for i in range(0, 4):
            f.put((x0 + x1) // 2 - 2 + i, 1 + j, mat("iron", 0.7), out=-1)
    s = P.Face(v, "x-", x0)
    P.casement(s, (y0 + y1) // 2 - 1, 5, 3, 4, frame=STONE_LIGHT, sill=STONE_LIGHT, lintel=STONE_LIGHT, bars=False)
    Q.grille(s, (y0 + y1) // 2 - 1, 5, 3, 4)


def hearth(v, x, y, seed):
    """A crucible hearth: a stone block with a glowing bowl and a crucible rim, and a pyramid of brass ingots beside it."""
    v.box(x, y, 1, x + 9, y + 8, 7, STONE_DARK)
    v.box(x + 1, y + 1, 7, x + 8, y + 7, 8, STONE)
    v.box(x + 2, y + 2, 7, x + 7, y + 6, 8, None)
    v.box(x + 2, y + 2, 7, x + 7, y + 6, 8, GLOW)
    v.box(x + 3, y + 3, 8, x + 6, y + 5, 10, BRASS)  # the crucible
    v.box(x + 3, y + 3, 10, x + 6, y + 5, 11, GLOW)
    v.box(x + 3, y + 7, 1, x + 6, y + 8, 4, mat("iron", 0.45))  # fire mouth
    v.box(x + 4, y + 7, 1, x + 5, y + 8, 2, GLOW)
    ingots(v, x + 11, y + 2)


def ingots(v, x, y):
    """A pyramid of brass ingots (4 × 2 × 1), three, two and one per course, two rows deep."""
    for k in range(3):
        for i in range(3 - k):
            for j in range(2):
                bx, by = x + k * 2 + i * 5, y + j * 3
                v.box(bx, by, 1 + k, bx + 4, by + 2, 2 + k, shade_of(BRASS, 1.0 if (i + j + k) % 2 else 0.88))


def build(ctx):
    v = ctx.vox()  # 48 × 72
    seed = 143
    K.ground(v, 24, 50, 20, 18, seed, "paved")
    K.furnace(v, 14, 18, glow=GLOW)
    K.workshop(v, 26, 8, 44, 34, 2, "a", seed, door=("x-", 22), wins=[])
    strongroom(v, 32, 40, 46, 52, seed)
    hearth(v, 4, 50, seed)
    P.handcart(v, 30, 62, 1, along="x", load=GOODS)
    v.anchor("cart", 34, 68, 1)
    K.tufts(v, seed, 0.02)
    return P.colour_jitter(v, seed=seed)

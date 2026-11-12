"""
Optician (4 × 4; V7 variety pass, tier IV): a two-storey cream plaster house
with a lean-to shed and a slim chimney (smoke); in front a lens-grinding
bench with a large brass-ringed lens and a grinding wheel, and a bracket at the
front wall with a hanging spectacles sign (V7 leftovers). 12 voxels per tile.
Re-dressed in the workshop look (D-075 §3, `look: workshop`): the tier-II look —
rubble ground floor and half-timber — under the dark burgundy tile, one of the grand
tier-4 workshops that may wear it; the props are unchanged.
"""

from nsvoxel import detail_v4 as V
from nsvoxel import parts as P
from nsvoxel import parts_kit as K
from nsvoxel import parts_v7 as W
from nsvoxel.grid import mat, shade_of
from nsvoxel.mats import CANVAS, IRON, TIMBER, TIMBER_DARK, TIMBER_LIGHT, WINDOW

VOXELS_PER_TILE = 12
GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

GOODS = mat("canvas", 1.3)
BRASS = mat("ochre", 1.5)
GLASS = mat("shallows", 1.5)
GLINT = mat("shallows", 1.9)


def lens(v, cx, cy, cz, r=5):
    """A big upright lens (normal along y): a brass ring one voxel wide round a pale glass disc, two voxels thick."""
    for x in range(cx - r - 1, cx + r + 2):
        for z in range(cz - r - 1, cz + r + 2):
            d = ((x - cx) ** 2 + (z - cz) ** 2) ** 0.5
            if d <= r + 0.5:
                if d > r - 1:
                    v.box(x, cy - 1, z, x + 1, cy + 2, z + 1, BRASS)
                else:
                    v.box(x, cy, z, x + 1, cy + 1, z + 1, GLINT if (x - z) % 5 else GLASS)


def sign(v, x, y, z):
    """A bracket from the front wall (y) with a hanging board 12 wide: two brass rings with glass and a bridge, the spectacles."""
    v.box(x, y, z + 7, x + 1, y + 13, z + 8, IRON)  # arm
    v.box(x, y, z + 1, x + 1, y + 1, z + 7, IRON)  # post on the wall
    for oy in (3, 11):  # chains
        v.box(x, y + oy, z + 5, x + 1, y + oy + 1, z + 7, IRON)
    v.box(x - 1, y + 1, z, x + 1, y + 13, z + 5, TIMBER_DARK)  # the board, two deep
    for oy in (2, 7):
        v.box(x - 1, y + oy, z + 1, x, y + oy + 4, z + 4, BRASS)
        v.box(x - 1, y + oy + 1, z + 2, x, y + oy + 3, z + 3, WINDOW)
    v.box(x - 1, y + 6, z + 2, x, y + 7, z + 3, BRASS)  # the bridge
    v.box(x - 1, y + 1, z + 2, x, y + 2, z + 3, BRASS)  # the temples
    v.box(x - 1, y + 11, z + 2, x, y + 12, z + 3, BRASS)


def build(ctx):
    v = ctx.vox()  # 48 × 48
    seed = 163
    K.ground(v, 24, 41, 21, 9, seed, "paved")
    h = K.workshop(v, 6, 6, 48 - 6, 28, 2, "b", seed, door=("y+", 22), smoke=True, chim=(34, 10), wins=[], dark=True)
    for x in (8, 22):  # the lens-grinding bench
        for y in (33, 38):
            v.box(x, y, 1, x + 2, y + 2, 5, TIMBER_DARK)
    v.box(7, 32, 5, 25, 40, 6, TIMBER_LIGHT)
    lens(v, 14, 36, 12, 5)
    v.box(12, 35, 6, 17, 38, 7, TIMBER_DARK)  # its stand
    P.cask(v, 21, 34, 6, h=2, m=TIMBER_DARK)  # grinding wheel
    v.box(20, 34, 6, 24, 38, 7, shade_of(BRASS, 0.7))
    sign(v, 40, 28, 11)
    P.handcart(v, 8, 36, 1, along="x", load=GOODS)
    v.anchor("cart", 14, 42, 1)
    K.tufts(v, seed, 0.02)
    return P.colour_jitter(v, seed=seed)

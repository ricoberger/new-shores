"""
Leather works (3 × 4; V7 rework, tier III; no 1404 render): a stone-and-
timber workshop under dark burgundy tiles with hides stretched in frames and
hung on a drying rack, a row of pale tanning vats, bundles of finished
leather and a cart. No chimney. 12 voxels per tile.
"""

from nsvoxel import detail_v4 as V
from nsvoxel import parts as P
from nsvoxel import parts_kit as K
from nsvoxel.grid import mat
from nsvoxel.mats import TIMBER, TIMBER_DARK

VOXELS_PER_TILE = 12
GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

HIDE = mat("ochre", 1.1)
HIDE_DARK = mat("timber", 1.05)
LEATHER = mat("ochre", 0.8)
LIQUOR = mat("timber", 0.55)


def build(ctx):
    v = ctx.vox()  # 36 × 48
    seed = 107
    K.ground(v, 18, 28, 15, 15, seed)
    K.hall(v, 4, 4, 28, 22, 3, "x", seed, door=("y+", 12), wins=[])
    V.hide_frame(v, 30, 8, 1, 4, 7, HIDE, frame=TIMBER_DARK, along="y")
    V.hide_frame(v, 30, 18, 1, 4, 7, HIDE_DARK, frame=TIMBER_DARK, along="y")
    V.drying_frame(v, 4, 28, 40, 1, 9, (HIDE, HIDE_DARK, LEATHER), post=TIMBER_DARK, every=6, sway=False, drop=7)
    for x in (4, 12, 20):
        v.box(x, 28, 1, x + 6, 34, 4, TIMBER)
        v.box(x + 1, 29, 4, x + 5, 33, 5, LIQUOR)
    K.pile(v, 24, 30, 1, 6, 5, 4, LEATHER, seed)
    P.handcart(v, 4, 36, 1, along="x", load=LEATHER)
    v.anchor("cart", 10, 44, 1)
    K.tufts(v, seed)
    return P.colour_jitter(v, seed=seed)

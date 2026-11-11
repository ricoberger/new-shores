"""
Slaughterhouse (4 × 4; V7 variety pass, tier IV): an L-plan two-storey
plaster-and-ashlar block under slate with a slim chimney (smoke); in front a
tall rail with big sides of red meat, a scalding tub and salt barrels. 12
voxels per tile; massing and signature prop in NOTES.md.
Re-dressed in the workshop look (D-075 §3, `look: workshop`): the tier-II look —
rubble ground floor, half-timber and terracotta tiles — whatever the unlock tier;
the special roofs and signature props are unchanged.
"""

from nsvoxel import detail_v4 as V
from nsvoxel import parts as P
from nsvoxel import parts_kit as K
from nsvoxel import parts_v7 as W
from nsvoxel.grid import mat, shade_of
from nsvoxel.mats import CANVAS, IRON, STONE, TIMBER, TIMBER_DARK, TIMBER_LIGHT

VOXELS_PER_TILE = 12
GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

GOODS = mat("terracotta", 1.25)
HAM = mat("terracotta", 0.9)

def build(ctx):
    v = ctx.vox()  # 48 × 48
    seed = 167
    K.ground(v, 24, 41, 21, 9, seed, "paved")
    h = K.workshop(v, 6, 6, 48 - 6, 28, 2, "c", seed, door=("y+", 22), smoke=True, chim=(34, 10), wins=[])
    for x in (6, 40):
        v.box(x, 34, 1, x + 1, 35, 18, TIMBER_DARK)
    v.box(6, 34, 17, 41, 35, 18, TIMBER)
    V.hanging(v, 8, 40, 34, 17, ((GOODS, 10), (HAM, 8)), every=4)
    V.vat(v, 12, 42, 1, r=5, h=5, m=mat("timber", 0.8), liquid=mat("shallows", 1.2))
    P.cask(v, 30, 40, 1, h=5, lid=CANVAS)
    P.cask(v, 36, 40, 1, h=5, lid=CANVAS)
    P.handcart(v, 8, 36, 1, along="x", load=GOODS)
    v.anchor("cart", 14, 42, 1)
    K.tufts(v, seed, 0.02)
    return P.colour_jitter(v, seed=seed)

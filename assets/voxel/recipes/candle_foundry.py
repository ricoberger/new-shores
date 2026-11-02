"""
Candle foundry (4 × 4; V7 rework, tier IV): a cream plaster house on an
ashlar floor under slate with a slim chimney (smoke), a copper wax vat on a
hearth, a rack of long pale candles hung to cool, barrels of tallow and
beeswax cakes stacked pale, a cart. 12 voxels per tile; paved yard.
"""

from nsvoxel import detail_v4 as V
from nsvoxel import parts as P
from nsvoxel import parts_kit as K
from nsvoxel.grid import mat
from nsvoxel.mats import IRON, TIMBER_DARK

VOXELS_PER_TILE = 12
GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

WAX = mat("canvas", 1.3)
COPPER = mat("terracotta", 1.3)


def build(ctx):
    v = ctx.vox()  # 48 × 48
    seed = 123
    K.ground(v, 24, 34, 18, 12, seed, "paved")
    K.hall(v, 10, 4, 40, 24, 4, "x", seed, door=("y+", 28), smoke=True, chim=(34, 8), wins=[14])
    V.vat(v, 8, 32, 1, r=4, h=6, m=COPPER, liquid=WAX)
    K.rack(v, 18, 40, 30, WAX, h=12, drop=9)
    K.pile(v, 16, 36, 1, 8, 5, 3, WAX, seed)
    P.cask(v, 36, 38, 1, lid=WAX)
    P.cask(v, 40, 38, 1, lid=WAX)
    P.handcart(v, 4, 40, 1, along="x", load=WAX)
    v.anchor("cart", 10, 46, 1)
    K.tufts(v, seed, 0.02)
    return P.colour_jitter(v, seed=seed)

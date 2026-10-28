"""
Cattle pasture (4 × 7 module; D-057 §3): grazed grass in patches with
tufts and flowers, worn earth at the gate and the trough, an uneven
post-and-rail fence with a gate at the front, a long water trough, a hay
rack and a shade tree; the cattle are life instances (anchors).
"""

from nsvoxel import parts as P
from nsvoxel.grid import hash3
from nsvoxel.mats import DIRT, PASTURE, PASTURE_MARK, THATCH, TIMBER


def build(ctx):
    v = ctx.vox()  # 32 × 56
    W, D = ctx.W, ctx.D
    seed = 17
    for x in range(W):
        for y in range(D):
            v.set(x, y, 0, PASTURE if hash3(x // 4, y // 4, 0, seed) < 0.7 else PASTURE_MARK)
    for x in range(12, 20):
        for y in range(D - 6, D - 1):
            if hash3(x, y, 3, seed) < 0.65 - (D - 2 - y) * 0.12:
                v.set(x, y, 0, P.shade_of(DIRT, 0.95))
    P.fence_ring(v, 0, 0, W, D, kind="rail", gaps={(x, D - 1) for x in range(13, 19)}, seed=seed)
    v.box(12, D - 1, 1, 13, D, 4, TIMBER)
    v.box(19, D - 1, 1, 20, D, 4, TIMBER)
    v.box(13, D - 1, 3, 19, D, 4, P.mat("timber", 0.82))
    P.trough(v, 3, 3, 1, length=8, along="x")
    # Hay rack.
    v.box(24, 4, 1, 25, 10, 5, TIMBER)
    v.box(28, 4, 1, 29, 10, 5, TIMBER)
    v.box(25, 4, 2, 28, 10, 5, THATCH)
    v.box(24, 4, 5, 29, 10, 6, TIMBER)
    P.fruit_tree(v, 5, 40, 1, seed=seed, trunk=5, r=3.6)
    P.scatter(v, 1, 1, W - 1, D - 1, 0.02, seed=seed, kinds=("tuft", "tuft", "flower"))
    v.anchor("gate", 16, D - 0.6, 0)
    v.anchor("cattle_1", 9.6, 16, 1)
    v.anchor("cattle_2", 22.4, 26.4, 1)
    v.anchor("cattle_3", 14.4, 40, 1)
    v.anchor("door", 16, D, 0)
    return P.colour_jitter(v, seed=seed, ground=0.25)

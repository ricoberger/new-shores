"""
Pasture (3 × 3 field; D-057 §3): grazed grass in patches with tufts,
clover and a few flowers, worn earth at the gate and the trough, an
uneven post-and-rail fence with a gate at the front, a plank water
trough and a salt-lick stone; the sheep are life instances (anchors).
"""

from nsvoxel import parts as P
from nsvoxel.grid import hash3
from nsvoxel.mats import DIRT, PASTURE, PASTURE_MARK, STONE_LIGHT, TIMBER


def build(ctx):
    v = ctx.vox()
    seed = 7
    for x in range(24):
        for y in range(24):
            v.set(x, y, 0, PASTURE if hash3(x // 3, y // 3, 0, seed) < 0.6 else PASTURE_MARK)
    # Worn earth inside the gate and round the trough.
    for x in range(9, 15):
        for y in range(19, 23):
            if hash3(x, y, 3, seed) < 0.6 - (22 - y) * 0.12:
                v.set(x, y, 0, P.shade_of(DIRT, 0.95))
    for x in range(2, 9):
        for y in range(2, 7):
            if hash3(x, y, 4, seed) < 0.45:
                v.set(x, y, 0, P.shade_of(DIRT, 0.95))
    P.fence_ring(v, 0, 0, 24, 24, kind="rail", gaps={(10, 23), (11, 23), (12, 23), (13, 23)}, every=4, seed=seed)
    v.box(9, 23, 1, 10, 24, 4, TIMBER)
    v.box(14, 23, 1, 15, 24, 4, TIMBER)
    v.box(10, 23, 3, 14, 24, 4, P.mat("timber", 0.82))
    P.trough(v, 3, 3, 1, length=5, along="x")
    v.box(19, 4, 1, 20, 5, 2, STONE_LIGHT)
    P.scatter(v, 1, 1, 23, 23, 0.05, seed=seed, kinds=("tuft", "tuft", "tuft", "flower"))
    v.anchor("gate", 12, 23.4, 0)
    v.anchor("sheep_1", 7.2, 9.6, 1)
    v.anchor("sheep_2", 17.2, 12.4, 1)
    v.anchor("sheep_3", 11.2, 18, 1)
    v.anchor("door", 12, 24, 0)
    return P.colour_jitter(v, seed=seed, ground=0.5)

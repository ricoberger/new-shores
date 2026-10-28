"""Pasture (3 × 3 field): grazed grass in two tones, a post-and-rail fence with a gate at the front, a water trough."""

from nsvoxel import parts as P
from nsvoxel.grid import hash3
from nsvoxel.mats import PASTURE, PASTURE_MARK, TIMBER, TIMBER_LIGHT


def build(ctx):
    v = ctx.vox()
    for x in range(24):
        for y in range(24):
            v.set(x, y, 0, PASTURE if hash3(x // 4, y // 4, 0, 7) < 0.6 else PASTURE_MARK)
    P.fence(v, 0, 0, 24, 24, gaps={(10, 23), (11, 23), (12, 23), (13, 23)})
    v.box(9, 23, 1, 10, 24, 3, TIMBER)
    v.box(14, 23, 1, 15, 24, 3, TIMBER)
    v.box(3, 3, 1, 8, 5, 2, TIMBER)
    v.box(4, 3, 2, 7, 5, 2, None)
    v.box(4, 3, 1, 7, 5, 2, P.mat("shallows"))
    v.set(3, 3, 2, TIMBER_LIGHT)
    v.anchor("gate", 12, 23.4, 0)
    v.anchor("sheep_1", 7.2, 9.6, 1)
    v.anchor("sheep_2", 17.2, 12.4, 1)
    v.anchor("sheep_3", 11.2, 18, 1)
    v.anchor("door", 12, 24, 0)
    return v

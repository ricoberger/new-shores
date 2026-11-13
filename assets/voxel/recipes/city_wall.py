"""
City wall (1 × 1 paint family, D-077 §3, Patricians since D-078 §2,
`look: civic`): a stone curtain wall four voxels thick along the tile's
centre line (voxels 2..6, the line the tower's and the gatehouse's wall
stubs meet) and two tiles high (D-078 §6: 16 voxels to the merlons' top,
above the well's 14), a darker footing course, a wall-walk at z = H
between parapets on its outline: a continuous course one voxel high,
merlons on every other pair of voxels above it. The straight piece runs along x; the join pieces
(config.PAINT_JOINS: corner, T, cross, end; `city_wall.<piece>`) add arms
toward the tile edges of their neighbours (parts_d077.JOIN_ARMS), and the
`arch` is the straight piece over a land road (D-077 §3 road crossing): a
stepped passage through y under a dressed arch. 8 voxels per tile; no
ground paint.
"""

from nsvoxel import parts as P
from nsvoxel import parts_d077 as O
from nsvoxel.mats import STONE, STONE_DARK, STONE_LIGHT

#: The wall's thickness band (voxels) and the wall-walk's height (the parapet and merlons add two: 16 = two tiles).
LO, HI, H = 2, 6, 14
#: The arch's opening height per column x = 2..5 (the road passes through y).
ARCH = (7, 9, 9, 7)


def build(ctx):
    v = ctx.vox()  # 8 × 8
    cells = O.join_cells(ctx.join, v.w, LO, HI)
    for x, y in cells:
        v.set(x, y, 0, STONE_DARK)
        v.box(x, y, 1, x + 1, y + 1, H, STONE)
    for x, y in O.join_rim(cells, v.w):
        v.set(x, y, H, STONE)  # the parapet
        if ((x + y) // 2) % 2 == 0:
            v.set(x, y, H + 1, STONE_LIGHT)  # a merlon
    if ctx.join == "arch":
        for i, h in enumerate(ARCH):
            x = LO + i
            for y in range(LO, HI):
                for z in range(0, h):
                    v.set(x, y, z, None)
                v.set(x, y, h, STONE_LIGHT)  # the dressed voussoirs
    return P.colour_jitter(v, seed=33)

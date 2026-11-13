"""
Trading pier (6 × 9 shore, D-062, D-060, D-077 §5, Merchants): a stone
jetty on the quay plinth of the harbour buildings (D-078 §3,
parts_d078.plinth: stone slabs under every tile, a dressed side face into
the water with iron mooring rings, timber mooring posts along the sea
edge and both flanks), crates, barrels and sacks, a cargo crane with a
hanging crate and lantern posts; at the land end a toll house with a
tiled roof and its counting table. Berth anchors
`berth_1`/`berth_2` sit 0.15 tiles off the two long flanks
(x = -1.8 and W + 1.8 voxels) at the middle of the deck's water rows, so a
ship lies alongside the pier. 12 voxels per tile (D-078 step 6).

Everything solid (the toll house) stands on the three rows behind the
front six (the deck rows of D-062), so the open jetty faces the sea.
"""

from nsvoxel import parts as P
from nsvoxel import detail_d060 as D
from nsvoxel import parts_d078 as Q
from nsvoxel import parts_v7 as W
from nsvoxel.grid import mat
from nsvoxel.mats import CANVAS, IRON, PLASTER, TIMBER, TIMBER_DARK, TIMBER_LIGHT

VOXELS_PER_TILE = 12

P_PLANK = mat("timber", 1.62)
ROPE = mat("canvas", 0.78)
TILE = mat("terracotta", 0.92)
TILE_RIDGE = mat("terracotta", 0.7)
#: The deck's six water rows in voxels; the land rows follow.
WATER = 72


def crane(v, x, y, top=22, jib=12):
    """A cargo crane: a post on a stepped foot with two braces, a jib out over the water, a pulley, rope and a hanging crate."""
    v.box(x - 1, y - 1, 1, x + 3, y + 3, 2, TIMBER_DARK)  # the foot
    v.box(x, y, 1, x + 2, y + 2, top, TIMBER)
    for k in range(5):
        v.set(x, y - 1 - k, top - 6 + k, TIMBER)  # brace under the jib
        v.set(x + 1, y - 1 - k, top - 6 + k, TIMBER)
    for j in range(jib + 1):
        v.set(x, y - j, top, TIMBER_LIGHT)
        v.set(x + 1, y - j, top, TIMBER_LIGHT)
    v.box(x, y - jib, top - 1, x + 2, y - jib + 1, top, IRON)  # the pulley block
    for z in range(top - 8, top - 1):
        v.set(x, y - jib, z, IRON)
    P.box_crate(v, x - 1, y - jib - 1, top - 11, s=3)
    for z in range(4, top - 2, 2):  # a tag line down the post
        v.set(x + 2, y + 1, z, ROPE)


def stack(v, x, y, s=3, rows=2):
    """A little pyramid of crates: `rows` on the ground, one fewer on top, one on top of that."""
    for r in range(rows):
        for i in range(rows - r):
            P.box_crate(v, x + i * s + r, y + r, 1 + r * s, s=s)


def build(ctx):
    v = ctx.vox()  # 72 × 108
    seed = 86
    W_, D_, land = ctx.W, ctx.D, WATER
    Q.plinth(v, 0, 0, W_, D_, vpt=12, edges=("y-", "x-", "x+"), seed=seed)
    for x in (15, W_ - 19):
        D.mooring_ring(v, x, -1, -6)
    for y in (18, 54):
        D.mooring_ring(v, -1, y, -6, plane="yz")
        D.mooring_ring(v, W_, y, -6, plane="yz")
    # The berths on the two long flanks, mid-flank of the deck's water rows, so a ship lies alongside.
    for k, x in enumerate((-1.8, W_ + 1.8)):
        v.anchor(f"berth_{k + 1}", x, land / 2, 0.72)
    # Goods on the deck, the crane and the lanterns.
    stack(v, 6, 56)
    stack(v, 56, 18)
    stack(v, 8, 18, rows=1)
    stack(v, 12, 18, rows=1, s=2)
    for x, y in ((54, 60), (54, 63), (57, 61)):
        P.cask(v, x, y, 1, h=4)
    P.cask(v, 8, 39, 1, h=4)
    P.cask(v, 11, 39, 1, h=4)
    P.sacks(v, 9, 45, 1, n=3, along="y")
    P.sacks(v, 61, 6, 1, n=3, along="y")
    P.sacks(v, 25, 60, 1, n=2)
    crane(v, 24, 21, 22, jib=12)
    for x in (6, 22, 40):  # coils of rope by the mooring posts
        v.box(x, 4, 1, x + 3, 7, 2, ROPE)
        v.set(x + 1, 5, 1, TIMBER_DARK)
    # An open cargo shelter on the deck: six posts under a hipped plank roof, goods beneath.
    for px in (45, 54, 64):
        for py in (39, 54):
            v.box(px, py, 1, px + 2, py + 2, 13, TIMBER)
    for py in (39, 54):
        v.box(45, py, 12, 66, py + 2, 13, TIMBER_DARK)
        for k in range(3):  # knee braces under the tie beams
            v.set(47 + k, py, 11 - k, TIMBER)
            v.set(63 - k, py, 11 - k, TIMBER)
    v.hip(43, 68, 37, 57, 13, mat("timber", 1.12), ov=0, rise=0.6, ridge=mat("timber", 0.9))
    P.box_crate(v, 48, 42, 1, s=4)
    P.box_crate(v, 54, 42, 1, s=4)
    P.box_crate(v, 51, 42, 5, s=3)
    P.sacks(v, 48, 49, 1, n=3)
    P.sacks(v, 57, 49, 1, n=2)
    for x, y in ((4, 4), (W_ - 5, 4), (4, 45), (W_ - 5, 45)):
        P.lamp_post(v, x, y, h=10)
    # The toll house on the land rows: a framed house with a tiled roof and its entrance on the landing.
    x0, y0, x1, y1 = 46, 83, 66, 97
    b = W.framed_house(v, x0, y0, x1, y1, "x", ground=8, top=14, roof=TILE, ridge=TILE_RIDGE, rise=1.15, seed=seed, bay=7,
                       infill=PLASTER, windows={"y-": (1,)}, plain=("y-", "y+", "x-", "x+"))
    f = b.face("y+")
    P.entrance(f, 54, 2, 3, 6, step=None)
    for a in (48, 61):
        P.casement(f, a, 3, 2, 4, frame=TIMBER_LIGHT, sill=TIMBER_LIGHT, shutters=TIMBER_LIGHT, bars=False)
    v.box(52, y1 + 1, 1, 60, y1 + 3, 4, TIMBER_DARK)  # the counting table under an awning
    v.box(52, y1 + 1, 4, 60, y1 + 3, 5, TIMBER_LIGHT)
    v.set(55, y1 + 2, 5, mat("brass"))
    v.box(51, y1, 9, 61, y1 + 4, 10, CANVAS)
    # The yard: goods waiting for a cart, a bench and lamps.
    P.box_crate(v, 6, 84, 1, s=3)
    P.box_crate(v, 10, 84, 1, s=3)
    P.box_crate(v, 7, 85, 4, s=2)
    P.cask(v, 6, 89, 1, h=4)
    P.bale(v, 10, 90, 1, w=4, d=3, h=3)
    P.bench(v, 18, 80, 1, 7, along="x")
    P.lamp_post(v, 27, 80, h=10)
    P.lamp_post(v, 43, 80, h=10)
    P.handcart(v, 15, 96, 1, along="x", load=CANVAS)
    v.anchor("cart", 30.3, 84, 1.5)
    v.anchor("door", 36, 108, 0)
    return P.colour_jitter(v, seed=seed)

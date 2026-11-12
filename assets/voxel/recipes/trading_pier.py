"""
Trading pier (6 × 9 shore, D-062, D-060, D-077 §5, Merchants): a stone
jetty on the quay plinth of the harbour buildings (D-078 §3,
parts_d078.plinth: stone slabs under every tile, a dressed side face into
the water with iron mooring rings, timber mooring posts along the sea
edge and both flanks), crates, barrels and sacks, a cargo crane with a
hanging crate and lantern posts; at the land end a toll house with a
tiled roof and its counting table. Berth anchors
`berth_1`/`berth_2` sit one and a bit voxels off the two long flanks
(x = -1.2 and W + 1.2) at the middle of the deck's water rows, so a ship
lies alongside the pier.

Everything solid (the toll house) stands on the three rows behind the
front six (the deck rows of D-062), so the open jetty faces the sea.
"""

from nsvoxel import parts as P
from nsvoxel import detail_d060 as D
from nsvoxel import parts_d078 as Q
from nsvoxel.grid import mat
from nsvoxel.mats import CANVAS, IRON, STONE, STONE_DARK, TIMBER, TIMBER_DARK, TIMBER_LIGHT

P_PLANK = mat("timber", 1.62)
#: The deck's six water rows in voxels; the land rows follow.
WATER = 48


def crane(v, x, y, top=15, jib=8):
    """A cargo crane: a post with a brace, a jib out over the water and a hanging crate."""
    v.box(x, y, 1, x + 2, y + 2, top, TIMBER)
    for k in range(3):
        v.set(x, y - 1 - k, 4 + k, TIMBER)  # brace under the jib
    for j in range(jib + 1):
        v.set(x, y - j, top, TIMBER_LIGHT)
    for z in range(top - 5, top):
        v.set(x, y - jib, z, IRON)
    P.box_crate(v, x, y - jib - 1, top - 7)


def stack(v, x, y, s=2, rows=2):
    """A little pyramid of crates: `rows` on the ground, one fewer on top, one on top of that."""
    for r in range(rows):
        for i in range(rows - r):
            P.box_crate(v, x + i * s + r, y + r, 1 + r * s, s=s)

def build(ctx):
    v = ctx.vox()  # 48 × 72
    seed = 86
    W, D_, land = ctx.W, ctx.D, WATER
    Q.plinth(v, 0, 0, W, D_, vpt=8, edges=("y-", "x-", "x+"), seed=seed)
    for x in (10, W - 13):
        D.mooring_ring(v, x, -1, -4)
    # The berths on the two long flanks, mid-flank of the deck's water rows, so a ship lies alongside.
    for k, x in enumerate((-1.2, W + 1.2)):
        v.anchor(f"berth_{k + 1}", x, land / 2, 0.48)
    # Goods on the deck, the crane and the lanterns.
    stack(v, 4, 38)
    stack(v, 38, 12)
    stack(v, 5, 12, rows=1)
    P.cask(v, 36, 40, 1)
    P.cask(v, 36, 42, 1)
    P.cask(v, 38, 41, 1)
    P.cask(v, 5, 26, 1)
    P.sacks(v, 6, 30, 1, n=2, along="y")
    P.sacks(v, 41, 4, 1, n=2, along="y")
    crane(v, 16, 14, 15, jib=8)
    # An open cargo shelter on the deck: four posts under a hipped plank roof, goods beneath.
    for px in (30, 43):
        for py in (26, 36):
            v.box(px, py, 1, px + 1, py + 1, 9, TIMBER)
    v.box(30, 26, 8, 44, 27, 9, TIMBER_DARK)
    v.box(30, 36, 8, 44, 37, 9, TIMBER_DARK)
    top = v.hip(29, 45, 25, 38, 9, mat("timber", 1.12), ov=0, rise=0.6)
    P.box_crate(v, 32, 28, 1, s=3)
    P.box_crate(v, 36, 28, 1, s=3)
    P.box_crate(v, 34, 28, 4, s=2)
    P.sacks(v, 32, 33, 1, n=3)
    for x, y in ((3, 3), (W - 4, 3), (3, 30), (W - 4, 30)):
        P.lamp_post(v, x, y, h=7)
    # The toll house on the land rows: a tiled settler-style house with its entrance on the landing.
    x0, y0, x1, y1 = 30, 55, 44, 65
    b = P.building(v, x0, y0, x1, y1, "settler", along="x", height=9, kind="tiles", seed=seed, spacing=4)
    P.entrance(b.face("y+"), 34, 2, 3, 5)
    for a in (31, 40):
        P.casement(b.face("y+"), a, 3, 2, 3, frame=TIMBER_LIGHT, sill=TIMBER_LIGHT, shutters=TIMBER_LIGHT, bars=False)
    P.casement(b.face("y-"), 36, 3, 3, 3, frame=TIMBER_LIGHT, sill=TIMBER_LIGHT, shutters=TIMBER_LIGHT, bars=False)
    # The yard: goods waiting for a cart, a bench and lamps.
    P.box_crate(v, 4, 56, 1)
    P.box_crate(v, 6, 56, 1)
    P.cask(v, 4, 59, 1)
    P.bale(v, 7, 60, 1)
    P.bench(v, 12, 53, 1, 5, along="x")
    P.lamp_post(v, 18, 53)
    P.lamp_post(v, 29, 53)
    P.handcart(v, 10, 64, 1, along="x", load=CANVAS)
    v.anchor("cart", 20.2, 56, 1)
    v.anchor("door", 24, 72, 0)
    return P.colour_jitter(v, seed=seed)

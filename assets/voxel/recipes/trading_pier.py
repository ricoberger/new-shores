"""
Trading pier (3 × 4, front 3 rows over water; D-060, Citizens): a plank
pier on piles with bollards, crates, barrels and sacks, a small cargo
crane with a hanging crate and a lantern post; on the land row a dressed
stone quay edge with mooring rings, a paved landing and a toll hut with a
tiled roof. Berth anchors `berth_1`/`berth_2` sit one and a bit voxels
off the two long flanks (x = -1.2 and W + 1.2) at the middle of the
water rows, so a ship lies alongside the pier.
"""

from nsvoxel import parts as P
from nsvoxel import detail_d060 as D
from nsvoxel.grid import mat
from nsvoxel.mats import CANVAS, IRON, STONE, STONE_DARK, TIMBER, TIMBER_DARK, TIMBER_LIGHT


def pier(v, x0, x1, y0, y1):
    """The deck at z 0 (boards in alternating shades), piles every 6 voxels and at the edges, bollards."""
    for y in range(y0, y1):
        for x in range(x0, x1):
            v.set(x, y, 0, P.shade_of(P_PLANK, 1.0 if (y // 2) % 2 else 0.9))
    for y in sorted(set(range(y0, y1, 6)) | {y1 - 1}):
        for x in sorted(set(range(x0, x1, 6)) | {x1 - 1}):
            v.box(x, y, -8, x + 1, y + 1, 0, TIMBER_DARK)
    for x, y in ((6, y0), (18, y0), (x0, 9), (x1 - 1, 9), (x0, 18), (x1 - 1, 18)):
        v.box(x, y, 1, x + 1, y + 1, 3, TIMBER_DARK)
        v.set(x, y, 3, IRON)


P_PLANK = mat("timber", 1.62)


def crane(v, x, y, top=13):
    """A small cargo crane: a post with a brace, a jib out over the water and a hanging crate."""
    v.box(x, y, 1, x + 2, y + 2, top, TIMBER)
    for k in range(3):
        v.set(x, y - 1 - k, 4 + k, TIMBER)  # brace under the jib
    for j in range(7):
        v.set(x, y - j, top, TIMBER_LIGHT)
    for z in range(top - 5, top):
        v.set(x, y - 6, z, IRON)
    P.box_crate(v, x, y - 7, top - 7)


def build(ctx):
    v = ctx.vox()  # 24 × 32
    seed = 86
    W, D_, land = ctx.W, ctx.D, ctx.land  # land from y 24
    pier(v, 4, W - 4, 1, land)
    # The quay edge of dressed stone with mooring rings facing the water, then the landing.
    for x in range(W):
        v.box(x, land, -2, x + 1, land + 2, 1, STONE_DARK if x % 4 else STONE)
    for x in (0, W - 3):
        D.mooring_ring(v, x, land - 1, -2)
    P.yard(v, 0, land + 2, W, D_, "dirt", seed=seed)
    P.path(v, [(x, y) for x in range(8, 13) for y in range(land + 2, D_)], kind="paved")
    # The berths on the two long flanks, mid-flank of the water rows, so a ship lies alongside.
    for k, x in enumerate((-1.2, W + 1.2)):
        v.anchor(f"berth_{k + 1}", x, land / 2, 0.48)
    # Goods on the pier, the crane and the lantern.
    P.box_crate(v, 6, 8, 1)
    P.box_crate(v, 6, 10, 1)
    P.box_crate(v, 7, 9, 3)
    P.cask(v, 16, 8, 1)
    P.cask(v, 18, 8, 1)
    P.sacks(v, 15, 17, 1, n=2)
    crane(v, 11, 14, 13)
    P.lamp_post(v, 5, 4, h=7)
    # The toll hut and the yard.
    x0, y0, x1, y1 = 14, 27, 22, 31
    b = P.building(v, x0, y0, x1, y1, "settler", along="x", height=8, kind="tiles", seed=seed, spacing=4)
    P.entrance(b.face("y+"), 16, 2, 3, 5)
    P.casement(b.face("y-"), 17, 3, 3, 2, frame=TIMBER_LIGHT, sill=TIMBER_LIGHT, shutters=TIMBER_LIGHT, bars=False)
    P.box_crate(v, 3, 28, 1)
    P.cask(v, 3, 30, 1)
    P.bale(v, 5, 29, 1)
    P.lamp_post(v, 7, 28)
    v.anchor("cart", 10.2, 28, 1)
    v.anchor("door", 10, 32, 0)
    P.scatter(v, 0, land + 2, W, D_, 0.015, seed=seed, kinds=("pebble", "tuft"))
    return P.colour_jitter(v, seed=seed)

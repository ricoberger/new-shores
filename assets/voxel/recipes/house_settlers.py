"""
Settler house (3 × 3, 12 voxels per tile; V7 rework after the Anno 1404
peasant houses): weathered plank or log cottages on a low stone footing
under heavy, steep thatch with a ragged eave, a stone chimney on every
variant, small shuttered windows, plank doors with a step. Three variants
that differ in massing: a long house with a gable chimney and a lean-to
hut in front; a long log house with an open-fronted thatched cart shed on
a side wing; a big low roof with a thatched dormer, a porch and a hipped
log hut. No vegetable patch (no room in the footprint); props stay tiny.
"""

from types import SimpleNamespace

from nsvoxel import parts as P
from nsvoxel.grid import hash3, mat, shade_of
from nsvoxel.mats import PLANK, STONE, STONE_DARK, STONE_LIGHT, THATCH_DARK, TIMBER, TIMBER_DARK, TIMBER_LIGHT

VARIANTS = 3
VOXELS_PER_TILE = 12

BOARDS = mat("timber", 0.95)
LOGS = mat("timber", 0.8)
PLINTH = mat("stone", 1.1)
BASE = 2  # first wall course: one pale stone band under it, flush with the walls


def stack(v, x, y, z0, z1, w=3, d=3):
    """A slender stone chimney stack w × d, courses in two shades, a corbelled cap and a pot."""
    for z in range(z0, z1):
        for dx in range(w):
            for dy in range(d):
                v.set(x + dx, y + dy, z, STONE_LIGHT if (z // 2 + dx + dy) % 2 == 0 else STONE)
    v.box(x - 1, y - 1, z1, x + w + 1, y + d + 1, z1 + 1, STONE_DARK)
    v.box(x, y, z1 + 1, x + w, y + d, z1 + 2, STONE)
    pot = mat("terracotta", 0.9)
    v.box(x + 1, y + 1, z1 + 2, x + w - 1, y + d - 1, z1 + 4, pot)


def footing(v, x0, y0, x1, y1):
    """One course of pale stone the house stands on, flush with the walls (a colour band; the wall meets the painted ground)."""
    P.plinth(v, x0, y0, x1, y1, 1, PLINTH, out=0)
    P.fill(v, x0, y0, x1, y1, 1, BASE, PLINTH)


def thatch_finish(v, r, seed, dark=THATCH_DARK, eave=True):
    """
    Thatch like the 1404 roofs: irregular darker and lighter patches baked into the courses
    and a thick ragged eave, longer and shorter tufts hanging below it (the shader's jitter
    is per voxel and cannot give the patches).
    """
    zlo = r.z
    for (x, y, z), m in list(v.cells.items()):
        if m[0] != "thatch" or z < zlo or not (r.x0 - r.ov <= x < r.x1 + r.ov and r.y0 - r.ov <= y < r.y1 + r.ov):
            continue
        h = hash3(x // 8, y // 6, z // 4, seed)
        if h < 0.2:
            v.set(x, y, z, shade_of(m, 0.78))
        elif h > 0.86:
            v.set(x, y, z, shade_of(m, 1.14))
    edge = []
    if r.along == "x":
        for x in range(r.x0 - r.ov, r.x1 + r.ov):
            edge += [(x, r.y0 - r.ov, -1, 0), (x, r.y1 + r.ov - 1, 1, 0)]
    else:
        for y in range(r.y0 - r.ov, r.y1 + r.ov):
            edge += [(r.x0 - r.ov, y, 0, -1), (r.x1 + r.ov - 1, y, 0, 1)]
    for x, y, dy, dx in edge if eave else ():
        n = 1 + int(hash3(x // 4 if dx == 0 else 0, y // 4 if dy == 0 else 0, 5, seed + 9) * 2.4)  # 1..2 voxels hanging, in tufts of four
        for i in range(1, n + 1):
            if not v.has(x, y, r.z - i):
                v.set(x, y, r.z - i, shade_of(dark, 1.0 if i % 2 else 0.88))


def plank_house(v, x0, y0, x1, y1, top, m=BOARDS, every=4):
    footing(v, x0, y0, x1, y1)
    P.boarded(v, x0, y0, x1, y1, BASE, top, m=m, batten=TIMBER, every=every)


def log_house(v, x0, y0, x1, y1, top, m=LOGS):
    footing(v, x0, y0, x1, y1)
    P.log_walls(v, x0, y0, x1, y1, BASE, top, m=m)


def small_window(f, a, z, shutters=TIMBER_LIGHT):
    P.casement(f, a, z, 2, 3, frame=None, sill=TIMBER_LIGHT, shutters=shutters, bars=False)


def door(f, a, z=BASE, **kw):
    P.entrance(f, a, z, 4, 7, leaf=TIMBER, frame=TIMBER_DARK, step=PLINTH, steps=2, **kw)


def span(x0, x1, y0, y1, z, ov, along):
    """The bounds of a roof that P.roof did not return (lean-tos, the cart shed), for thatch_finish."""
    return SimpleNamespace(x0=x0, x1=x1, y0=y0, y1=y1, z=z, ov=ov, along=along)

GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)


def build(ctx):
    v = ctx.vox()  # 36 × 36
    k = ctx.variant
    seed = 11 + k
    P.yard(v, 0, 0, 36, 36, "dirt", seed=seed)  # houses of tiers 1–2 stand on bare earth over the whole plot
    if k == 0:
        # Long plank house with the darker weathered thatch, a slim gable chimney against the
        # west wall, a lean-to hut in front.
        thatch = mat("thatch", 0.8)
        x0, y0, x1, y1 = 4, 3, 33, 20
        plank_house(v, x0, y0, x1, y1, 14)
        r = P.roof(v, x0, x1, y0, y1, 14, "thatch", along="x", rise=1.5, ov=2, gable=BOARDS, seed=seed, m=thatch)
        thatch_finish(v, r, seed)
        f = P.Face(v, "y+", y1 - 1)
        door(f, 9)
        small_window(f, 17, 7)
        small_window(f, 26, 7)
        small_window(P.Face(v, "x-", x0), 5, 7)
        small_window(P.Face(v, "y-", y0), 11, 7)
        small_window(P.Face(v, "y-", y0), 24, 7)
        # Back wall relief: posts with a tie rail, a woodpile under the eave.
        for x in range(x0 + 4, x1 - 2, 6):
            v.box(x, y0 - 1, 3, x + 1, y0, 13, TIMBER_DARK)
        for x in range(x0 + 1, x1 - 1):
            v.set(x, y0 - 1, 9, TIMBER_DARK)
        P.woodpile(v, 16, 1, 1, length=8, along="x", rows=3)
        # Chimney: a narrow hearth against the wall, a slim stack well above the ridge.
        v.box(x0 - 2, 13, 1, x0, 16, 6, PLINTH)
        v.box(x0 - 2, 13, 6, x0, 16, 11, STONE)
        stack(v, x0 - 2, 13, 11, r.ridge_z + 3, 2, 2)
        # Lean-to hut in front, thatch sloping to the front.
        hx0, hy0, hx1, hy1 = 20, 24, 33, 34
        log_house(v, hx0, hy0, hx1, hy1, 10)
        P.lean_to(v, hx0, hx1, hy0, hy1, 10, "thatch", down="y+", ov=1, m=mat("thatch", 1.1), posts=False, seed=seed)
        thatch_finish(v, span(hx0, hx1, hy0, hy1, 10, 1, "x"), seed + 4, eave=False)
        P.entrance(P.Face(v, "x-", hx0), 27, BASE, 4, 6, leaf=TIMBER, frame=TIMBER_DARK, step=PLINTH, steps=1)
        small_window(P.Face(v, "y+", hy1 - 1), 25, 5, shutters=None)
        P.woodpile(v, 4, 27, 1, length=8, along="y", rows=3)
        P.chopping_block(v, 14, 25)
    elif k == 1:
        # Long log house with fresh pale-gold thatch, a ridge chimney and an open cart shed on a wing.
        thatch = mat("thatch", 1.2)
        x0, y0, x1, y1 = 3, 3, 33, 17
        log_house(v, x0, y0, x1, y1, 14)
        r = P.roof(v, x0, x1, y0, y1, 14, "thatch", along="x", rise=1.5, ov=2, gable=TIMBER_DARK, seed=seed, m=thatch)
        thatch_finish(v, r, seed)
        f = P.Face(v, "y+", y1 - 1)
        door(f, 7)
        small_window(P.Face(v, "x-", x0), 8, 7)
        small_window(P.Face(v, "y-", y0), 14, 7)
        small_window(P.Face(v, "y-", y0), 24, 7)
        stack(v, 8, 8, 3, r.ridge_z + 3, 3, 4)
        # Cart shed to the front: half walls on a dirt floor, posts at the open front, a gabled thatch roof along y.
        sx0, sy0, sx1, sy1 = 15, 17, 34, 34
        for x in range(sx0, sx1):
            for y in range(sy0 + 2, sy1):
                if x in (sx0, sx1 - 1) or y == sy0 + 2:
                    for z in range(1, 7):
                        v.set(x, y, z, shade_of(LOGS, 1.0 if z % 2 else 1.18))
        for px, py in ((sx0, sy1 - 1), (sx1 - 1, sy1 - 1), (sx0, sy1 - 7), (sx1 - 1, sy1 - 7)):
            v.box(px, py, 1, px + 1, py + 1, 11, TIMBER_DARK)
        sr = P.roof(v, sx0, sx1, sy0, sy1, 11, "thatch", along="y", rise=1.5, ov=1, gable=TIMBER_DARK, seed=seed + 2, m=mat("thatch", 1.12))
        thatch_finish(v, sr, seed + 2)
        # Cart and straw inside the shed.
        v.box(sx0 + 4, sy1 - 7, 1, sx1 - 4, sy1 - 3, 3, PLANK)
        P.woodpile(v, 3, 27, 1, length=8, along="y", rows=3)
        P.chopping_block(v, 9, 22)
    else:
        # Big low roof with a thatched dormer and a porch; a hipped plank hut on the front-right.
        thatch = mat("thatch", 1.05)
        x0, y0, x1, y1 = 3, 3, 33, 22
        plank_house(v, x0, y0, x1, y1, 11, m=mat("timber", 0.8), every=5)
        r = P.roof(v, x0, x1, y0, y1, 11, "thatch", along="x", rise=1.7, ov=2, gable=TIMBER_DARK, seed=seed, m=thatch)
        thatch_finish(v, r, seed)
        f = P.Face(v, "y+", y1 - 1)
        small_window(f, 21, 6)
        small_window(f, 28, 6, shutters=None)
        small_window(P.Face(v, "x-", x0), 9, 6)
        small_window(P.Face(v, "y-", y0), 12, 6)
        # Door under a plank porch roof on posts.
        door(f, 9)
        for px in (7, 14):
            v.box(px, y1 + 2, 1, px + 1, y1 + 3, 10, TIMBER_DARK)
        P.lean_to(v, 7, 15, y1, y1 + 3, 10, "thatch", down="y+", ov=0, m=mat("timber", 1.3), posts=False, seed=seed)
        P.dormer_on(v, r, 19, 26, "y+", wall=TIMBER_DARK, kind="thatch", frame=TIMBER_LIGHT, course=3, h=6)
        stack(v, 8, 7, 3, r.ridge_z + 3, 3, 4)
        # Hipped plank hut front-right.
        hx0, hy0, hx1, hy1 = 19, 26, 33, 35
        plank_house(v, hx0, hy0, hx1, hy1, 10, m=mat("timber", 0.9))
        hr = P.roof(v, hx0, hx1, hy0, hy1, 10, "thatch", along="x", rise=1.6, ov=1, hip=True, seed=seed + 3, m=mat("thatch", 0.95))
        thatch_finish(v, hr, seed + 3)
        P.entrance(P.Face(v, "x-", hx0), 29, BASE, 3, 6, leaf=TIMBER, frame=TIMBER_DARK, step=PLINTH, steps=1)
        small_window(P.Face(v, "y+", hy1 - 1), 25, 5, shutters=None)
        P.woodpile(v, 4, 27, 1, length=8, along="y", rows=3)
        P.chopping_block(v, 12, 29)
    P.scatter(v, 0, 0, 36, 36, 0.03, seed=seed)
    return P.colour_jitter(v, seed=seed)

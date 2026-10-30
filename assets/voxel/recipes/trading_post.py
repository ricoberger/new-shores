"""
Trading post (6 × 6 at Anno size, D-062: one water row under the dock,
levels 1–4; D-057 §3): a plank pier on piles over that row with bollards,
rope coils and four berths, a timber cargo crane with a hanging crate
(2+), goods on the pier; a storehouse
that grows from a thatched timber-framed shed (1) to a tiled one (2) and
a coursed-stone warehouse with quoins and a hoist beam (3), and a
counting house with a jettied upper storey and a flag tower (4).
"""

from nsvoxel import parts as P
from nsvoxel.grid import mat
from nsvoxel.mats import CANVAS, DYE_BLUE, IRON, OCHRE, PLANK, STONE, STONE_DARK, TIMBER, TIMBER_DARK, TIMBER_LIGHT

FLAG = mat("dye-blue", 1.0, "flag")
#: The one water row (voxels) the dock stands over; the content allows 1–2 (D-062), the model is one.
WATER = 8


def pier(v, x0, x1, y0, y1):
    for y in range(y0, y1):
        for x in range(x0, x1):
            v.set(x, y, 0, P.shade_of(PLANK, 1.0 if (y // 2) % 2 else 0.9))
    for y in range(y0, y1, 6):
        for x in range(x0, x1, 6):
            v.box(x, y, -8, x + 1, y + 1, 0, TIMBER_DARK)
    for x in range(x0, x1, 6):
        v.box(x, y0, 1, x + 1, y0 + 1, 3, TIMBER_DARK)  # bollards at the berths
        v.set(x, y0, 3, IRON)
    for x in range(x0 + 3, x1 - 3, 12):  # rope coils
        v.box(x, y0 + 2, 1, x + 2, y0 + 4, 2, mat("canvas", 0.85))


def crane(v, x, y, top=16, jib=6):
    """A timber cargo crane: post, jib out over the water and a hanging crate."""
    v.box(x, y, 1, x + 2, y + 2, top, TIMBER)
    for k in range(3):
        v.set(x - 1 - k, y + 1, 4 + k, TIMBER)
    for j in range(jib + 1):
        v.set(x, y - j, top, TIMBER_LIGHT)
    for z in range(top - 7, top):
        v.set(x, y - jib, z, mat("iron"))
    P.box_crate(v, x, y - jib - 1, top - 9)


def build(ctx):
    v = ctx.vox()
    lv = ctx.level
    seed = 70 + lv
    W, D, land = ctx.W, ctx.D, WATER  # 48 × 48, land from y 8
    pier(v, 2 if lv >= 2 else 8, 46 if lv >= 2 else 40, 1, land)
    # Quay edge of dressed stone, then the yard.
    for x in range(W):
        v.box(x, land, -2, x + 1, land + 2, 1, STONE_DARK if x % 4 else STONE)
    P.yard(v, 0, land + 2, W, D, "dirt", seed=seed)
    P.path(v, [(x, y) for x in range(20, 28) for y in range(land + 2, D)], kind="paved")
    for k, x in enumerate((24 - 6, 24 + 6, 24 - 18, 24 + 18)):
        v.anchor(f"berth_{k + 1}", x, 1.2, 0.48)
    # Goods on the pier.
    P.box_crate(v, 10, 3, 1)
    P.box_crate(v, 10, 5, 1)
    P.box_crate(v, 11, 4, 3)
    P.cask(v, 34, 3, 1)
    P.cask(v, 36, 3, 1)
    P.sacks(v, 29, 4, 1, n=2)
    if lv >= 2:
        crane(v, 22, 6, 16 if lv < 4 else 20)
    # Storehouse on the land.
    if lv == 1:
        x0, y0, x1, y1 = 6, 22, 26, 36
        b = P.building(v, x0, y0, x1, y1, "settler", along="x", seed=seed, spacing=5, braces=("x-", "x+"))
        P.barn_gate(b.face("y-"), 13, 2, 5, 6)
        P.entrance(b.face("y+"), 14, 2, 3, 5)
        for a in (8, 21):
            P.casement(b.face("y+"), a, 5, 2, 2, frame=None, sill=TIMBER_LIGHT, shutters=TIMBER_LIGHT, bars=False)
    else:
        big = lv >= 3
        x0, y0, x1, y1 = (4, 20, 34, 40) if big else (6, 22, 30, 38)
        zt = 14 if big else 10
        b = P.building(v, x0, y0, x1, y1, "stone" if big else "settler", along="x", height=zt, kind="tiles", seed=seed, spacing=5, braces=("x-", "x+"))
        top = b.roof.ridge_z + 1
        P.barn_gate(b.face("y-"), (x0 + x1) // 2 - 3, 2, 6, 8 if big else 6)
        P.entrance(b.face("y+"), (x0 + x1) // 2 - 1, 2, 3, 5)
        for a in range(x0 + 3, x1 - 3, 6):
            if abs(a - (x0 + x1) // 2) > 4:
                if big:
                    P.casement(b.face("y+"), a, zt - 6, 2, 3, frame=P.DRESSED, sill=P.DRESSED, lintel=P.DRESSED)
                else:
                    P.casement(b.face("y+"), a, zt - 5, 2, 2, frame=None, sill=TIMBER_LIGHT, shutters=TIMBER_LIGHT, bars=False)
        # Hoist beam in the gable.
        v.box((x0 + x1) // 2, y0 - 3, top - 4, (x0 + x1) // 2 + 1, y0, top - 3, TIMBER)
        v.box((x0 + x1) // 2, y0 - 3, top - 8, (x0 + x1) // 2 + 1, y0 - 2, top - 4, IRON)
    if lv == 4:
        # Counting house with a flag tower on the east side.
        cx0, cy0, cx1, cy1 = 36, 24, 46, 38
        P.plinth(v, cx0, cy0, cx1, cy1, 1, STONE_DARK, out=1)
        P.coursed_stone(v, cx0, cy0, cx1, cy1, 1, 8, STONE, seed)
        P.dressed_quoins(v, cx0, cy0, cx1, cy1, 2, 8)
        P.jetty_course(v, cx0, cy0, cx1, cy1, 8)
        P.half_timber(v, cx0 - 1, cy0 - 1, cx1 + 1, cy1 + 1, 9, 15, OCHRE, TIMBER, spacing=4, braces=False, sill=False)
        P.fill(v, cx0, cy0, cx0 + 5, cy0 + 5, 15, 22, OCHRE)
        P.half_timber(v, cx0, cy0, cx0 + 5, cy0 + 5, 15, 22, OCHRE, TIMBER, spacing=4, braces=False)
        P.roof(v, cx0, cx0 + 5, cy0, cy0 + 5, 22, "tiles", hip=True, rise=2, seed=seed)
        P.roof(v, cx0 - 1, cx1 + 1, cy0 + 4, cy1 + 1, 15, "tiles", along="y", gable=OCHRE, seed=seed)
        v.box(cx0 + 2, cy0 + 2, 25, cx0 + 3, cy0 + 3, 33, TIMBER_DARK)
        for i in range(5):
            for z in (31, 32):
                v.set(cx0 + 3 + i, cy0 + 2, z, FLAG)
        F = P.Face(v, "y+", cy1)
        P.casement(F, 38, 10, 3, 3, frame=TIMBER_LIGHT, sill=TIMBER_LIGHT, shutters=DYE_BLUE)
        P.casement(F, 43, 10, 2, 3, frame=TIMBER_LIGHT, sill=TIMBER_LIGHT, shutters=DYE_BLUE)
        P.entrance(P.Face(v, "y+", cy1 - 1), 41, 2, 3, 5, leaf=DYE_BLUE, frame=P.DRESSED, lintel=P.DRESSED)
        v.anchor("status", cx0, cy0, 36)
    else:
        P.box_crate(v, 38, 26, 1)
        P.box_crate(v, 40, 26, 1)
        P.cask(v, 38, 30, 1)
        P.bale(v, 40, 32, 1)
        P.handcart(v, 38, 36, 1, along="x", load=CANVAS)
    P.lamp_post(v, 19, 43)
    P.lamp_post(v, 28, 43)
    v.anchor("cart", 35.2, 44, 1)
    v.anchor("door", 24, 48, 0)
    v.anchors.pop("status", None)
    P.scatter(v, 0, land + 2, W, D, 0.015, seed=seed, kinds=("pebble", "tuft"))
    return P.colour_jitter(v, seed=seed)

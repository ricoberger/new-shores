"""Trading post (6 × 9, back 3 rows over water, levels 1–4): plank pier with bollards and four berths, cargo crane, a storehouse that grows from a shed (1) to a stone warehouse (3) and a counting house with a flag tower (4)."""

from nsvoxel import parts as P
from nsvoxel.grid import mat
from nsvoxel.mats import BRASS, CANVAS, DYE_BLUE, PLANK, PLASTER, STONE, STONE_DARK, TERRACOTTA, TERRACOTTA_DARK, THATCH, THATCH_DARK, TIMBER, TIMBER_DARK, TIMBER_LIGHT, OCHRE

FLAG = mat("dye-blue", 1.0, "flag")


def pier(v, x0, x1, y0, y1):
    for y in range(y0, y1):
        for x in range(x0, x1):
            v.set(x, y, 0, P.shade_of(PLANK, 1.0 if (y // 2) % 2 else 0.9))
    for y in range(y0, y1, 6):
        for x in range(x0, x1, 6):
            v.box(x, y, -8, x + 1, y + 1, 0, TIMBER_DARK)
    for x in range(x0, x1, 6):
        v.box(x, y0, 1, x + 1, y0 + 1, 3, TIMBER_DARK)  # bollards at the berths


def crane(v, x, y, top=16):
    """A timber cargo crane: post, jib out over the water and a hanging crate."""
    v.box(x, y, 1, x + 2, y + 2, top, TIMBER)
    for k in range(3):
        v.set(x - 1 - k, y + 1, 4 + k, TIMBER)
    for j in range(9):
        v.set(x, y - j, top, TIMBER_LIGHT)
    for z in range(top - 7, top):
        v.set(x, y - 8, z, mat("iron"))
    P.crate(v, x, y - 9, top - 9)


def build(ctx):
    v = ctx.vox()
    lv = ctx.level
    seed = 70 + lv
    W, D, land = ctx.W, ctx.D, ctx.land  # 48 × 72, land from y 24
    pier(v, 2 if lv >= 2 else 8, 46 if lv >= 2 else 40, 1, land)
    # Quay edge of dressed stone, then the yard.
    for x in range(W):
        v.box(x, land, -2, x + 1, land + 2, 1, STONE_DARK if x % 4 else STONE)
    P.yard(v, 0, land + 2, W, D, "dirt", seed=seed)
    P.path(v, [(x, y) for x in range(20, 28) for y in range(land + 2, D)], kind="paved")
    for k, x in enumerate((24 - 6, 24 + 6, 24 - 18, 24 + 18)):
        v.anchor(f"berth_{k + 1}", x, 1.2, 0.48)
    # Goods on the pier.
    P.crate(v, 10, 8, 1)
    P.crate(v, 10, 10, 1)
    P.crate(v, 11, 9, 3)
    P.barrel(v, 34, 12, 1)
    P.barrel(v, 36, 12, 1)
    P.sack(v, 30, 16, 1)
    if lv >= 2:
        crane(v, 22, 14, 16 if lv < 4 else 20)
    # Storehouse on the land.
    if lv == 1:
        x0, y0, x1, y1 = 6, 32, 26, 46
        v.box(x0, y0, 1, x1, y1, 2, STONE_DARK)
        P.timber_frame(v, x0, y0, x1, y1, 2, 9, PLASTER, TIMBER, spacing=5, braces=False, sill=False)
        v.gable(x0, x1, y0, y1, 9, THATCH, PLASTER, along="x", rise=1.5, ov=1, ridge=THATCH_DARK, seed=seed)
        P.gate(P.Face(v, "y-", y0), 13, 2, 5, 6)
        P.door(P.Face(v, "y+", y1 - 1), 14, 2, 3, 5)
    else:
        big = lv >= 3
        x0, y0, x1, y1 = (4, 30, 34, 50) if big else (6, 32, 30, 48)
        zt = 14 if big else 10
        if big:
            P.stone_wall(v, x0, y0, x1, y1, 1, zt, STONE, seed)
            P.quoins(v, x0, y0, x1, y1, 1, zt)
        else:
            v.box(x0, y0, 1, x1, y1, 2, STONE_DARK)
            P.timber_frame(v, x0, y0, x1, y1, 2, zt, PLASTER, TIMBER, spacing=5, braces=False, sill=False)
        top = v.gable(x0, x1, y0, y1, zt, TERRACOTTA, STONE if big else PLASTER, along="x", rise=1, ov=1, ridge=TERRACOTTA_DARK, seed=seed)
        P.gate(P.Face(v, "y-", y0), (x0 + x1) // 2 - 3, 1, 6, 8 if big else 6)
        P.door(P.Face(v, "y+", y1 - 1), (x0 + x1) // 2 - 1, 1, 3, 5)
        for a in range(x0 + 3, x1 - 3, 6):
            if abs(a - (x0 + x1) // 2) > 4:
                P.window(P.Face(v, "y+", y1 - 1), a, zt - 6, 2, 3, frame=TIMBER_LIGHT)
        # Hoist beam in the gable.
        v.box((x0 + x1) // 2, y0 - 3, top - 4, (x0 + x1) // 2 + 1, y0, top - 3, TIMBER)
    if lv == 4:
        # Counting house with a flag tower on the east side.
        cx0, cy0, cx1, cy1 = 36, 32, 46, 46
        P.stone_wall(v, cx0, cy0, cx1, cy1, 1, 8, STONE, seed)
        P.timber_frame(v, cx0, cy0, cx1, cy1, 8, 15, OCHRE, TIMBER, spacing=4, braces=False)
        v.box(cx0, cy0, 15, cx0 + 5, cy0 + 5, 22, OCHRE)
        v.hip(cx0, cx0 + 5, cy0, cy0 + 5, 22, TERRACOTTA, ov=1, rise=2)
        v.gable(cx0, cx1, cy0 + 5, cy1, 15, TERRACOTTA, OCHRE, along="y", rise=1, ov=1, seed=seed)
        v.box(cx0 + 2, cy0 + 2, 25, cx0 + 3, cy0 + 3, 33, TIMBER_DARK)
        for i in range(5):
            for z in (31, 32):
                v.set(cx0 + 3 + i, cy0 + 2, z, FLAG)
        P.window(P.Face(v, "y+", cy1 - 1), 39, 10, 3, 3, cross=True, shutters=DYE_BLUE)
        P.door(P.Face(v, "y+", cy1 - 1), 41, 1, 3, 5, leaf=DYE_BLUE)
        v.anchor("status", cx0, cy0, 36)
    else:
        P.crate(v, 38, 36, 1)
        P.crate(v, 40, 36, 1)
        P.barrel(v, 38, 40, 1)
        P.hay(v, 40, 42, 1)
    P.lantern(v, 19, 63, 1)
    P.lantern(v, 28, 63, 1)
    v.anchor("cart", 35.2, 68, 1)
    v.anchor("door", 24, 72, 0)
    v.anchors.pop("status", None)
    return v.jitter(0.03, roles={"plaster", "ochre", "stone"}, cell=2, seed=seed)

"""Market place (5 × 6, levels 1–3): paved square, striped stalls round a well; level 2 adds a timber market hall, level 3 a stone hall with a bell turret."""

from nsvoxel import parts as P
from nsvoxel.grid import mat
from nsvoxel.mats import CANVAS, OCHRE, PLASTER, STONE, STONE_DARK, TERRACOTTA, TERRACOTTA_DARK, TIMBER, TIMBER_DARK, TIMBER_LIGHT, BRASS, WHEAT, APPLE, DYE_BLUE

STRIPES = (mat("dye-blue"), mat("terracotta"), mat("ochre"), mat("hemp-mark", 1.2))
GOODS = (WHEAT, APPLE, mat("orchard"), mat("canvas", 0.9), mat("timber", 1.4))


def stall(v, x, y, k, face="y+"):
    """A 6 × 4 stall: counter with goods, four posts, a striped canvas roof sloping to the front."""
    stripe = STRIPES[k % len(STRIPES)]
    v.box(x, y + 2, 1, x + 6, y + 4, 3, TIMBER_LIGHT)
    for i in range(6):
        v.set(x + i, y + 2 + (i % 2), 3, GOODS[(k + i) % len(GOODS)])
    for px, py in ((x, y), (x + 5, y), (x, y + 3), (x + 5, y + 3)):
        v.box(px, py, 1, px + 1, py + 1, 6, TIMBER)
    for j in range(5):
        for i in range(-1, 7):
            v.set(x + i, y - 1 + j, 7 - j // 2, stripe if (i // 2) % 2 == 0 else CANVAS)
    P.crate(v, x + 1, y, 1)


def well(v, cx, cy):
    v.walls(cx - 2, cy - 2, cx + 3, cy + 3, 1, 3, STONE)
    v.box(cx - 1, cy - 1, 1, cx + 2, cy + 2, 2, mat("deep"))
    for px, py in ((cx - 2, cy), (cx + 2, cy)):
        v.box(px, py, 3, px + 1, py + 1, 8, TIMBER)
    v.box(cx - 3, cy - 1, 8, cx + 4, cy + 2, 9, TERRACOTTA)
    v.box(cx - 2, cy, 9, cx + 3, cy + 1, 10, TERRACOTTA_DARK)
    v.set(cx, cy, 6, BRASS)


def build(ctx):
    v = ctx.vox()
    lv = ctx.level
    seed = 50 + lv
    W, D = ctx.W, ctx.D  # 40 × 48
    P.yard(v, 0, 0, W, D, "paved", seed=seed)
    # A low kerb of darker stone round the square.
    for x in range(W):
        for y in (0, D - 1):
            v.set(x, y, 0, STONE_DARK)
    for y in range(D):
        for x in (0, W - 1):
            v.set(x, y, 0, STONE_DARK)
    well(v, 20, 28)
    k = 0
    for x in (3, 31):
        for y in (22, 30, 38):
            stall(v, x, y, k)
            k += 1
    for x in (12, 23):
        stall(v, x, 39, k)
        k += 1
    # Benches and trees at the corners.
    P.tree(v, 3, 44, 1, "broad", seed)
    P.tree(v, 36, 44, 1, "broad", seed + 1)
    v.box(14, 33, 1, 18, 34, 2, TIMBER_LIGHT)
    v.box(23, 33, 1, 27, 34, 2, TIMBER_LIGHT)
    if lv == 1:
        for x in (6, 16, 26):
            stall(v, x, 6, k)
            k += 1
        P.barrel(v, 34, 8, 1)
        P.barrel(v, 36, 10, 1)
        P.sack(v, 34, 12, 1)
        P.hay(v, 3, 12, 1)
        return v
    # Market hall across the back: open arcade below, hall above.
    x0, y0, x1, y1 = 4, 3, 36, 17
    wall = PLASTER if lv == 2 else OCHRE
    for x in range(x0, x1, 4):
        for y in (y0, y1 - 1):
            v.box(x, y, 1, x + 2 if lv == 3 else x + 1, y + 1, 8, STONE if lv == 3 else TIMBER)
    v.box(x0, y0, 1, x1, y1, 1, None)
    v.box(x0, y0, 8, x1, y1, 9, TIMBER_DARK)
    if lv == 2:
        P.timber_frame(v, x0, y0, x1, y1, 9, 15, wall, TIMBER, spacing=4, braces=False)
    else:
        P.stone_wall(v, x0, y0, x1, y1, 9, 16, mat("ochre", 1.0), seed)
        P.quoins(v, x0, y0, x1, y1, 9, 16)
    zt = 15 if lv == 2 else 16
    F = P.Face(v, "y+", y1 - 1)
    for a in range(x0 + 3, x1 - 3, 6):
        P.window(F, a, zt - 5, 2, 3, frame=TIMBER_LIGHT, shutters=DYE_BLUE if lv == 3 else None)
    top = v.gable(x0, x1, y0, y1, zt, TERRACOTTA, wall, along="x", rise=1, ov=1, ridge=TERRACOTTA_DARK, seed=seed)
    for x in range(x0 + 2, x1 - 2, 6):
        stall(v, x, y0 + 5, k)
        k += 1
    if lv == 3:
        # Bell turret on the ridge.
        tx, ty = 18, 8
        v.box(tx, ty, top - 2, tx + 4, ty + 4, top + 5, STONE)
        v.box(tx + 1, ty, top + 1, tx + 3, ty + 4, top + 4, None)
        v.box(tx + 1, ty + 1, top + 2, tx + 3, ty + 3, top + 4, BRASS)
        v.hip(tx, tx + 4, ty, ty + 4, top + 5, TERRACOTTA, ov=1)
    return v.jitter(0.03, roles={"plaster", "ochre"}, cell=2, seed=seed)

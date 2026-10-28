"""Warehouse (6 × 6, levels 1–3): a timber store (1) that grows a stone ground floor and loft hoist (2) and a second hall with a yard crane (3); crates, sacks and barrels in the yard."""

from nsvoxel import parts as P
from nsvoxel.mats import PLASTER, STONE, TERRACOTTA, THATCH, TIMBER, TIMBER_DARK, TIMBER_LIGHT, CANVAS


def build(ctx):
    v = ctx.vox()  # 48 × 48
    lv = ctx.level
    seed = 60 + lv
    P.yard(v, 0, 0, 48, 48, "dirt", seed=seed)
    P.path(v, [(x, y) for x in range(20, 28) for y in range(30, 48)], kind="paved")
    style = "settler" if lv == 1 else "stone"
    x0, y0, x1, y1 = 6, 6, 42, 26
    top = P.house(v, x0, y0, x1, y1, style, along="x", height=10 if lv == 1 else 13, seed=seed, roof=THATCH if lv == 1 else TERRACOTTA)
    f = P.Face(v, "y+", y1 - 1)
    P.gate(f, 21, 1, 6, 7)
    P.windows(v, "y+", y1 - 1, x0 + 3, x1 - 3, 5 if lv == 1 else 7, every=7, skip=(21, 24))
    if lv >= 2:
        # Loft door with a hoist beam over the gate.
        P.door(f, 22, 9, 4, 3, step=None)
        v.box(23, y1, top - 6, 25, y1 + 3, top - 5, TIMBER_DARK)
    if lv == 3:
        P.house(v, 4, 30, 18, 44, "citizen", along="y", wall=PLASTER, seed=seed)
        P.gate(P.Face(v, "x+", 17), 34, 1, 5, 6)
        # Yard crane.
        v.box(36, 34, 1, 38, 36, 16, TIMBER)
        for j in range(8):
            v.set(37 - j, 35, 16, TIMBER_LIGHT)
        for z in range(10, 16):
            v.set(30, 35, z, P.mat("iron"))
        P.crate(v, 29, 34, 8)
    # Goods.
    n = 3 + 3 * lv
    spots = [(28, 30), (31, 30), (28, 33), (34, 30), (31, 33), (40, 30), (40, 34), (6, 30), (9, 30), (6, 34), (40, 38), (34, 40)]
    for k, (x, y) in enumerate(spots[:n]):
        if lv == 3 and x < 18:
            continue
        if k % 3 == 0:
            P.barrel(v, x, y, 1)
        elif k % 3 == 1:
            P.crate(v, x, y, 1, s=3)
        else:
            P.sack(v, x, y, 1, m=CANVAS)
    v.anchor("cart", 34, 44, 1)
    return v.jitter(0.03, roles={"plaster", "stone"}, cell=2, seed=seed)



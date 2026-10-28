"""
Warehouse (6 × 6, levels 1–3; D-057 §3): a timber-framed, thatched store
with a wide two-leaf gate (1) that becomes a coursed-stone hall with
dressed quoins, tiles and a loft door with a hoist (2) and gains a
second, jettied hall and a yard crane (3); crates, sacks, barrels and a
hand cart in the yard; level 3 adds a striped awning over the hall's
front and a flag on the second hall (cloth, they sway).
"""

from nsvoxel import parts as P
from nsvoxel.mats import CANVAS, PLASTER, TIMBER, TIMBER_DARK, TIMBER_LIGHT

AWNING_A = P.cloth(CANVAS, "cloth")
AWNING_B = P.cloth(P.mat("dye-blue", 1.1), "cloth")
FLAG = P.mat("dye-blue", 1.0, "flag")


def build(ctx):
    v = ctx.vox()  # 48 × 48
    lv = ctx.level
    seed = 60 + lv
    P.yard(v, 0, 0, 48, 48, "dirt", seed=seed)
    P.path(v, [(x, y) for x in range(20, 28) for y in range(30, 48)], kind="paved")
    x0, y0, x1, y1 = 6, 6, 42, 26
    if lv == 1:
        b = P.building(v, x0, y0, x1, y1, "settler", along="x", height=11, seed=seed, spacing=6, braces=("x-", "x+"))
    else:
        b = P.building(v, x0, y0, x1, y1, "stone", along="x", height=13, kind="tiles", seed=seed)
    top = b.roof.ridge_z + 1
    f = b.face("y+")
    P.barn_gate(f, 21, 2, 6, 7)
    for a in range(x0 + 3, x1 - 3, 7):
        if not 17 <= a <= 28:
            if lv == 1:
                P.casement(f, a, 5, 2, 2, frame=None, sill=TIMBER_LIGHT, shutters=TIMBER_LIGHT, bars=False)
            else:
                P.casement(f, a, 6, 2, 3, frame=P.DRESSED, sill=P.DRESSED, lintel=P.DRESSED)
    if lv >= 2:
        # Loft door with a hoist beam over the gate.
        P.entrance(f, 22, 10, 4, 3, step=None, hinges=False)
        v.box(23, y1, top - 6, 25, y1 + 3, top - 5, TIMBER_DARK)
        v.box(24, y1 + 2, top - 10, 25, y1 + 3, top - 6, P.mat("iron"))
    if lv == 3:
        h = P.building(v, 4, 30, 18, 44, "citizen", along="y", upper=PLASTER, seed=seed, jetty=True)
        P.barn_gate(h.face("x+"), 34, 2, 5, 6)
        # Yard crane.
        v.box(36, 34, 1, 38, 36, 16, TIMBER)
        for k in range(3):
            v.set(35 - k, 35, 3 + k, TIMBER)
        for j in range(8):
            v.set(37 - j, 35, 16, TIMBER_LIGHT)
        for z in range(10, 16):
            v.set(30, 35, z, P.mat("iron"))
        P.box_crate(v, 29, 34, 8)
        # Striped awning over the front of the stone hall, a flag on the second hall's ridge.
        for x in (8, 16):
            v.box(x, 29, 1, x + 1, 30, 8, TIMBER)
        for x in range(8, 17):
            m = AWNING_A if (x // 2) % 2 == 0 else AWNING_B
            for y in range(y1, 30):
                v.set(x, y, 9 if y < 28 else 8, m)
        px, py, pz = 11, 43, h.roof.ridge_z + 1
        v.box(px, py, pz, px + 1, py + 1, pz + 8, TIMBER_DARK)
        for i in range(5):
            for z in (pz + 5, pz + 6):
                v.set(px + 1 + i, py, z, FLAG)
    # Goods.
    n = 3 + 3 * lv
    spots = [(28, 30), (31, 30), (28, 33), (34, 30), (31, 33), (40, 30), (40, 34), (6, 30), (9, 30), (6, 34), (40, 38), (34, 40)]
    for k, (x, y) in enumerate(spots[:n]):
        if lv == 3 and x < 18:
            continue
        if k % 3 == 0:
            P.cask(v, x, y, 1)
        elif k % 3 == 1:
            P.box_crate(v, x, y, 1, s=3)
        else:
            P.sacks(v, x, y, 1, n=1, m=CANVAS)
    P.handcart(v, 28, 40, 1, along="x", load=CANVAS)
    v.anchor("cart", 34, 44, 1)
    P.scatter(v, 0, 0, 48, 48, 0.015, seed=seed, kinds=("pebble", "tuft"))
    return P.colour_jitter(v, seed=seed)



"""
Gold mine (3 × 8, on the archipelago's one gold deposit; D-057 §3, V5):
a rock hill with a timbered adit trimmed in brass, a sluice run — a
plank flume on trestles carrying water down from the hill with riffles
and gold glints, into a settling tub — and a guarded strongroom of
dressed ashlar with an iron-banded door, barred windows and a brass
finial, behind a paling with a sentry box, a lantern and a pennant (a
flag that sways); a chest of nuggets, gold-flecked spoil and a cart.
"""

from nsvoxel import detail_v5 as Q
from nsvoxel import parts as P
from nsvoxel.grid import hash3, mat
from nsvoxel.mats import BRASS, IRON, MOSS, PLANK, ROCK, ROCK_DEEP, ROCK_LIGHT, TIMBER, TIMBER_DARK, TIMBER_LIGHT

SEA = mat("shallows")
FLAG = mat("dye-blue", 1.0, "flag")
ROOF = mat("terracotta", 0.78)


def build(ctx):
    v = ctx.vox()  # 24 × 64
    seed = 91
    P.yard(v, 0, 0, 24, 64, "dirt", seed=seed)
    # The hill.
    for x in range(24):
        for y in range(0, 24):
            h = int(15 - abs(x - 12) * 0.45 - max(0, y - 10) * 0.9 + hash3(x // 3, y // 3, 0, seed) * 2)
            for z in range(max(1, h)):
                m = MOSS if z == h - 1 and h > 11 else (ROCK_LIGHT if z == h - 1 else (ROCK if (z // 3) % 2 else ROCK_DEEP))
                if (z + x // 5) % 7 == 3 and z < h - 1:
                    m = Q.GOLD  # a thin gold-bearing seam
                v.set(x, y, z, m)
    # Adit with timber frame and a brass lamp.
    v.box(14, 14, 1, 20, 24, 7, None)
    v.box(14, 14, 1, 20, 18, 7, IRON)
    for x in (13, 20):
        v.box(x, 22, 1, x + 1, 24, 8, TIMBER)
    v.box(13, 22, 8, 21, 24, 9, TIMBER_DARK)
    v.set(16, 24, 8, BRASS)
    v.set(17, 24, 8, BRASS)
    # Sluice: a flume on trestles from the hillside down toward the yard.
    for y in range(14, 44):
        z = 9 - (y - 14) // 5
        v.set(4, y, z, PLANK)
        v.set(8, y, z, PLANK)
        v.box(5, y, z - 1, 8, y + 1, z, TIMBER_LIGHT)
        v.box(5, y, z, 8, y + 1, z + 1, SEA if y % 4 else TIMBER_DARK)  # water over riffles
        if y % 6 == 2:
            v.box(4, y, 1, 5, y + 1, z, TIMBER)
            v.box(8, y, 1, 9, y + 1, z, TIMBER)
        if y % 4 == 1:
            v.set(6, y, z, Q.GOLD)
    P.cask(v, 4, 44, 1, h=4, lid=SEA)  # settling tub
    P.cask(v, 7, 45, 1, h=3)
    # Strongroom: dressed ashlar, iron door, barred windows, brass finial.
    x0, y0, x1, y1 = 12, 32, 22, 44
    P.plinth(v, x0, y0, x1, y1, 1, mat("stone", 0.84), out=1)
    Q.ashlar(v, x0, y0, x1, y1, 1, 11)
    Q.cornice(v, x0, y0, x1, y1, 11)
    r = P.roof(v, x0, x1, y0, y1, 12, "tiles", hip=True, m=ROOF, seed=seed, eaves=False)
    Q.finial(v, 17, 38, r.top, BRASS, h=2)
    f = P.Face(v, "y+", y1 - 1)
    P.entrance(f, 15, 2, 3, 6, leaf=IRON, frame=Q.DRESSED, lintel=Q.DRESSED, knob=BRASS)
    for side, a in (("x-", 36), ("x+", 36), ("x-", 40)):
        ff = P.Face(v, side, x0 if side == "x-" else x1 - 1)
        P.casement(ff, a, 6, 2, 3, frame=Q.DRESSED, sill=Q.DRESSED, bars=False)
        Q.grille(ff, a, 6, 2, 3)
    # Paling round the strongroom yard with a sentry box and a pennant.
    P.fence_ring(v, 10, 30, 24, 52, kind="picket", gaps={(x, 51) for x in range(15, 19)}, seed=seed)
    v.box(19, 46, 1, 22, 49, 8, TIMBER)
    v.box(19, 48, 2, 22, 49, 6, None)
    v.box(20, 47, 2, 21, 48, 6, TIMBER_DARK)
    v.box(18, 45, 8, 23, 50, 9, ROOF)
    v.box(12, 46, 1, 13, 47, 16, TIMBER_DARK)
    for k in range(5):
        for z in range(13, 16 - (1 if k > 2 else 0)):
            v.set(13 + k, 46, z, FLAG)
    v.set(12, 46, 16, BRASS)
    P.lamp_post(v, 14, 49, h=6)
    # A chest of nuggets, gold-flecked spoil, a cart.
    v.box(13, 46, 1, 16, 48, 3, TIMBER_DARK)
    v.box(13, 46, 3, 16, 48, 4, Q.GOLD)
    Q.heap(v, 4, 54, 3.5, 3.0, 2.5, lambda x, y, z: Q.GOLD if (x + y + z) % 5 == 0 else ROCK_LIGHT)
    P.handcart(v, 3, 59, 1, along="x", load=ROCK_LIGHT)
    v.anchor("cart", 17, 60, 1)
    P.scatter(v, 0, 24, 10, 64, 0.02, seed=seed, kinds=("pebble", "tuft"))
    return P.colour_jitter(v, seed=seed)

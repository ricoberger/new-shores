"""
Fire station (4 × 5, D-062; D-060, Merchants, civic): a coursed-stone ground
floor with two wide arched gates and red doors under a jettied
half-timber upper floor and a terracotta roof, a small open bell turret
on the ridge, a ladder and hose rack on the west wall, leather buckets
hanging from the upper floor, a row of water barrels and a red hand
pump cart in the yard. No smoke anchor.
"""

from nsvoxel import parts as P
from nsvoxel import detail_d060 as D
from nsvoxel.grid import Vox, mat, shade_of
from nsvoxel.mats import BRASS, IRON, OCHRE, PLANK, STONE, TERRACOTTA, TERRACOTTA_DARK, TIMBER, TIMBER_DARK, TIMBER_LIGHT, DYE_BLUE

RED_DOOR = mat("terracotta", 1.12)
LEATHER = mat("timber", 0.72)
HOSE = mat("ochre", 0.72)
WATER = mat("dye-blue", 1.25)


def bucket(f, a, z):
    """A leather bucket (2 × 2) hung on an iron hook from a peg: rim, body, bail."""
    f.put(a, z + 3, IRON, out=1)
    f.put(a + 1, z + 3, IRON, out=1)
    f.put(a, z + 2, IRON, out=2)
    for i in range(2):
        f.put(a + i, z, LEATHER, out=1)
        f.put(a + i, z + 1, TIMBER, out=1)
        f.put(a + i, z + 1, TIMBER, out=2)
        f.put(a + i, z, LEATHER, out=2)


def hose_coil(f, ca, cz, r=3.0):
    """A coiled hose on the wall: a flat ring in the wall plane round an iron hub."""
    n = int(r + 1)
    for i in range(-n, n + 1):
        for j in range(-n, n + 1):
            d = (i * i + j * j) ** 0.5
            if d <= r and d >= r - 1.6:
                f.put(ca + i, cz + j, HOSE if (i + j) % 2 == 0 else shade_of(HOSE, 0.88), out=1)
            elif d < 1.0:
                f.put(ca + i, cz + j, IRON, out=1)


def ladder_rack(f, a0, a1, z):
    """A ladder lying on iron brackets along a wall: two rails, rungs every other voxel."""
    for a in range(a0, a1):
        f.put(a, z, TIMBER_LIGHT, out=2)
        f.put(a, z + 3, TIMBER_LIGHT, out=2)
        if (a - a0) % 2 == 0:
            f.put(a, z + 1, TIMBER, out=2)
            f.put(a, z + 2, TIMBER, out=2)
    for a in (a0 + 1, (a0 + a1) // 2, a1 - 2):
        for zz in range(z, z + 4):
            f.put(a, zz, IRON, out=1)


def pump_cart(v, x, y, z=1):
    """The hand cart of the library painted red, with a water tank, an iron pump and a lever."""
    t = Vox(v.w, v.d)
    P.handcart(t, x, y, z, along="x")
    paint = {PLANK: shade_of(TERRACOTTA, 1.1), TIMBER: TERRACOTTA}
    for k, m in t.cells.items():
        v.set(*k, paint.get(m, m))
    P.cask(v, x, y, z + 2, h=3, m=TIMBER_LIGHT, lid=WATER)
    v.box(x + 3, y + 1, z + 2, x + 4, y + 2, z + 6, IRON)
    v.box(x + 1, y + 1, z + 6, x + 5, y + 2, z + 7, TIMBER_DARK)  # the pumping lever
    v.set(x + 5, y + 1, z + 5, BRASS)  # nozzle


def build(ctx):
    v = ctx.vox()  # 32 × 40
    seed = 84
    P.yard(v, 0, 0, 32, 40, "grass", seed=seed)
    P.yard(v, 4, 27, 32, 40, "paved", seed=seed)
    x0, y0, x1, y1 = 4, 8, 30, 26
    b = P.building(v, x0, y0, x1, y1, "citizen", along="x", height=16, kind="tiles", rise=0.6, seed=seed, upper=OCHRE)
    f = b.face("y+")
    for a in (8, 18):
        P.entrance(f, a, 2, 6, 6, leaf=RED_DOOR, frame=P.DRESSED, step=None, arch=True, hinges=False, knob=IRON)
    fu = b.face("y+", upper=True)
    for a in (9, 15, 23):
        P.casement(fu, a, 10, 2, 3, frame=TIMBER_LIGHT, sill=TIMBER_LIGHT, shutters=TERRACOTTA)
    for a in (12, 19):
        bucket(fu, a, 10)
    wu = b.face("x-", upper=True)
    for a in (11, 20):
        P.casement(wu, a, 10, 2, 3, frame=TIMBER_LIGHT, sill=TIMBER_LIGHT, shutters=TERRACOTTA)
    bucket(wu, 15, 10)
    wf = b.face("x-")
    hose_coil(wf, 12, 5, 3.0)
    ladder_rack(wf, 17, 24, 3)
    for a in (12, 19):
        P.casement(P.Face(v, "x+", x1 - 1), a, 4, 2, 3, frame=P.DRESSED, sill=P.DRESSED)
    # The bell turret on the ridge: a roof-coloured base block under it, then the open turret.
    r = b.roof
    cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
    base = r.top
    for x in range(cx - 3, cx + 3):
        for y in range(cy - 3, cy + 3):
            for z in range(r.surface(x, y) + 1, base):
                v.set(x, y, z, TERRACOTTA_DARK)
    D.bell_turret(v, cx, cy, base, size=4, h=5)
    # Yard: the water barrel row, the red pump cart, a lamp between the gates.
    for k, y in enumerate((28, 31, 34, 37)):
        P.cask(v, 1, y, 1, h=4, m=TIMBER_LIGHT, lid=WATER)
    pump_cart(v, 19, 33, 1)
    P.lamp_post(v, 15, 29)
    P.lamp_post(v, 29, 29)
    P.scatter(v, 0, 0, 32, 40, 0.02, seed=seed, kinds=("pebble", "tuft"))
    v.anchor("door", 16, 32, 0)
    return P.colour_jitter(v, seed=seed)

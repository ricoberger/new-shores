"""
Thread spinner (3 × 4; D-057 §3, V5): a low workshop of ashlar with a
tiled roof whose whole east side opens under a lean-to on posts — two
spinning wheels and racks of spools of fine thread inside — skeins
hanging on a pole (rigid), baskets of flax, a bench and a cart.
"""

from nsvoxel import detail_v5 as Q
from nsvoxel import parts as P
from nsvoxel.grid import mat
from nsvoxel.mats import CANVAS, HEMP, TIMBER, TIMBER_LIGHT

ROOF = mat("terracotta", 1.1)
THREADS = (mat("canvas", 1.05), mat("ochre", 1.15), mat("dye-blue", 1.2), mat("terracotta", 1.25))


def spool_rack(v, x, y, z, n=4, along="y"):
    """A rack of spools: two posts, three shelves, spools in thread colours on them."""
    for k in (0, n * 2):
        if along == "y":
            v.box(x, y + k, z, x + 1, y + k + 1, z + 7, TIMBER)
        else:
            v.box(x + k, y, z, x + k + 1, y + 1, z + 7, TIMBER)
    for s in range(3):
        zz = z + 1 + s * 2
        for i in range(n * 2 + 1):
            if along == "y":
                v.set(x, y + i, zz, TIMBER_LIGHT)
            else:
                v.set(x + i, y, zz, TIMBER_LIGHT)
        for i in range(n):
            c = THREADS[(i + s) % len(THREADS)]
            if along == "y":
                v.set(x, y + 1 + i * 2, zz + 1, c)
            else:
                v.set(x + 1 + i * 2, y, zz + 1, c)


def build(ctx):
    v = ctx.vox()  # 24 × 32
    seed = 105
    P.yard(v, 0, 0, 24, 32, "grass", seed=seed)
    P.yard(v, 1, 22, 23, 32, "paved", seed=seed)
    b = P.building(v, 2, 3, 13, 20, "stone", along="y", height=9, roof=ROOF, seed=seed)
    P.entrance(b.face("y+"), 5, 2, 3, 5)
    for a in (6, 13):
        Q.window(b.face("x-"), a, 4, 2, 3, hood="key", surround=True)
    # The open side: a lean-to on posts with wheels and spool racks.
    P.lean_to(v, 13, 22, 3, 20, 9, "tiles", down="x+", m=ROOF, seed=seed)
    Q.spinning_wheel(v, 15, 6, 1, along="y")
    Q.spinning_wheel(v, 15, 13, 1, along="y")
    spool_rack(v, 20, 5, 1, n=4, along="y")
    spool_rack(v, 20, 14, 1, n=2, along="y")
    # Skeins on a pole (rigid), flax baskets, a bench, a cart.
    v.box(14, 23, 1, 15, 24, 7, TIMBER)
    v.box(21, 23, 1, 22, 24, 7, TIMBER)
    v.box(14, 23, 7, 22, 24, 8, TIMBER_LIGHT)
    for i, x in enumerate(range(15, 21, 2)):
        v.box(x, 23, 4, x + 1, 24, 7, THREADS[i % len(THREADS)])
    for x in (3, 6):
        P.cask(v, x, 23, 1, h=2, lid=HEMP)
    P.bench(v, 3, 27, 1, 5)
    P.sacks(v, 9, 23, 1, n=1, m=CANVAS)
    P.handcart(v, 14, 26, 1, along="x", load=mat("canvas", 1.05))
    v.anchor("cart", 8, 31, 1)
    P.scatter(v, 0, 0, 24, 3, 0.04, seed=seed)
    return P.colour_jitter(v, seed=seed)

"""
Oyster beds (6 × 12, the back 4 rows over water; D-057 §3, V5): rack
frames on piles over the water rows — trestles carrying rails with rows
of oyster bags — either side of a plank walkway that runs out to the
boat's mooring (`boat`); on the land rows a sorting hut of ashlar with a
tiled roof and an open sorting shed with tables and tubs, stone holding
tanks of sea water, shell heaps, stacked spare racks, a store for bags and gear, the keeper's
cottage and a cart.
"""

from nsvoxel import detail_v5 as Q
from nsvoxel import parts as P
from nsvoxel.grid import mat
from nsvoxel.mats import CANVAS, PLANK, STONE, STONE_DARK, TIMBER, TIMBER_DARK, TIMBER_LIGHT

BAG = mat("stone", 0.78)
OYSTER = mat("stone", 0.9)
SEA = mat("shallows")
ROOF = mat("terracotta", 0.94)


def rack(v, x0, x1, y):
    """A rack frame over the water: trestle posts down into the sea, two rails, bags of oysters between."""
    for x in range(x0, x1, 6):
        for yy in (y, y + 3):
            v.box(x, yy, -6, x + 1, yy + 1, 2, TIMBER_DARK)
    for yy in (y, y + 3):
        v.box(x0, yy, 2, x1, yy + 1, 3, TIMBER)
    for x in range(x0 + 1, x1 - 1, 3):
        v.box(x, y + 1, 2, x + 2, y + 3, 3, BAG)


def build(ctx):
    v = ctx.vox()  # 48 × 96, land from y 32
    W, D, land = ctx.W, ctx.D, ctx.land
    seed = 85
    # Racks either side of the walkway.
    for y in (3, 10, 17, 24):
        rack(v, 2, 21, y)
        rack(v, 27, 46, y)
    # Walkway on piles out to the mooring.
    for y in range(1, land + 2):
        for x in range(22, 26):
            v.set(x, y, 1, P.shade_of(PLANK, 1.0 if (y // 2) % 2 else 0.9))
        if y % 6 == 1:
            for x in (22, 25):
                v.box(x, y, -7, x + 1, y + 1, 1, TIMBER_DARK)
    v.box(26, 1, -5, 27, 2, 4, TIMBER)  # mooring post
    v.box(22, 2, 2, 24, 4, 4, mat("canvas", 0.85))  # a basket at the end
    v.anchor("boat", 30.4, 6.4, 0.4)
    # Shore, yard and paths.
    P.yard(v, 0, land, W, land + 5, "sand", seed=seed)
    P.yard(v, 0, land + 5, W, D, "dirt", seed=seed)
    P.yard(v, 0, D - 10, 20, D, "grass", seed=seed)
    P.path(v, [(x, y) for x in range(22, 26) for y in range(land, D)], kind="paved")
    # Sorting hut: ashlar, tiles, a chimney-less hipped roof.
    b = P.building(v, 3, 40, 19, 54, "stone", along="x", height=11, roof=ROOF, seed=seed)
    f = b.face("y+")
    P.entrance(f, 9, 2, 3, 5)
    for a in (5, 15):
        Q.window(f, a, 5, 2, 3, hood="key", surround=True)
    Q.window(b.face("x+"), 46, 5, 2, 3, hood="key", surround=True)
    P.trade_sign(f, 13, 8, OYSTER)
    # Open sorting shed: lean-to on posts over two tables and tubs.
    P.lean_to(v, 29, 45, 40, 52, 9, "tiles", down="y+", m=ROOF, seed=seed)
    for y in (42, 47):
        v.box(31, y, 1, 43, y + 2, 3, TIMBER_LIGHT)
        for x in range(32, 42, 3):
            v.set(x, y, 3, OYSTER)
            v.set(x + 1, y + 1, 3, OYSTER)
    for x in (30, 40):
        P.cask(v, x, 54, 1, h=2, lid=SEA)
    # Holding tanks of sea water.
    for x0 in (28, 37):
        v.box(x0, 60, 1, x0 + 8, 72, 3, STONE)
        v.box(x0 + 1, 61, 2, x0 + 7, 71, 3, SEA)
        for y in range(62, 70, 3):
            v.set(x0 + 3, y, 2, OYSTER)
    # Shell heaps, spare racks, baskets, crates.
    Q.shell_heap(v, 8, 62, 3.5, 3, seed)
    Q.shell_heap(v, 14, 66, 2.5, 2, seed + 1)
    for i in range(3):
        v.box(4, 70 + i * 2, 1 + i, 16, 71 + i * 2, 2 + i, TIMBER)
    # Store for bags and gear: boarded on a stone plinth, tiles, an open gate with crates.
    st = P.building(v, 30, 78, 45, 90, "stone", along="x", height=9, roof=ROOF, seed=seed + 3)
    P.barn_gate(st.face("y+"), 33, 1, 5, 6)
    P.casement(st.face("y+"), 41, 4, 2, 2, frame=P.DRESSED, sill=P.DRESSED, bars=False)
    P.box_crate(v, 30, 91, 1, contents=OYSTER)
    P.box_crate(v, 39, 92, 1, contents=OYSTER)
    P.sacks(v, 42, 92, 1, n=2, m=CANVAS)
    # Keeper's cottage by the gate: ashlar, tiles, a chimney.
    k = P.building(v, 3, 78, 15, 88, "stone", along="y", height=10, roof=mat("terracotta", 0.84), seed=seed + 4)
    P.entrance(k.face("x+"), 82, 2, 2, 5)
    Q.window(k.face("y+"), 8, 5, 2, 3, hood="key", surround=True)
    P.roof_chimney(v, k.roof, 6, 80, above=2, brick=True)
    P.handcart(v, 18, 84, 1, along="y", load=OYSTER)
    P.fence_line_v2(v, 0, 70, 0, 95, kind="picket", seed=seed)
    P.flower_bed(v, 2, 90, 10, 94, seed=seed)
    P.shrub(v, 14, 92, 1, 2, seed=seed)
    v.anchor("cart", 24, 92, 1)
    P.scatter(v, 0, land + 5, W, D, 0.015, seed=seed)
    _ = STONE_DARK
    return P.colour_jitter(v, seed=seed)

"""
Slaughterhouse (4 × 4; D-057 §3, V5): a low ashlar hall with a tiled
roof and a scalding-kettle chimney (smoke), and beside it an open shed
on posts with sides of beef hanging from a rail (red meat, pale fat;
rigid, not cloth); a cattle pen with a trough at the front, a chopping
block, salt barrels and a cart.
"""

from nsvoxel import detail_v5 as Q
from nsvoxel import parts as P
from nsvoxel.grid import mat
from nsvoxel.mats import CANVAS, IRON, TIMBER, TIMBER_DARK, TIMBER_LIGHT

ROOF = mat("terracotta", 0.88)
MEAT = mat("terracotta", 1.18)
FAT = mat("canvas", 0.95)


def side_of_beef(v, x, y, z):
    """A side of beef on a hook: 2 wide, 5 long, red with a pale fat edge, hanging from z down."""
    v.set(x, y, z, IRON)
    for k in range(1, 6):
        v.set(x, y, z - k, MEAT)
        v.set(x + 1, y, z - k, FAT if k in (1, 2) else MEAT)


def build(ctx):
    v = ctx.vox()  # 32 × 32
    seed = 93
    P.yard(v, 0, 0, 32, 32, "dirt", seed=seed)
    P.yard(v, 1, 22, 31, 32, "paved", seed=seed)
    # The hall: low ashlar, tiles, the kettle chimney.
    b = P.building(v, 2, 3, 18, 18, "stone", along="y", height=9, roof=ROOF, seed=seed)
    f = b.face("y+")
    P.barn_gate(f, 5, 2, 5, 5)
    Q.window(f, 12, 4, 2, 3, hood="key", surround=True)
    for a in (6, 12):
        P.casement(b.face("x-"), a, 5, 2, 2, frame=Q.DRESSED, sill=Q.DRESSED, bars=False)
    P.roof_chimney(v, b.roof, 6, 6, above=4, brick=True, anchor=True)
    # Open shed with hanging sides.
    P.lean_to(v, 20, 30, 3, 17, 10, "tiles", down="x+", m=ROOF, seed=seed)
    v.box(20, 6, 9, 30, 7, 10, TIMBER_DARK)
    v.box(20, 12, 9, 30, 13, 10, TIMBER_DARK)
    for x in (21, 24, 27):
        side_of_beef(v, x, 6, 8)
        side_of_beef(v, x, 12, 8)
    v.box(21, 8, 1, 29, 11, 3, TIMBER_LIGHT)  # the block table
    v.set(23, 9, 3, IRON)
    v.set(26, 9, 3, MEAT)
    # Cattle pen at the front, chopping block, barrels, cart.
    P.fence_ring(v, 2, 20, 16, 30, kind="rail", seed=seed)
    P.trough(v, 4, 22, 1, length=6, along="x")
    P.chopping_block(v, 19, 22)
    P.cask(v, 26, 20, 1, lid=FAT)
    P.cask(v, 28, 23, 1)
    P.sacks(v, 22, 27, 1, n=2, m=CANVAS)
    P.handcart(v, 18, 26, 1, along="y", load=MEAT)
    v.anchor("cart", 26, 30, 1)
    _ = TIMBER
    return P.colour_jitter(v, seed=seed)

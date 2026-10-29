"""
Luthier (5 × 5; D-057 §3, V5): a two-storey workshop — ashlar ground
floor, half-timbered plaster upper storey, tiles, a gable dormer — whose
signboard is its instruments: a fiddle and a lute in warm timber hung
on a beam over the door; outside under a lean-to a workbench with a
half-made lute body, clamps and tools, tonewood planks stacked to
season, a bench, flower beds and a cart.
"""

from nsvoxel import detail_v5 as Q
from nsvoxel import parts as P
from nsvoxel.grid import mat
from nsvoxel.mats import BRASS, IRON, PLANK, PLASTER, TIMBER, TIMBER_DARK, TIMBER_LIGHT

ROOF = mat("terracotta", 0.92)
SPRUCE = mat("ochre", 1.15)
MAPLE = mat("terracotta", 1.3)


def fiddle(v, x, y, z):
    """A fiddle in the x–z plane: waisted body (5 × 7), a dark neck and scroll (z up)."""
    rows = ((1, 4), (0, 5), (0, 5), (1, 4), (0, 5), (0, 5), (1, 4))
    for j, (a, b) in enumerate(rows):
        for i in range(a, b):
            v.set(x + i, y, z + j, MAPLE)
    v.set(x + 2, y, z + 3, TIMBER_DARK)
    for j in range(7, 11):
        v.set(x + 2, y, z + j, TIMBER_DARK)
    v.set(x + 3, y, z + 10, TIMBER_DARK)


def lute(v, x, y, z):
    """A lute in the x–z plane: a round body (7 wide), a rose, a long neck and a bent head."""
    for i in range(7):
        for j in range(7):
            if ((i - 3) ** 2 + (j - 3) ** 2) <= 10:
                v.set(x + i, y, z + j, SPRUCE)
    v.set(x + 3, y, z + 3, TIMBER_DARK)
    for j in range(7, 11):
        v.set(x + 3, y, z + j, TIMBER_DARK)
    v.set(x + 4, y, z + 11, TIMBER_DARK)
    v.set(x + 5, y, z + 11, TIMBER_DARK)


def build(ctx):
    v = ctx.vox()  # 40 × 40
    seed = 121
    P.yard(v, 0, 0, 40, 40, "paved", seed=seed)
    P.yard(v, 0, 0, 40, 4, "grass", seed=seed)
    b = P.building(v, 4, 4, 26, 24, "citizen", along="x", upper=PLASTER, seed=seed, spacing=4, roof=ROOF)
    f, F = b.face("y+"), b.face("y+", upper=True)
    P.entrance(f, 9, 2, 3, 6, frame=Q.DRESSED, lintel=Q.DRESSED, knob=BRASS)
    Q.window(f, 15, 3, 4, 4, hood="cornice", surround=True)
    for a in (7, 13, 19):
        P.casement(F, a, 11, 2, 3, frame=None, sill=TIMBER_LIGHT)
    for a in (9, 17):
        Q.window(b.face("x-"), a, 3, 2, 4, hood="key", surround=True)
        P.casement(b.face("x-", upper=True), a, 11, 2, 3, frame=None, sill=TIMBER_LIGHT)
    P.roof_chimney(v, b.roof, 22, 8, above=2, brick=True)
    # The signboard: a beam out from the wall, a fiddle and a lute hung from it.
    v.box(8, 24, 18, 22, 27, 19, TIMBER_DARK)
    for x in (10, 19):
        v.set(x, 26, 17, IRON)
    fiddle(v, 8, 26, 6)
    lute(v, 16, 26, 5)
    # Lean-to workshop on the east side with the bench.
    P.lean_to(v, 26, 38, 5, 23, 10, "tiles", down="x+", m=ROOF, seed=seed)
    v.box(28, 8, 1, 36, 11, 4, TIMBER_LIGHT)
    v.box(29, 9, 4, 33, 11, 5, SPRUCE)  # a half-made lute body
    v.set(34, 9, 4, IRON)
    v.set(35, 10, 4, IRON)
    v.box(28, 14, 1, 36, 20, 2, PLANK)
    for k in range(4):
        v.box(28, 14 + k, 2 + k, 36, 15 + k, 3 + k, PLANK if k % 2 else SPRUCE)
    v.box(37, 6, 2, 38, 20, 3, TIMBER_DARK)
    for y in range(7, 20, 3):
        v.box(37, y, 3, 38, y + 1, 6, IRON if y % 2 else TIMBER)
    # Yard: seasoning planks, a bench, flowers, cart.
    P.planks(v, 4, 30, 1, w=10, d=3, h=4)
    P.bench(v, 18, 30, 1, 6)
    P.flower_bed(v, 26, 27, 36, 30, seed=seed)
    P.handcart(v, 26, 33, 1, along="x", load=SPRUCE)
    v.anchor("cart", 20, 38, 1)
    P.scatter(v, 0, 0, 40, 4, 0.04, seed=seed)
    return P.colour_jitter(v, seed=seed)

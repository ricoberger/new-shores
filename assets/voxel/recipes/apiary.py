"""
Apiary (5 × 5; D-057 §3): a beekeeper's cottage (pegged frame, plaster,
thatch, chimney with smoke), rows of straw skeps on plank stands with
little roofs, a honey house with a lean-to, frames and jars of honey on
a bench, flower beds, a fence and a cart.
"""

from nsvoxel import parts as P
from nsvoxel.mats import BRASS, THATCH, THATCH_DARK, TIMBER, TIMBER_LIGHT

HONEY = P.mat("brass", 1.05)


def skep(v, x, y, z):
    """A straw bee skep (3 × 3, coiled courses) on its board."""
    v.box(x - 1, y - 1, z, x + 4, y + 4, z + 1, TIMBER_LIGHT)
    for k, (a, b) in enumerate(((0, 3), (0, 3), (1, 2))):
        c = THATCH if k % 2 == 0 else THATCH_DARK
        v.box(x + a, y + a, z + 1 + k, x + b, y + b, z + 2 + k, c)
    v.set(x + 1, y + 2, z + 1, P.mat("iron", 0.6))  # entrance hole


def build(ctx):
    v = ctx.vox()  # 40 × 40
    seed = 67
    P.yard(v, 0, 0, 40, 40, "grass", seed=seed)
    b = P.building(v, 3, 3, 17, 13, "settler", along="x", seed=seed, spacing=5, braces=("x-", "x+"))
    f = b.face("y+")
    P.entrance(f, 8, 2, 3, 5)
    P.casement(f, 4, 5, 2, 2, frame=None, sill=TIMBER_LIGHT, shutters=TIMBER_LIGHT, bars=False, box=P.mat("flower"))
    P.casement(f, 13, 5, 2, 2, frame=None, sill=TIMBER_LIGHT, shutters=TIMBER_LIGHT, bars=False, box=P.mat("flower"))
    P.roof_chimney(v, b.roof, 14, 6, above=3, anchor=True)
    # Honey house with a lean-to bench.
    h = P.building(v, 22, 3, 32, 11, "settler", along="y", seed=seed + 1, spacing=4, braces=False, height=8)
    P.entrance(h.face("y+"), 25, 2, 3, 5)
    P.lean_to(v, 32, 37, 3, 11, 6, "thatch", down="x+", ov=1, seed=seed)
    v.box(33, 4, 1, 36, 10, 3, TIMBER)
    for y in range(4, 10, 2):
        v.set(34, y, 3, HONEY)
        v.set(35, y + 1, 3, BRASS)
    # Skeps on stands in rows.
    for k, (x, y) in enumerate(((4, 18), (10, 18), (16, 18), (4, 25), (10, 25), (16, 25))):
        skep(v, x, y, 1 + (k % 2))
        if k % 2:
            v.box(x - 1, y - 1, 1, x + 4, y + 4, 2, TIMBER)
    # Flower beds and a fence.
    P.flower_bed(v, 22, 16, 37, 20, seed=seed)
    P.flower_bed(v, 22, 23, 37, 27, seed=seed + 1)
    P.fence_ring(v, 1, 15, 39, 33, kind="picket", gaps={(19, 32), (20, 32), (21, 32)}, seed=seed)
    P.handcart(v, 24, 34, 1, along="x", load=HONEY)
    v.anchor("cart", 30, 37, 1)
    P.scatter(v, 0, 0, 40, 40, 0.03, seed=seed)
    return P.colour_jitter(v, seed=seed)

"""
Orchard (4 × 4; D-057 §3): a cider house with a coursed-stone ground
floor, jettied ochre upper storey and tiles (chimney with smoke), a
cellar hatch, apple crates and baskets, a ladder against a fruit tree,
two irregular fruit trees with apples and windfalls in the grass.
"""

from nsvoxel import parts as P
from nsvoxel.mats import APPLE, OCHRE, TIMBER, TIMBER_LIGHT


def build(ctx):
    v = ctx.vox()  # 32 × 32
    seed = 46
    P.yard(v, 0, 0, 32, 32, "grass", seed=seed)
    P.path(v, [(x, y) for x in range(13, 18) for y in range(17, 32)])
    b = P.building(v, 4, 4, 24, 16, "citizen", along="x", upper=OCHRE, seed=seed, spacing=5)
    f, F = b.face("y+"), b.face("y+", upper=True)
    P.entrance(f, 13, 2, 3, 5, frame=P.DRESSED, lintel=P.DRESSED)
    for a in (6, 19):
        P.casement(f, a, 3, 2, 3, frame=P.DRESSED, sill=P.DRESSED, lintel=P.DRESSED)
    for a in (5, 11, 17):
        P.casement(F, a, 11, 2, 3, frame=None, sill=TIMBER_LIGHT, shutters=P.mat("grass-b", 0.8))
    P.roof_chimney(v, b.roof, 20, 8, above=3, brick=True, anchor=True)
    # Cellar hatch.
    v.box(25, 9, 1, 29, 13, 2, TIMBER)
    for x in range(25, 29):
        v.set(x, 11, 1, P.mat("timber", 0.82))
    for x, y in ((4, 20), (7, 20), (4, 23)):
        P.box_crate(v, x, y, 1, contents=APPLE)
    P.cask(v, 8, 24, 1, h=3, lid=APPLE)
    v.line((22, 20, 1), (22, 22, 7), TIMBER_LIGHT)
    v.line((24, 20, 1), (24, 22, 7), TIMBER_LIGHT)
    for z in (2, 4, 6):
        v.set(23, 20 + z // 3, z, TIMBER_LIGHT)
    P.fruit_tree(v, 27, 23, 1, seed=seed, fruit=APPLE)
    P.fruit_tree(v, 27, 4, 1, seed=seed + 1, fruit=APPLE)
    for x, y in ((25, 27), (29, 20), (26, 8), (28, 1)):
        v.set(x, y, 1, APPLE)
    P.handcart(v, 8, 27, 1, along="x", load=APPLE)
    v.anchor("cart", 20, 29, 1)
    P.scatter(v, 0, 0, 32, 32, 0.03, seed=seed)
    return P.colour_jitter(v, seed=seed)

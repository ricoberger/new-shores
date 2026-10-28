"""
Hemp farm (3 × 4; D-057 §3): a timber-framed farmhouse with plaster,
thatch and a chimney (smoke); a retting pond where bundles of hemp soak,
bundles drying in stooks against a rack, a breaking bench with fibre,
bales of hemp and a hand cart.
"""

from nsvoxel import parts as P
from nsvoxel.mats import HEMP, HEMP_MARK, STONE, TIMBER, TIMBER_LIGHT

FIBRE = P.mat("thatch", 1.15)


def build(ctx):
    v = ctx.vox()  # 24 × 32
    seed = 61
    P.yard(v, 0, 0, 24, 32, "grass", seed=seed)
    P.yard(v, 2, 15, 22, 30, "dirt", seed=seed)
    b = P.building(v, 2, 3, 15, 12, "settler", along="x", seed=seed, spacing=5, braces=("x-", "x+"))
    f = b.face("y+")
    P.entrance(f, 7, 2, 3, 5)
    P.casement(f, 3, 5, 2, 2, frame=None, sill=TIMBER_LIGHT, shutters=TIMBER_LIGHT, bars=False)
    P.casement(f, 12, 5, 2, 2, frame=None, sill=TIMBER_LIGHT, shutters=TIMBER_LIGHT, bars=False)
    P.roof_chimney(v, b.roof, 4, 6, above=3, anchor=True)
    # Retting pond with soaking bundles.
    for x in range(16, 23):
        for y in range(3, 12):
            edge = x in (16, 22) or y in (3, 11)
            v.set(x, y, 0, STONE if edge else P.mat("shallows", 0.9))
    for x, y in ((18, 5), (20, 7), (18, 9)):
        v.box(x, y, 0, x + 2, y + 1, 1, HEMP)
    # Drying rack with standing bundles.
    v.box(3, 17, 1, 4, 18, 6, TIMBER)
    v.box(13, 17, 1, 14, 18, 6, TIMBER)
    v.box(3, 17, 5, 14, 18, 6, TIMBER_LIGHT)
    for x in range(4, 13, 2):
        v.box(x, 18, 1, x + 1, 19, 5, HEMP)
        v.set(x, 18, 5, HEMP_MARK)
    # Breaking bench with fibre, bales, cart.
    v.box(4, 23, 1, 12, 25, 2, TIMBER)
    v.box(4, 23, 2, 12, 25, 3, TIMBER_LIGHT)
    v.box(6, 23, 3, 10, 25, 4, FIBRE)
    P.bale(v, 15, 20, 1, 3, 2, 2, m=FIBRE)
    P.bale(v, 15, 23, 1, 3, 2, 2, m=FIBRE)
    P.bale(v, 16, 21, 3, 2, 2, 1, m=FIBRE)
    P.handcart(v, 4, 27, 1, along="x", load=HEMP)
    v.anchor("cart", 18, 29, 1)
    P.scatter(v, 0, 0, 24, 32, 0.03, seed=seed)
    return P.colour_jitter(v, seed=seed)

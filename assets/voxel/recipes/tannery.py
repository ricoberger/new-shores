"""
Tannery (3 × 4; D-057 §3): a coursed-stone workshop with thatch and a
chimney (smoke), a row of tanning pits edged in stone with brown liquor,
hides stretched on frames and hung on a rail, a bark heap, a scraping
beam, casks and a cart.
"""

from nsvoxel import parts as P
from nsvoxel.mats import STONE, TIMBER, TIMBER_LIGHT

HIDE = P.mat("canvas", 0.8)
LIQUOR = P.mat("timber", 0.7)
BARK = P.mat("timber", 0.95)


def build(ctx):
    v = ctx.vox()  # 24 × 32
    seed = 71
    P.yard(v, 0, 0, 24, 32, "dirt", seed=seed)
    P.yard(v, 0, 0, 24, 2, "grass", seed=seed)
    b = P.building(v, 2, 3, 16, 12, "stonethatch", along="x", seed=seed)
    f = b.face("y+")
    P.entrance(f, 7, 2, 3, 5)
    P.casement(f, 3, 4, 2, 3, frame=P.DRESSED, sill=P.DRESSED, lintel=P.DRESSED, shutters=TIMBER_LIGHT)
    P.casement(f, 12, 4, 2, 3, frame=P.DRESSED, sill=P.DRESSED, lintel=P.DRESSED, shutters=TIMBER_LIGHT)
    P.roof_chimney(v, b.roof, 13, 6, above=3, anchor=True)
    # Tanning pits.
    for k, x in enumerate((2, 8, 14)):
        v.box(x, 15, 0, x + 5, 20, 1, STONE)
        v.box(x + 1, 16, 0, x + 4, 19, 1, LIQUOR if k != 1 else P.shade_of(LIQUOR, 1.2))
        v.box(x, 15, 1, x + 5, 16, 2, STONE)
    # Hide frames and a drying rail.
    for x in (17, 21):
        v.box(x, 4, 1, x + 1, 5, 7, TIMBER)
        v.box(x, 10, 1, x + 1, 11, 7, TIMBER)
    v.box(17, 4, 7, 22, 11, 8, TIMBER_LIGHT)
    for y in (5, 8):
        v.box(18, y, 3, 21, y + 2, 7, HIDE)
    for x in (3, 13):
        v.box(x, 23, 1, x + 1, 24, 6, TIMBER)
    v.box(3, 23, 6, 14, 24, 7, TIMBER_LIGHT)
    for x in range(5, 12, 3):
        v.box(x, 23, 3, x + 2, 24, 6, HIDE)
    # Bark heap, scraping beam, casks, cart.
    v.ellipsoid(19, 24, 0, 2.5, 2.5, 2, BARK, keep=lambda x, y, z: z >= 1)
    v.line((3, 27, 1), (8, 27, 3), TIMBER)
    v.set(6, 27, 3, HIDE)
    P.cask(v, 11, 27, 1)
    P.cask(v, 14, 27, 1)
    P.handcart(v, 17, 27, 1, along="x", load=HIDE)
    v.anchor("cart", 20, 30, 1)
    P.scatter(v, 0, 0, 24, 32, 0.015, seed=seed, kinds=("pebble", "tuft"))
    return P.colour_jitter(v, seed=seed)

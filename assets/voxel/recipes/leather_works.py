"""
Leather works (3 × 4; D-057 §3): a timber tanner's hut on a stone
footing with a thatched roof and a boarded loft door, and in front of it
hide frames as tall as the hut with stretched hides in tan and brown,
tanning pits (dark liquor in stone-lined pits), a scraping beam, bark
heaped for the tan and stacked rolled leather; a cart.
"""

from nsvoxel import detail_v4 as V
from nsvoxel import parts as P
from nsvoxel.grid import mat
from nsvoxel.mats import STONE_DARK, TIMBER, TIMBER_DARK, TIMBER_LIGHT

HIDE = mat("ochre", 0.95)
HIDE_DARK = mat("timber", 1.2)
LIQUOR = mat("timber", 0.55)
BARK = mat("timber", 0.9)


def build(ctx):
    v = ctx.vox()  # 24 × 32
    seed = 127
    P.yard(v, 0, 0, 24, 32, "dirt", seed=seed)
    # Hut at the back: stone footing, log/plank walls, thatch, loft door.
    b = P.building(v, 8, 2, 22, 12, "settler", along="x", seed=seed, kind="thatch", height=10, rise=1.4)
    f = b.face("y+")
    P.entrance(f, 11, 2, 3, 5)
    P.casement(f, 17, 4, 2, 2, frame=None, sill=TIMBER_LIGHT, shutters=TIMBER, bars=False)
    P.casement(b.face("x-"), 6, 4, 2, 2, frame=None, sill=TIMBER_LIGHT, shutters=TIMBER, bars=False)
    # Hide frames as tall as the hut (two along x, one along y on the west).
    V.hide_frame(v, 3, 16, 1, 7, 11, HIDE, frame=TIMBER)
    V.hide_frame(v, 13, 16, 1, 6, 11, HIDE_DARK, frame=TIMBER)
    V.hide_frame(v, 1, 3, 1, 8, 10, HIDE_DARK, frame=TIMBER, along="y")
    # Tanning pits: stone-lined, dark liquor, one with a hide soaking.
    for x0 in (2, 8, 14):
        v.box(x0, 21, 0, x0 + 5, 26, 2, STONE_DARK)
        v.box(x0 + 1, 22, 1, x0 + 4, 25, 2, LIQUOR)
    v.box(9, 22, 1, 12, 24, 2, HIDE)
    # Scraping beam, bark heap, rolled leather, cart.
    v.box(20, 21, 1, 21, 22, 3, TIMBER_DARK)
    v.line((20, 21, 3), (23, 26, 1), TIMBER)
    V.heap(v, 4, 29, r=2.5, h=3, m=BARK, seed=seed)
    for z in (1, 2):
        v.box(9, 28, z, 14, 29 + (z % 2), z + 1, HIDE_DARK)
    P.handcart(v, 16, 28, 1, along="x", load=HIDE)
    v.anchor("cart", 12, 31, 1)
    P.scatter(v, 0, 0, 24, 32, 0.015, seed=seed, kinds=("pebble", "tuft"))
    return P.colour_jitter(v, seed=seed)

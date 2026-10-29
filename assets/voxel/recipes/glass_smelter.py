"""
Glass smelter (4 × 6; D-057 §3, V5): a brick dome furnace with three
glowing mouths and a tall brick stack rising from its back (smoke), a
glasshouse of ashlar with a tiled roof and wide windows, racks of glass
panes stacked on edge in timber frames, a sand heap, a bin of cullet,
crates of bottles, a woodpile for the fire and a cart.
"""

from nsvoxel import detail_v5 as Q
from nsvoxel import parts as P
from nsvoxel.grid import mat
from nsvoxel.mats import IRON, SAND, TIMBER, TIMBER_DARK, TIMBER_LIGHT, WINDOW

ROOF = mat("terracotta", 0.92)
BRICK = mat("terracotta", 0.74)
GLOW = mat("flower", 1.0)
PANE = mat("shallows", 1.12)
PANE_EDGE = mat("shallows", 0.95)


def pane_rack(v, x, y, n=4):
    """A rack of glass panes on edge: a timber base, panes 1 thick along y, a top rail."""
    v.box(x, y, 1, x + 7, y + n * 2 + 1, 2, TIMBER)
    for i in range(n):
        yy = y + 1 + i * 2
        v.box(x + 1, yy, 2, x + 6, yy + 1, 7, PANE)
        v.box(x + 1, yy, 7, x + 6, yy + 1, 8, PANE_EDGE)
    v.box(x, y, 2, x + 1, y + n * 2 + 1, 8, TIMBER_DARK)
    v.box(x + 6, y, 2, x + 7, y + n * 2 + 1, 8, TIMBER_DARK)


def build(ctx):
    v = ctx.vox()  # 32 × 48
    seed = 111
    P.yard(v, 0, 0, 32, 48, "dirt", seed=seed)
    P.yard(v, 2, 26, 30, 46, "paved", seed=seed)
    # The dome furnace on a brick drum.
    cx, cy = 10, 13
    v.cyl(cx, cy, 1, 4, 8, BRICK)
    Q.dome(v, cx, cy, 4, 8, m=BRICK, bands=P.shade_of(BRICK, 0.88))
    for dx, dy in ((0, 8), (-8, 0), (6, 6)):
        mx, my = cx + (dx > 0) - (dx < 0) + int(dx * 0.9), cy + int(dy * 0.9)
        v.box(mx - 1, my - 1, 1, mx + 1, my + 1, 4, None)
        v.box(mx - 1, my - 1, 1, mx + 1, my + 1, 2, GLOW)
    v.box(cx - 2, cy + 7, 4, cx + 2, cy + 9, 5, Q.DRESSED)
    # The tall stack behind the dome.
    v.box(cx - 2, 1, 1, cx + 2, 5, 30, BRICK)
    v.box(cx - 3, 0, 30, cx + 3, 6, 31, Q.DRESSED)
    v.box(cx - 2, 1, 31, cx + 2, 5, 33, mat("iron", 0.9))
    v.anchor("chimney", cx, 3, 33)
    v.anchor("smoke", cx, 3, 34)
    # Glasshouse.
    b = P.building(v, 20, 3, 31, 22, "stone", along="y", height=11, roof=ROOF, seed=seed)
    P.entrance(b.face("y+"), 24, 2, 3, 5)
    for a in (6, 12, 17):
        Q.window(b.face("x-"), a, 4, 3, 4, hood="cornice", surround=True)
    # Pane racks, sand, cullet, bottles, wood.
    pane_rack(v, 3, 28, n=4)
    pane_rack(v, 12, 28, n=3)
    Q.heap(v, 6, 41, 3.5, 3.0, 2.5, SAND)
    v.box(12, 38, 1, 17, 43, 3, TIMBER_DARK)
    for x, y in ((13, 39), (15, 40), (14, 41), (16, 39)):
        v.set(x, y, 3, PANE)
    for x in (22, 25):
        P.box_crate(v, x, 26, 1, contents=WINDOW)
    P.woodpile(v, 20, 31, 1, length=8, along="x", rows=2)
    v.box(19, 22, 1, 20, 26, 2, IRON)  # a blowpipe rack
    P.handcart(v, 22, 38, 1, along="x", load=PANE)
    v.anchor("cart", 26, 46, 1)
    _ = TIMBER_LIGHT
    return P.colour_jitter(v, seed=seed)

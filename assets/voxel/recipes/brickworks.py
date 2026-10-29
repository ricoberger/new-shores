"""
Brickworks (4 × 5; D-057 §3): a rectangular brick kiln with buttressed
walls, arched fire holes and a tall square chimney (smoke), its top
loaded with bricks under a slate cap; hacks of drying bricks under a long
tiled shed, finished bricks in tall checkered stacks, a clay heap with a
moulding table, a sand heap, barrows and a cart.
"""

from nsvoxel import detail_v4 as V
from nsvoxel import parts as P
from nsvoxel.grid import mat
from nsvoxel.mats import IRON, SAND, STONE_DARK, TIMBER, TIMBER_DARK, TIMBER_LIGHT

CLAY = mat("terracotta", 1.22)
GREEN_BRICK = mat("ochre", 0.88)
GLOW = mat("flower", 1.0)


def build(ctx):
    v = ctx.vox()  # 32 × 40
    seed = 173
    P.yard(v, 0, 0, 32, 40, "dirt", seed=seed)
    # Kiln: brick walls, buttresses, fire holes, a chimney at the back corner.
    x0, x1, y0, y1 = 2, 18, 4, 20
    V.brick_stack(v, x0, y0, x1, y1, 1, 10)
    for x in (x0 - 1, x1):
        for y in (y0 + 2, y0 + 8, y1 - 3):
            v.box(x, y, 1, x + 1, y + 2, 7, P.shade_of(P.BRICK, 0.9))
    v.box(x0, y0, 10, x1, y1, 11, STONE_DARK)
    P.roof(v, x0 + 2, x1 - 2, y0 + 2, y1 - 2, 11, "slate", hip=True, rise=0.8, ov=0, seed=seed)
    f = P.Face(v, "y+", y1 - 1)
    for a in (5, 9, 13):
        f.put(a, 1, GLOW)
        f.put(a + 1, 1, GLOW)
        f.put(a, 2, IRON)
        f.put(a + 1, 2, IRON)
        f.put(a, 3, P.DRESSED, out=1)
        f.put(a + 1, 3, P.DRESSED, out=1)
    fx = P.Face(v, "x-", x0)
    for a in (7, 13):
        fx.put(a, 1, GLOW)
        fx.put(a, 2, IRON)
    P.chimney_stack(v, 16, 4, 1, 26, brick=True, anchor=True)
    # Drying shed with hacks of green bricks.
    P.lean_to(v, 20, 31, 2, 24, 8, "tiles", down="x+", posts=True)
    for y in range(4, 23, 4):
        V.brick_stack(v, 21, y, 30, y + 2, 1, 4, m=GREEN_BRICK)
    # Finished brick stacks, clay heap with moulding table, sand, barrow, cart.
    for x, h in ((2, 6), (7, 5), (12, 7)):
        V.brick_stack(v, x, 24, x + 4, 28, 1, h)
    V.heap(v, 23, 30, r=3.5, h=4, m=CLAY, seed=seed)
    v.box(17, 30, 1, 18, 33, 3, TIMBER)
    v.box(17, 30, 3, 21, 33, 4, TIMBER_LIGHT)
    v.box(18, 31, 4, 20, 32, 5, CLAY)
    V.heap(v, 28, 35, r=2.5, h=2, m=SAND, seed=seed + 1)
    P.handcart(v, 3, 33, 1, along="x", load=P.BRICK)
    v.box(10, 32, 1, 14, 34, 2, TIMBER_DARK)
    v.box(10, 32, 2, 14, 34, 3, P.BRICK)
    v.anchor("cart", 14, 38, 1)
    P.scatter(v, 0, 0, 32, 40, 0.01, seed=seed, kinds=("pebble",))
    return P.colour_jitter(v, seed=seed)

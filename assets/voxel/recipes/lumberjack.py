"""
Lumberjack (3 × 3; D-057 §3): a log cabin with notched corners on a stone
plinth, thatch with a ridge roll, a stone chimney (smoke) with a pot;
the yard says what it does — log stacks with pale ends, a woodpile of
split billets, a chopping block with the axe in it, a sawhorse with a
log, stumps of felled trees, a young conifer and a hand cart.
"""

from nsvoxel import parts as P
from nsvoxel.mats import PLANK, STONE_DARK, THATCH, TIMBER, TIMBER_LIGHT


def build(ctx):
    v = ctx.vox()
    seed = 3
    P.yard(v, 0, 0, 24, 24, "dirt", seed=seed)
    P.yard(v, 0, 0, 24, 4, "grass", seed=seed)
    P.yard(v, 0, 0, 3, 24, "grass", seed=seed)
    # Log cabin.
    x0, y0, x1, y1 = 4, 5, 16, 14
    P.plinth(v, x0, y0, x1, y1, 1, STONE_DARK, out=1)
    P.fill(v, x0, y0, x1, y1, 1, 2, STONE_DARK)
    P.log_walls(v, x0, y0, x1, y1, 2, 9)
    r = P.roof(v, x0, x1, y0, y1, 9, "thatch", along="x", gable=TIMBER, seed=seed, m=THATCH)
    f = P.Face(v, "y+", y1 - 1)
    P.entrance(f, 9, 2, 3, 5, leaf=TIMBER_LIGHT, frame=TIMBER)
    P.casement(f, 5, 5, 2, 2, frame=PLANK, sill=PLANK, bars=False)
    P.casement(f, 13, 5, 2, 2, frame=PLANK, sill=PLANK, bars=False)
    P.casement(P.Face(v, "x+", x1 - 1), 8, 5, 2, 2, frame=PLANK, sill=PLANK, bars=False)
    P.roof_chimney(v, r, x0 + 1, 10, above=3, anchor=True)
    # Yard: log stacks, woodpile, chopping block, sawhorse.
    P.log_stack(v, 18, 4, 1, length=9, along="y", n=3)
    P.log_stack(v, 4, 17, 1, length=8, along="x", n=2)
    P.woodpile(v, 17, 15, 1, length=5, along="y", rows=3)
    P.chopping_block(v, 13, 18)
    P.sawhorse(v, 13, 21, 1, along="x")
    P.handcart(v, 19, 18, 1, along="y", load=TIMBER_LIGHT)
    # Felled trees: stumps in the grass, a young conifer.
    P.stump(v, 1, 1, seed=seed)
    P.stump(v, 8, 1, seed=seed + 1)
    P.stump(v, 0, 19, seed=seed + 2)
    P.tree(v, 21, 1, 1, "conifer")
    v.anchor("cart", 20, 22, 1)
    P.scatter(v, 0, 0, 24, 24, 0.03, seed=seed)
    return P.colour_jitter(v, seed=seed)

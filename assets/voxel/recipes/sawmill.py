"""
Sawmill (4 × 6; D-057 §3): a timber-framed workshop with thatch and a
stone chimney (smoke); an open saw shed on posts over a saw bench with a
log in the frame saw and a sawdust heap; log stacks with pale ends,
plank stacks in stickered layers, a sawhorse and a hand cart of planks.
"""

from nsvoxel import parts as P
from nsvoxel.grid import mat
from nsvoxel.mats import IRON, PLANK, TIMBER, TIMBER_DARK, TIMBER_LIGHT

SAWDUST = mat("timber", 1.55)


def build(ctx):
    v = ctx.vox()  # 32 × 48
    seed = 8
    P.yard(v, 0, 0, 32, 48, "dirt", seed=seed)
    P.yard(v, 0, 0, 32, 3, "grass", seed=seed)
    # Workshop at the back.
    b = P.building(v, 4, 4, 22, 14, "settler", along="x", seed=seed, spacing=5, braces=("x-", "x+"))
    f = b.face("y+")
    P.entrance(f, 11, 2, 3, 5)
    for a in (6, 16):
        P.casement(f, a, 5, 2, 2, frame=None, sill=TIMBER_LIGHT, shutters=TIMBER_LIGHT, bars=False)
    P.casement(b.face("x-"), 8, 5, 2, 2, frame=None, sill=TIMBER_LIGHT, bars=False)
    P.roof_chimney(v, b.roof, 18, 7, above=3, anchor=True)
    P.log_stack(v, 24, 4, 1, length=10, along="y", n=3)
    # Open saw shed: posts and a lean-to (eave to the front) over the bench.
    P.lean_to(v, 4, 24, 19, 30, 8, "thatch", down="y+", ov=1, seed=seed)
    for x in (13,):
        for y in (19, 29):
            v.box(x, y, 1, x + 1, y + 1, 9, TIMBER)
    v.box(6, 23, 1, 22, 26, 3, TIMBER_DARK)
    for x in range(6, 22, 3):
        v.set(x, 23, 2, TIMBER)
        v.set(x, 25, 2, TIMBER)
    v.box(5, 24, 3, 21, 25, 4, TIMBER_LIGHT)  # log on the bench
    v.set(5, 24, 3, PLANK)
    v.box(13, 22, 3, 14, 27, 4, TIMBER)  # saw frame
    for z in range(4, 8):
        v.set(13, 22, z, TIMBER)
        v.set(13, 26, z, TIMBER)
        v.set(13, 24, z, IRON)
    v.box(13, 22, 7, 14, 27, 8, TIMBER)
    # Sawdust heap at the bench end.
    for x, y, h in ((22, 26, 2), (23, 27, 1), (22, 27, 1), (21, 27, 1), (23, 25, 1)):
        v.box(x, y, 1, x + 1, y + 1, 1 + h, SAWDUST)
    # Stacks: logs, planks in layers with spacer sticks, a sawhorse, the cart.
    P.log_stack(v, 3, 33, 1, length=9, along="x", n=3)
    for (x, y, w, d, h, along) in ((16, 33, 10, 4, 3, "x"), (26, 34, 3, 8, 2, "y")):
        P.planks(v, x, y, 1, w=w, d=d, h=h, along=along)
    P.sawhorse(v, 4, 41, 1, along="x")
    P.woodpile(v, 12, 41, 1, length=5, along="x", rows=2)
    P.handcart(v, 21, 41, 1, along="x", load=PLANK)
    v.anchor("cart", 26, 44, 1)
    P.scatter(v, 0, 0, 32, 48, 0.02, seed=seed)
    return P.colour_jitter(v, seed=seed)

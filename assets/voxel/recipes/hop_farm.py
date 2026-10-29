"""
Hop farm (3 × 4; D-057 §3): an oast house — a square brick-coursed kiln
tower with a steep pyramid roof and a white cowl with a vane — joined to
a timber-framed stowage barn with a tiled roof and a loft door; tall hop
pockets standing in the yard, a picking bin heaped with cones, spare
poles, a few young bines on poles and a cart.
"""

from nsvoxel import parts as P
from nsvoxel.grid import mat
from nsvoxel.mats import CANVAS, IRON, PLASTER, STONE, TIMBER, TIMBER_DARK, TIMBER_LIGHT
from nsvoxel import detail_v4 as V

CONE = mat("pasture-mark", 1.0)
POCKET = mat("canvas", 0.92)
COWL = mat("plaster", 1.04)


def build(ctx):
    v = ctx.vox()  # 24 × 32
    seed = 67
    P.yard(v, 0, 0, 24, 32, "grass", seed=seed)
    P.yard(v, 2, 16, 22, 30, "dirt", seed=seed)
    # Oast: a square kiln tower in brick courses, a steep pyramid roof and a cowl.
    P.plinth(v, 2, 3, 10, 11, 1, P.STONE_DARK if hasattr(P, "STONE_DARK") else STONE, out=1)
    for z in range(1, 15):
        for x in range(2, 10):
            for y in range(3, 11):
                if x in (2, 9) or y in (3, 10):
                    v.set(x, y, z, P.BRICK if (x + y + z) % 2 else P.shade_of(P.BRICK, 0.9))
                else:
                    v.set(x, y, z, P.BRICK)
    P.casement(P.Face(v, "y+", 10), 5, 8, 2, 3, frame=TIMBER_LIGHT, sill=TIMBER_LIGHT)
    r = P.roof(v, 2, 10, 3, 11, 15, "tiles", hip=True, rise=2, ov=1, seed=seed)
    top = r.top
    v.box(5, 6, top - 1, 7, 8, top + 3, COWL)
    v.box(5, 8, top, 7, 9, top + 3, TIMBER_DARK)  # the cowl's open side
    v.box(4, 6, top + 3, 8, 8, top + 4, COWL)
    v.box(5, 6, top + 4, 7, 8, top + 5, COWL)
    v.box(6, 5, top + 4, 7, 6, top + 6, IRON)  # vane
    v.set(6, 4, top + 5, IRON)
    # Stowage barn: stone ground floor, framed loft, tiles, loft door.
    b = P.building(v, 11, 4, 22, 13, "citizen", along="x", upper=PLASTER, seed=seed, spacing=4, height=14)
    f, F = b.face("y+"), b.face("y+", upper=True)
    P.barn_gate(f, 14, 2, 5, 6)
    P.entrance(F, 15, 9, 3, 4, step=None, hinges=False)
    V.hoist(F, 16, 14, length=2, rope=3, load=POCKET)
    P.casement(b.face("x+", upper=True), 7, 10, 2, 2, frame=None, sill=TIMBER_LIGHT)
    # Hop pockets (tall sacks) and a picking bin heaped with cones.
    for x in (3, 6, 9):
        v.box(x, 18, 1, x + 2, 20, 6, POCKET)
        v.box(x, 18, 6, x + 2, 20, 7, P.shade_of(POCKET, 0.85))
    v.box(12, 17, 1, 20, 21, 3, TIMBER)
    v.box(13, 18, 2, 19, 20, 3, CONE)
    V.heap(v, 16, 19, r=2.5, h=2, m=CONE, z=3, seed=seed)
    for x in (12, 19):
        for y in (17, 20):
            v.box(x, y, 3, x + 1, y + 1, 5, TIMBER_LIGHT)
    # Spare poles leaning on a rack, young bines on poles by the fence.
    v.box(2, 23, 1, 3, 24, 4, TIMBER)
    v.box(2, 23, 3, 12, 24, 4, TIMBER_LIGHT)
    for x in range(3, 12, 2):
        v.box(x, 24, 1, x + 1, 25, 3, TIMBER_LIGHT)
    for y in (22, 26):
        V.hop_pole(v, 21, y, h=9, seed=seed + y)
    P.sacks(v, 14, 24, 1, n=2, m=CANVAS)
    P.handcart(v, 4, 27, 1, along="x", load=CONE)
    v.anchor("cart", 15, 29, 1)
    P.scatter(v, 0, 0, 24, 32, 0.03, seed=seed)
    return P.colour_jitter(v, seed=seed)

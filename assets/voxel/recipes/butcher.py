"""
Butcher (4 × 5; D-057 §3): a long thatched hall — stone ground floor,
half-timber gables, a wide shop hatch with a counter of meat and hooks
of hams — beside an open smoking shed on posts with a thatched roof and
a smoke louvre (smoke), sides of meat hanging from its rails; a
chopping block, a scalding tub, salt casks, a woodpile and a cart.
"""

from nsvoxel import detail_v4 as V
from nsvoxel import parts as P
from nsvoxel.grid import mat
from nsvoxel.mats import CANVAS, PLASTER, STONE_DARK, THATCH_DARK, TIMBER, TIMBER_DARK, TIMBER_LIGHT

MEAT = mat("terracotta", 1.18)
FAT = mat("plaster", 1.05)
HAM = mat("terracotta", 0.85)


def build(ctx):
    v = ctx.vox()  # 32 × 40
    seed = 101
    P.yard(v, 0, 0, 32, 40, "dirt", seed=seed)
    P.yard(v, 0, 26, 32, 40, "paved", seed=seed)
    # Hall: stone ground floor, framed plaster upper storey, steep thatch.
    b = P.building(v, 13, 8, 31, 22, "citizen", along="x", upper=PLASTER, seed=seed, spacing=4, kind="thatch", rise=1.4, height=15)
    f, F = b.face("y+"), b.face("y+", upper=True)
    # The shop hatch: a wide opening with a counter of cuts and hams hanging above.
    for a in range(15, 23):
        for z in range(3, 7):
            f.put(a, z, TIMBER_DARK)
    v.box(15, 22, 2, 23, 24, 3, TIMBER_LIGHT)
    for x in range(15, 23, 2):
        v.set(x, 22, 3, MEAT if x % 4 else FAT)
    V.hanging(v, 16, 23, 22, 7, [(HAM, 2), (MEAT, 2)], every=2)
    v.box(15, 22, 7, 23, 23, 8, TIMBER_DARK)  # hook rail
    V.face_awning(f, 14, 24, 8, depth=2, stripes=(mat("terracotta", 1.0), CANVAS))
    P.entrance(f, 25, 2, 3, 5)
    P.casement(F, 17, 10, 2, 3, frame=None, sill=TIMBER_LIGHT, shutters=TIMBER)
    P.casement(F, 26, 10, 2, 3, frame=None, sill=TIMBER_LIGHT, shutters=TIMBER)
    P.casement(b.face("x+"), 15, 3, 2, 3, frame=P.DRESSED, sill=P.DRESSED)
    P.casement(b.face("x-", upper=True), 15, 10, 2, 3, frame=None, sill=TIMBER_LIGHT)
    V.signboard(f, 28, 7, w=2, h=2, colour=MEAT)
    # Smoking shed against the hall's west wall: posts, thatch, a smoke louvre, sides of meat in rows.
    P.lean_to(v, 1, 13, 6, 24, 11, "thatch", down="x-", posts=True, seed=seed)
    v.box(1, 6, 1, 13, 7, 4, STONE_DARK)  # low back wall
    for y in (10, 14, 18, 22):
        v.box(2, y, 9, 12, y + 1, 10, TIMBER_DARK)
        V.hanging(v, 3, 12, y, 9, [(MEAT, 4), (FAT, 3), (HAM, 3)], every=2)
    v.box(4, 12, 1, 10, 18, 2, STONE_DARK)  # the smoke pit
    v.box(5, 13, 1, 9, 17, 2, mat("iron", 0.6))
    v.box(8, 13, 13, 12, 17, 15, THATCH_DARK)  # louvre high on the roof
    v.box(9, 14, 15, 11, 16, 16, TIMBER_DARK)
    v.anchor("chimney", 10, 15, 15)
    v.anchor("smoke", 10, 15, 16)
    # Back yard: scalding tub, woodpile; front: chopping block, salt casks, cart.
    V.vat(v, 20, 4, 1, r=2.5, h=3, liquid=mat("shallows", 0.9))
    P.woodpile(v, 24, 2, 1, length=7, along="x", rows=2)
    P.chopping_block(v, 4, 28)
    for x in (8, 11):
        P.cask(v, x, 27, 1, lid=FAT)
    P.handcart(v, 15, 30, 1, along="x", load=MEAT)
    P.sacks(v, 24, 27, 1, n=2, m=CANVAS)
    P.lamp_post(v, 29, 28)
    v.anchor("cart", 9, 36, 1)
    P.scatter(v, 0, 0, 32, 26, 0.015, seed=seed, kinds=("pebble", "tuft"))
    return P.colour_jitter(v, seed=seed)

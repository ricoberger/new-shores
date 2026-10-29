"""
Quartz quarry (3 × 8, on a quartz deposit; D-057 §3, V5): a pale
crystalline cut stepping up toward the back — terraces of milky quartz in
courses over warm rock, clusters of pointed crystals on the treads — a
timber hoist with a block on the hook, an open sorting shed with crates
of crystals on its tables, a cutter's hut of ashlar with tiles, sorted
crystal piles and a cart.
"""

from nsvoxel import detail_v5 as Q
from nsvoxel import parts as P
from nsvoxel.grid import hash3, mat
from nsvoxel.mats import IRON, ROCK, ROCK_DEEP, ROCK_LIGHT, TIMBER, TIMBER_LIGHT

ROOF = mat("terracotta", 1.06)


def crystal(v, x, y, z, h):
    """A pointed crystal: a 2 × 2 shaft, a 1-voxel point, the shaded side facing −x."""
    for k in range(h):
        v.set(x, y, z + k, Q.QUARTZ_SHADE)
        v.set(x + 1, y, z + k, Q.QUARTZ)
        if k < h - 1:
            v.set(x, y + 1, z + k, Q.QUARTZ_SHADE)
            v.set(x + 1, y + 1, z + k, Q.QUARTZ)
    v.set(x + 1, y, z + h, Q.QUARTZ)


def build(ctx):
    v = ctx.vox()  # 24 × 64
    seed = 87
    P.yard(v, 0, 0, 24, 64, "dirt", seed=seed)
    # The cut: terraces stepping up toward the back, quartz courses over rock.
    for y in range(0, 28):
        h = 2 + (28 - y) // 3
        for x in range(24):
            hh = h + (1 if hash3(x // 3, y // 3, 1, seed) < 0.2 and y < 6 else 0)
            for z in range(hh):
                if z >= hh - 3 and y % 7 < 5:
                    m = Q.QUARTZ if (z % 2 == 0) else Q.QUARTZ_SHADE
                else:
                    m = ROCK if (z // 2) % 2 else ROCK_DEEP
                v.set(x, y, z, m)
            v.set(x, y, hh - 1, ROCK_LIGHT if y % 7 >= 5 else Q.QUARTZ)
    # Crystal clusters on the treads.
    for x, y, h in ((3, 22, 3), (6, 23, 2), (15, 15, 4), (18, 16, 2), (8, 8, 3), (11, 9, 4), (20, 3, 3)):
        crystal(v, x, y, 2 + (28 - y) // 3, h)
    for x, y in ((4, 29), (5, 30), (17, 29), (11, 30)):
        v.set(x, y, 1, Q.QUARTZ)
    # Hoist: an A-frame with a beam and a block of quartz on the hook.
    for x in (6, 12):
        v.line((x, 30, 1), (9, 25, 14), TIMBER)
    v.box(9, 22, 14, 10, 28, 15, TIMBER_LIGHT)
    for z in range(10, 14):
        v.set(9, 22, z, IRON)
    v.box(8, 21, 8, 11, 23, 10, Q.QUARTZ)
    # Sorting shed: a lean-to on posts over tables with crates of crystals.
    P.lean_to(v, 2, 12, 33, 43, 8, "tiles", down="x-", m=ROOF, seed=seed)
    for y in (35, 39):
        v.box(3, y, 1, 11, y + 2, 3, TIMBER_LIGHT)
        for x in (4, 8):
            P.box_crate(v, x, y, 3, contents=Q.QUARTZ)
    # Cutter's hut: ashlar, tiles.
    b = P.building(v, 13, 44, 23, 56, "stone", along="y", height=10, roof=ROOF, seed=seed)
    P.entrance(b.face("x-"), 49, 2, 3, 5)
    Q.window(b.face("y+"), 17, 5, 2, 3, hood="key", surround=True)
    P.trade_sign(b.face("x-"), 47, 7, Q.QUARTZ)
    # Sorted piles, cart.
    Q.heap(v, 5, 50, 3.0, 3.0, 2.5, lambda x, y, z: Q.QUARTZ if z % 2 else Q.QUARTZ_SHADE)
    P.stone_blocks(v, 2, 56, 1, n=3, m=mat("foam", 0.92), seed=seed)
    P.handcart(v, 15, 33, 1, along="y", load=Q.QUARTZ)
    v.anchor("cart", 8, 61, 1)
    P.scatter(v, 0, 28, 24, 64, 0.02, seed=seed, kinds=("pebble", "pebble", "tuft"))
    return P.colour_jitter(v, seed=seed)

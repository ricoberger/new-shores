"""Windmill (4 × 6): tapered stone tower with a thatched cap and four lattice sails, a miller's cottage with chimney, sacks of flour."""

from nsvoxel import parts as P
from nsvoxel.mats import CANVAS, PLASTER, STONE, STONE_LIGHT, THATCH, THATCH_DARK, TIMBER, TIMBER_DARK, TIMBER_LIGHT

SAIL = P.mat("canvas", 1.0)


def build(ctx):
    v = ctx.vox()  # 32 × 48
    P.yard(v, 0, 0, 32, 48, "grass", seed=52)
    P.path(v, [(x, y) for x in range(14, 18) for y in range(20, 48)])
    # Tower: a stack of shrinking cylinders.
    cx, cy = 16, 12
    r = 7.0
    z = 1
    for k in range(6):
        v.cyl(cx, cy, z, z + 4, r, STONE_LIGHT if k % 2 else STONE)
        z += 4
        r -= 0.6
    # Cap.
    for k in range(5):
        v.cyl(cx, cy, z + k, z + k + 1, 5.5 - k, THATCH if k % 2 == 0 else THATCH_DARK)
    hub_z = z + 1
    P.door(P.Face(v, "y+", 18), 15, 1, 3, 5)
    P.window(P.Face(v, "y+", 17), 15, 11, 2, 2, sill=False)
    # Sails on the front: hub, four arms with lattice canvas.
    hy = 19
    v.box(15, hy - 1, hub_z - 1, 18, hy + 1, hub_z + 2, TIMBER_DARK)
    for dx, dz in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        for k in range(2, 15):
            x = 16 + dx * k
            zz = hub_z + dz * k
            v.set(x, hy, zz, TIMBER)
            for w in range(1, 4):
                # Lattice: canvas on one side of each arm.
                px, pz = (x, zz + w) if dx else (16 - w if dz > 0 else 16 + w, zz)
                if k > 3:
                    v.set(px, hy, pz, SAIL if (k + w) % 2 else CANVAS if k % 3 else TIMBER_LIGHT)
    # Miller's cottage.
    top = P.house(v, 2, 30, 14, 42, "settler", along="y", wall=PLASTER, seed=52)
    P.door(P.Face(v, "y+", 41), 6, 2, 3, 5)
    P.window(P.Face(v, "x+", 13), 34, 4, 2, 2)
    P.smoke(v, 4, 33, 1, top - 3)
    for x, y in ((20, 30), (22, 30), (20, 32), (24, 31)):
        P.sack(v, x, y, 1, m=CANVAS)
    v.anchor("cart", 24, 44, 1)
    return v.jitter(0.03, roles={"stone", "plaster"}, cell=2, seed=52)

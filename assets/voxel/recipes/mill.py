"""
Windmill (4 × 6; D-057 §3): a tapered tower of coursed stone in
alternating bands with a thatched cap, a gallery and four lattice sails;
a miller's cottage (pegged frame, thatch, chimney with smoke), flour
sacks, a cart of grain and a fenced kitchen garden.
"""

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
    P.entrance(P.Face(v, "y+", 18), 15, 2, 3, 5)
    P.casement(P.Face(v, "y+", 17), 15, 11, 2, 2, frame=P.DRESSED, sill=P.DRESSED, bars=False)
    # Gallery round the tower under the cap.
    v.cyl(cx, cy, z - 1, z, r + 1.6, TIMBER_DARK)
    v.cyl(cx, cy, z - 1, z, r + 0.4, None)
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
    b = P.building(v, 2, 30, 14, 42, "settler", along="y", wall=PLASTER, seed=52, spacing=5)
    P.entrance(b.face("y+"), 6, 2, 3, 5)
    P.casement(b.face("x+"), 34, 5, 2, 2, frame=None, sill=TIMBER_LIGHT, shutters=TIMBER_LIGHT, bars=False)
    P.casement(b.face("y+"), 10, 5, 2, 2, frame=None, sill=TIMBER_LIGHT, bars=False)
    P.roof_chimney(v, b.roof, 4, 34, above=3, anchor=True)
    P.sacks(v, 20, 30, 1, n=3, m=CANVAS)
    P.sacks(v, 20, 32, 1, n=2, m=CANVAS)
    P.sacks(v, 21, 30, 3, n=1, m=CANVAS)
    P.handcart(v, 20, 38, 1, along="x", load=P.mat("wheat"))
    P.fence_ring(v, 18, 22, 30, 28, kind="picket", gaps={(23, 27), (24, 27)}, seed=52)
    P.crop_rows(v, 19, 23, 29, 27, "cabbage", along="x", pitch=2, seed=52)
    v.anchor("cart", 24, 44, 1)
    P.scatter(v, 0, 20, 32, 48, 0.03, seed=52)
    return P.colour_jitter(v, seed=52)

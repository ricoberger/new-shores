"""
Market place (5 × 6, four levels; D-057 §3, D-065; V7 rework after the
Anno 1404 marketplaces): one open square with a ring of striped canvas
stalls (gabled and lean-to tents on timber posts, counters with goods,
crates, casks and sacks) round a fountain, lamp posts with brass-and-glass
lanterns at the corners and benches. Only the ground and the fountain show
the level: levels 1 and 2 stand on dirt, 3 and 4 on cobbles; level 1 a
spring in a ring of boulders, level 2 a dressed octagonal basin with a
pillar and bowl, level 3 a round stepped basin with a column and a brass
finial, level 4 a quatrefoil basin under a tall column with a brass statue.
"""

from nsvoxel import parts as P
from nsvoxel.grid import hash3, mat, shade_of
from nsvoxel.mats import BRASS, CANVAS, IRON, PLANK, STONE, STONE_DARK, STONE_LIGHT, TIMBER, TIMBER_DARK, TIMBER_LIGHT, WHEAT, APPLE, WINDOW

VOXELS_PER_TILE = 12
LEVELS = 4
GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

BLUE = mat("dye-blue")
RED = mat("terracotta")
OCHRE_C = mat("ochre")
WATER = mat("shallows")
GOODS = (WHEAT, APPLE, mat("orchard"), mat("canvas", 0.9), mat("timber", 1.4), mat("terracotta", 1.2))

#: (roof colour a, roof colour b, shape) per stall: striped gabled tents and lean-tos.
TENTS = (
    (RED, CANVAS, "gable"),
    (BLUE, CANVAS, "gable"),
    (OCHRE_C, CANVAS, "lean"),
    (CANVAS, mat("canvas", 0.78), "gable"),
    (RED, CANVAS, "lean"),
    (BLUE, mat("canvas", 0.78), "lean"),
)


def tent(v, x, y, k, face="y+", w=12, d=9):
    """
    A stall of w × d voxels: four posts, a counter with goods at the open
    front, a cloth back and a canvas roof (striped gable or lean-to). The
    front looks to `face`; (x, y) is the corner of the footprint.
    """
    ca, cb, shape = TENTS[k % len(TENTS)]
    ww, dd = (w, d) if face in ("y+", "y-") else (d, w)

    def at(u, t, z, m):
        # u along the width, t from the back (0) to the front (d - 1).
        if face == "y+":
            v.set(x + u, y + t, z, m)
        elif face == "y-":
            v.set(x + u, y + dd - 1 - t, z, m)
        elif face == "x+":
            v.set(x + t, y + u, z, m)
        else:
            v.set(x + ww - 1 - t, y + u, z, m)

    hb, hf = (8, 7) if shape == "gable" else (11, 7)
    for u, t, top in ((0, 0, hb), (w - 1, 0, hb), (0, d - 1, hf), (w - 1, d - 1, hf)):
        for z in range(1, top):
            at(u, t, z, TIMBER)
    for u in range(1, w - 1):  # cloth back
        for z in range(2, hb - 1):
            at(u, 0, z, mat("canvas", 0.82))
    for u in range(1, w - 1):  # counter and goods
        for z in (1, 2):
            at(u, d - 2, z, TIMBER_LIGHT)
        at(u, d - 2, 3, GOODS[(k + u // 2) % len(GOODS)] if u % 3 else PLANK)
        at(u, d - 3, 1, TIMBER_LIGHT if u % 4 == 0 else GOODS[(k + u) % len(GOODS)])
    mid = (d - 1) // 2
    for t in range(-1, d + 1):
        z = 13 - abs(t - mid) if shape == "gable" else 12 - (t + 1) * 5 // 10
        for u in range(-1, w + 1):
            at(u, t, z, ca if (u // 2) % 2 == 0 else cb)
    # Gable stalls: a hanging cloth fringe over the counter, in the stripe colours.
    zr = 13 - abs(d - mid) if shape == "gable" else 12 - (d + 1) * 5 // 10
    for u in range(0, w, 2):
        for z in range(hf - 1, zr):
            at(u, d, z, ca)


def fountain(v, cx, cy, lv):
    z = 1

    def disc(r, z0, z1, m, hole=None):
        for x in range(cx - r - 1, cx + r + 2):
            for y in range(cy - r - 1, cy + r + 2):
                dd = (x - cx) ** 2 + (y - cy) ** 2
                if dd <= r * r + r and (hole is None or dd > hole * hole + hole):
                    for zz in range(z0, z1):
                        v.set(x, y, zz, shade_of(m, 0.94 + 0.12 * hash3(x, y, zz, 9)))

    def water(r, zz):
        for x in range(cx - r, cx + r + 1):
            for y in range(cy - r, cy + r + 1):
                if (x - cx) ** 2 + (y - cy) ** 2 <= r * r + r:
                    v.set(x, y, zz, WATER)

    if lv == 1:
        # A spring in a ring of rough boulders.
        for i in range(14):
            import math

            a = i * 2 * math.pi / 14
            bx, by = round(cx + 6 * math.cos(a)), round(cy + 5 * math.sin(a))
            hh = 2 + hash3(i, 3, 5, 7) * 1.8
            v.box(bx - 1, by - 1, z, bx + 1, by + 1, z + int(hh), shade_of(STONE, 0.9 + 0.2 * hash3(i, 1, 2, 3)))
            if i % 3 == 0:
                v.set(bx, by, z + int(hh), STONE_LIGHT)
        water(4, z)
        v.set(cx, cy, z + 1, STONE)
    elif lv == 2:
        # A dressed octagonal basin with a pillar and a bowl.
        r = 7
        for x in range(cx - r, cx + r + 1):
            for y in range(cy - r, cy + r + 1):
                dx, dy = abs(x - cx), abs(y - cy)
                if dx + dy <= r + 3 and max(dx, dy) <= r:
                    inner = dx + dy <= r + 1 and max(dx, dy) <= r - 2
                    if inner:
                        v.set(x, y, z, WATER)
                    else:
                        for zz in range(z, z + 3):
                            v.set(x, y, zz, shade_of(STONE, 1.08 if zz == z + 2 else 0.98))
        v.box(cx - 1, cy - 1, z, cx + 1, cy + 1, z + 8, STONE)
        v.box(cx - 2, cy - 2, z + 8, cx + 2, cy + 2, z + 9, STONE_LIGHT)
        v.box(cx - 2, cy - 2, z + 9, cx + 2, cy + 2, z + 10, STONE)
        v.box(cx - 1, cy - 1, z + 9, cx + 1, cy + 1, z + 10, WATER)
    elif lv == 3:
        # A round stepped basin with a column, a bowl and a brass finial.
        disc(9, z, z + 1, STONE_DARK)
        disc(7, z + 1, z + 3, STONE_LIGHT, hole=5)
        water(5, z + 1)
        v.box(cx - 1, cy - 1, z + 1, cx + 1, cy + 1, z + 11, STONE)
        disc(3, z + 11, z + 12, STONE_LIGHT)
        disc(3, z + 12, z + 13, STONE, hole=2)
        v.box(cx - 1, cy - 1, z + 12, cx + 1, cy + 1, z + 13, WATER)
        v.box(cx - 1, cy - 1, z + 13, cx + 1, cy + 1, z + 14, STONE_LIGHT)
        v.box(cx - 1, cy - 1, z + 14, cx + 1, cy + 1, z + 16, BRASS)
    else:
        # A quatrefoil basin under a tall column with two bowls and a brass statue.
        lobes = ((cx - 4, cy), (cx + 4, cy), (cx, cy - 4), (cx, cy + 4), (cx, cy))
        for x in range(cx - 10, cx + 11):
            for y in range(cy - 10, cy + 11):
                d2 = min((x - lx) ** 2 + (y - ly) ** 2 for lx, ly in lobes)
                if d2 <= 25:
                    v.set(x, y, z, shade_of(STONE_DARK, 1.0))
                if d2 <= 25 and d2 > 12:
                    for zz in range(z + 1, z + 3):
                        v.set(x, y, zz, shade_of(STONE_LIGHT, 0.95 + 0.1 * (zz - z - 1)))
                elif d2 <= 12:
                    v.set(x, y, z + 1, WATER)
        v.box(cx - 2, cy - 2, z + 1, cx + 2, cy + 2, z + 4, STONE)
        v.box(cx - 1, cy - 1, z + 4, cx + 1, cy + 1, z + 12, STONE_LIGHT)
        disc(3, z + 8, z + 9, STONE)
        disc(3, z + 9, z + 10, STONE_LIGHT, hole=2)
        v.box(cx - 2, cy - 2, z + 12, cx + 2, cy + 2, z + 14, STONE)
        # The statue: boots, body, head and a raised arm.
        v.box(cx - 1, cy - 1, z + 14, cx + 1, cy + 1, z + 17, BRASS)
        v.box(cx - 1, cy - 1, z + 17, cx + 1, cy + 1, z + 20, shade_of(BRASS, 1.15))
        v.box(cx - 1, cy - 1, z + 20, cx + 1, cy + 1, z + 22, BRASS)
        v.box(cx + 1, cy - 1, z + 19, cx + 2, cy, z + 24, BRASS)


def lamp(v, x, y, z=1):
    """A lamp post: a timber post with a lantern head of brass corners and window glass."""
    v.box(x, y, z, x + 1, y + 1, z + 5, TIMBER_DARK)
    v.box(x - 1, y - 1, z + 5, x + 2, y + 2, z + 6, BRASS)
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            v.set(x + dx, y + dy, z + 6, BRASS if dx and dy else WINDOW)
    v.box(x - 1, y - 1, z + 7, x + 2, y + 2, z + 8, BRASS)
    v.set(x, y, z + 8, IRON)


def build(ctx):
    v = ctx.vox()
    lv = ctx.level
    seed = 50 + lv
    W, D = ctx.W, ctx.D  # 60 × 72
    P.yard(v, 0, 0, W, D, "dirt" if lv <= 2 else "paved", seed=seed)
    cx, cy = W // 2, D // 2 + 2
    fountain(v, cx, cy, lv)
    stalls = (
        [(5, 4, "y+"), (20, 4, "y+"), (36, 4, "y+")]
        + [(4, 22, "x+"), (4, 36, "x+"), (4, 50, "x+")]
        + [(47, 20, "x-"), (47, 34, "x-")]
        + [(17, 59, "y-"), (32, 59, "y-"), (46, 59, "y-")]
    )
    for k, (x, y, f) in enumerate(stalls):
        tent(v, x, y, k, f)
    for x, y in ((2, 2), (W - 3, 2), (2, D - 3), (W - 3, D - 3)):
        lamp(v, x, y)
    P.bench(v, cx - 12, cy - 1, 1, 5, "y")
    P.bench(v, cx + 9, cy - 4, 1, 5, "y")
    P.box_crate(v, 18, 17, 1, contents=GOODS[0])
    P.cask(v, 22, 18, 1)
    P.sacks(v, 44, 17, 1, n=2)
    P.cask(v, 44, 49, 1)
    P.box_crate(v, 40, 56, 1, contents=GOODS[2])
    P.sacks(v, 14, 55, 1, n=2)
    P.handcart(v, 40, 46, 1, along="x", load=WHEAT) if lv < 3 else None
    return P.colour_jitter(v, seed=seed)

"""
Cathedral (12 × 16; D-057 §3, V5): a Gothic cathedral of pale ashlar in
courses facing the forecourt (+y). The west front: two square towers in
four stages with paired lancet belfries, cornices and steep pyramid
spires with brass finials, between them the nave gable with a great rose
window over a deep stepped portal. The nave with its clerestory of
lancets rises over lower aisles with lean-to roofs and stepped
buttresses; the transept crosses it with a rose window in each gable
end; a slender flèche stands on the crossing; the choir closes the east
end, lower, with tall lancets. Roofs are dark slate (D-063: never
terracotta-only). A paved forecourt with steps, lamps, benches, trees,
flower beds and a low wall with gate piers. 12 voxels per tile (D-078
step 6): three-light lancets with tracery heads, buttresses on both
flanks, a rose window in both transept ends, a stepped and pointed portal
with jamb shafts and a statue gallery, pinnacles on the towers.
"""

from nsvoxel import detail_v5 as Q
from nsvoxel import parts as P
from nsvoxel.grid import mat
from nsvoxel.mats import BRASS, FOREST, TIMBER, TIMBER_DARK

VOXELS_PER_TILE = 12

ROOF = mat("slate", 0.8)  # slate and lead over pale stone: Gothic/Hanse (D-063), not terracotta
GLASS = mat("dye-blue", 0.85)
WALL = Q.ASHLAR
PLINTH = mat("stone", 0.84)
SHADES = (1.06, 0.9)

GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)


def lancet3(f, a, z, h, glass=GLASS):
    """A three-light Gothic window five voxels wide: a lancet with a central mullion and a quatrefoil-like dot in its head."""
    Q.lancet(f, a, z, 5, h, glass=glass)
    for j in range(h - 3):
        f.put(a + 2, z + j, Q.DRESSED, out=-1)
    f.put(a + 2, z + h - 2, Q.DRESSED, out=-1)


def pinnacle(v, x, y, z, h=6):
    """A small pinnacle: a dressed shaft two voxels square and a slate spike with a brass tip."""
    v.box(x, y, z, x + 2, y + 2, z + h, Q.DRESSED)
    v.box(x, y, z + h, x + 2, y + 2, z + h + 2, ROOF)
    v.set(x, y, z + h + 2, BRASS)


def yew(v, x, y, seed=0):
    """A churchyard conifer: a short trunk and stepped crown discs."""
    v.box(x, y, 1, x + 1, y + 1, 4, TIMBER)
    zz, r = 3, 4
    while r >= 1:
        for dx in range(-r, r + 1):
            for dy in range(-r, r + 1):
                if abs(dx) + abs(dy) <= r + 1:
                    v.box(x + dx, y + dy, zz, x + dx + 1, y + dy + 1, zz + 3, P.shade_of(FOREST, 1.0 + 0.07 * (4 - r)))
        zz += 3
        r -= 1


def build(ctx):
    v = ctx.vox()  # 144 × 192
    seed = 133
    P.yard(v, 0, 0, 144, 192, "grass", seed=seed)
    P.yard(v, 6, 156, 138, 192, "paved", seed=seed)
    # Nave (x 51..93) with aisles (x 36..51, 93..108) from y 33 to 147.
    nx0, nx1, ny0, ny1 = 51, 93, 33, 147
    P.plinth(v, 36, ny0, 108, ny1, 1, PLINTH, out=0)
    Q.ashlar(v, nx0, ny0, nx1, ny1, 1, 51)
    Q.cornice(v, nx0, ny0, nx1, ny1, 51)
    nave = P.roof(v, nx0, nx1, ny0, ny1, 52, "tiles", along="y", rise=1.2, m=ROOF, gable=WALL, seed=seed, eaves=False, shades=SHADES)
    for ax0, ax1, down in ((36, 51, "x-"), (93, 108, "x+")):
        Q.ashlar(v, ax0, ny0 + 3, ax1, ny1 - 9, 1, 24)
        P.lean_to(v, ax0, ax1, ny0 + 3, ny1 - 9, 25, "tiles", down=down, m=ROOF, posts=False, seed=seed)
    for side, aisle, wall in (("x-", 36, nx0), ("x+", 107, nx1 - 1)):
        fw = P.Face(v, side, aisle)
        fn = P.Face(v, side, wall)
        for a in range(42, 136, 12):
            if 60 <= a <= 87:
                continue
            Q.lancet(fw, a, 6, 3, 12, glass=GLASS)
            lancet3(fn, a - 1, 30, 15)
            Q.buttress(v, aisle, a - 5, 1, 25, side, w=2, depth=4)
            Q.buttress(v, wall, a - 5, 27, 50, side, w=2, depth=3)
            # The flying buttress: a sloping arm from the aisle buttress up to the clerestory.
            d = -1 if side == "x-" else 1
            for k in range(1, 15):
                v.set(wall + d * k, a - 5, 47 - k, Q.DRESSED)
                v.set(wall + d * k, a - 4, 47 - k, Q.DRESSED)
            pinnacle(v, aisle + d * 3 - (1 if d > 0 else 0), a - 5, 26, h=5)
    # Transept (x 15..129, y 63..87) with a rose window in each end.
    tx0, tx1, ty0, ty1 = 15, 129, 63, 87
    P.plinth(v, tx0, ty0, tx1, ty1, 1, PLINTH, out=0)
    Q.ashlar(v, tx0, ty0, tx1, ty1, 1, 51)
    Q.cornice(v, tx0, ty0, tx1, ty1, 51)
    tr = P.roof(v, tx0, tx1, ty0, ty1, 52, "tiles", along="x", rise=1.2, m=ROOF, gable=WALL, seed=seed, eaves=False, shades=SHADES)
    for side, plane in (("x-", tx0), ("x+", tx1 - 1)):
        fe = P.Face(v, side, plane)
        Q.rose_window(fe, 75, 37, r=7, glass=GLASS)
        for a in (66, 80):
            Q.lancet(fe, a, 6, 3, 18, glass=GLASS)
        P.entrance(fe, 73, 2, 5, 10, leaf=TIMBER_DARK, frame=Q.DRESSED, lintel=Q.DRESSED)
        for y in (ty0, ty1 - 2):
            Q.buttress(v, plane, y, 1, 49, side, w=2, depth=4)
            pinnacle(v, plane + (-3 if side == "x-" else 2), y, 50, h=6)
    ft = P.Face(v, "y+", ty1 - 1)
    for a in (20, 30, 112, 122):
        Q.lancet(ft, a, 9, 3, 18, glass=GLASS)
    # Flèche on the crossing.
    cx, cy, cz = 72, 75, max(nave.ridge_z, tr.ridge_z)
    v.box(cx - 3, cy - 3, cz - 3, cx + 3, cy + 3, cz + 9, Q.DRESSED)
    for x, y in ((cx - 3, cy - 3), (cx + 2, cy - 3), (cx - 3, cy + 2), (cx + 2, cy + 2)):
        v.box(x, y, cz + 9, x + 1, y + 1, cz + 17, Q.DRESSED)
    for zz in (cz + 11, cz + 13, cz + 15):  # louvres between the posts
        for a in range(-2, 2):
            for x, y in ((cx + a, cy - 3), (cx + a, cy + 2), (cx - 3, cy + a), (cx + 2, cy + a)):
                v.set(x, y, zz, TIMBER_DARK)
    fr = P.roof(v, cx - 3, cx + 3, cy - 3, cy + 3, cz + 17, "tiles", hip=True, rise=4.0, m=ROOF, seed=seed, eaves=False)
    Q.finial(v, cx, cy, fr.top, BRASS, h=4)
    # Choir: lower, narrower, tall lancets.
    P.plinth(v, 54, 9, 90, 33, 1, PLINTH, out=0)
    Q.ashlar(v, 54, 9, 90, 33, 1, 42)
    Q.cornice(v, 54, 9, 90, 33, 42)
    P.roof(v, 54, 90, 9, 33, 43, "tiles", along="y", rise=1.2, m=ROOF, gable=WALL, seed=seed, eaves=False, hip=True, shades=SHADES)
    for side, plane in (("x-", 54), ("x+", 89)):
        for a in (14, 23):
            lancet3(P.Face(v, side, plane), a - 1, 9, 21)
            Q.buttress(v, plane, a + 5, 1, 40, side, w=2, depth=3)
    lancet3(P.Face(v, "y-", 9), 70, 9, 21)
    # West front: two towers and the gable with the rose window.
    for x0 in (27, 96):
        x1 = x0 + 21
        y0, y1 = 135, 156
        P.plinth(v, x0, y0, x1, y1, 1, PLINTH, out=0)
        Q.ashlar(v, x0, y0, x1, y1, 1, 93)
        for z in (27, 51, 72):
            Q.string_course(v, x0, y0, x1, y1, z)
        Q.cornice(v, x0, y0, x1, y1, 93)
        r = P.roof(v, x0, x1, y0, y1, 94, "tiles", hip=True, rise=3.6, m=ROOF, seed=seed, eaves=False, shades=SHADES)
        Q.finial(v, (x0 + x1) // 2, (y0 + y1) // 2, r.top, BRASS, h=4)
        for px, py in ((x0 - 1, y0 - 1), (x1 - 1, y0 - 1), (x0 - 1, y1 - 1), (x1 - 1, y1 - 1)):
            pinnacle(v, px, py, 94, h=7)
        for side, plane in (("y+", y1 - 1), ("x-", x0), ("x+", x1 - 1)):
            f = P.Face(v, side, plane)
            lo = x0 if side == "y+" else y0
            Q.lancet(f, lo + 9, 9, 3, 13, glass=GLASS)
            Q.lancet(f, lo + 9, 33, 3, 13, glass=GLASS)
            Q.lancet(f, lo + 5, 76, 3, 12, glass=TIMBER_DARK)
            Q.lancet(f, lo + 13, 76, 3, 12, glass=TIMBER_DARK)
            lancet3(f, lo + 8, 55, 11)
        for x, y in ((x0, y1), (x1 - 2, y1)):
            Q.buttress(v, x, y - 1, 1, 69, "y+", w=2, depth=4)
    # The front gable between the towers.
    ff = P.Face(v, "y+", 155)
    Q.ashlar(v, 48, 147, 96, 156, 1, 54)
    Q.cornice(v, 48, 147, 96, 156, 54)
    P.roof(v, 48, 96, 147, 156, 55, "tiles", along="x", rise=1.0, m=ROOF, gable=WALL, seed=seed, eaves=False, shades=SHADES)
    Q.rose_window(ff, 72, 37, r=10, glass=GLASS)
    for k in range(4):  # the stepped portal with a pointed head
        hk = 21 - k
        for i in range(-6 + k, 6 - k):
            half = 6 - k
            off = abs(i + 0.5)
            hj = hk - max(0, int(off - (half - 4)) * 2) if off > half - 4 else hk
            for j in range(hj):
                ff.put(72 + i, 2 + j, None, out=-k)
        for j in range(hk - 4):
            ff.put(72 - 7 + k, 2 + j, Q.DRESSED, out=-k)
            ff.put(72 + 6 - k, 2 + j, Q.DRESSED, out=-k)
    P.entrance(P.Face(v, "y+", 151), 69, 2, 6, 14, leaf=TIMBER_DARK, frame=Q.DRESSED, lintel=Q.DRESSED, step=None)
    for a in (53, 88):
        Q.lancet(ff, a, 9, 3, 15, glass=GLASS)
    for i in range(-12, 13, 3):  # a gallery of statue niches over the portal
        ff.put(72 + i, 28, Q.DRESSED, out=1)
        ff.put(72 + i, 29, Q.DRESSED, out=1)
        ff.put(72 + i, 30, Q.DRESSED, out=1)
    for i in range(-13, 14):
        ff.put(72 + i, 27, Q.DRESSED, out=1)  # the gallery's ledge
    # Forecourt.
    for k in range(3):
        v.box(54 - k * 3, 156 + k * 3, 0, 90 + k * 3, 159 + k * 3, 1, Q.DRESSED)
    for x in (45, 99):
        P.lamp_post(v, x, 168, h=13)
    for x in (18, 114):
        P.bench(v, x, 174, 1, 12)
        P.fruit_tree(v, x + 6, 183, 1, seed=seed + x, crown=mat("tree-crown"), fruit=None, trunk=6, r=4)
    P.flower_bed(v, 12, 162, 39, 166, seed=seed)
    P.flower_bed(v, 105, 162, 132, 166, seed=seed + 1)
    for x in range(6, 138):
        if 60 <= x < 84:
            continue
        v.set(x, 189, 1, mat("stone", 0.9))
        v.set(x, 189, 2, mat("stone", 0.9))
        if x % 3 == 0:
            v.set(x, 189, 3, mat("stone", 0.9))
    for x in (57, 84):
        v.box(x, 187, 1, x + 3, 190, 9, Q.DRESSED)
        v.box(x, 187, 9, x + 3, 190, 10, mat("stone", 0.9))
        v.set(x + 1, 188, 10, BRASS)
    # Churchyard trees along the east end.
    for x, y in ((21, 21), (36, 12), (117, 18), (129, 39)):
        yew(v, x, y, seed=seed + x + y)
    return P.colour_jitter(v, seed=seed)

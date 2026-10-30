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
flower beds and a low wall with gate piers.
"""

from nsvoxel import detail_v5 as Q
from nsvoxel import parts as P
from nsvoxel.grid import mat
from nsvoxel.mats import BRASS, TIMBER_DARK

ROOF = mat("slate", 0.8)  # slate and lead over pale stone: Gothic/Hanse (D-063), not terracotta
GLASS = mat("dye-blue", 0.85)
WALL = Q.ASHLAR


def build(ctx):
    v = ctx.vox()  # 96 × 128
    seed = 133
    P.yard(v, 0, 0, 96, 128, "grass", seed=seed)
    P.yard(v, 4, 104, 92, 128, "paved", seed=seed)
    # Nave (x 34..62) with aisles (x 24..34, 62..72) from y 22 to 98.
    nx0, nx1, ny0, ny1 = 34, 62, 22, 98
    P.plinth(v, 24, ny0, 72, ny1, 1, mat("stone", 0.84), out=1)
    Q.ashlar(v, nx0, ny0, nx1, ny1, 1, 34)
    Q.cornice(v, nx0, ny0, nx1, ny1, 34)
    nave = P.roof(v, nx0, nx1, ny0, ny1, 35, "tiles", along="y", rise=1.2, m=ROOF, gable=WALL, seed=seed, eaves=False)
    for ax0, ax1, down in ((24, 34, "x-"), (62, 72, "x+")):
        Q.ashlar(v, ax0, ny0 + 2, ax1, ny1 - 6, 1, 16)
        P.lean_to(v, ax0, ax1, ny0 + 2, ny1 - 6, 17, "tiles", down=down, m=ROOF, posts=False, seed=seed)
    fw = P.Face(v, "x-", 24)
    fn = P.Face(v, "x-", nx0)
    for a in range(ny0 + 6, ny1 - 8, 8):
        if 42 <= a <= 58:
            continue
        Q.lancet(fw, a, 4, 2, 8, glass=GLASS)
        Q.lancet(fn, a, 21, 2, 9, glass=GLASS)
        Q.buttress(v, 24, a - 3, 1, 17, "x-", w=2, depth=3)
        Q.buttress(v, nx0, a - 3, 18, 33, "x-", w=2, depth=2)
    # Transept (x 10..86, y 42..58) with a rose window in each end.
    tx0, tx1, ty0, ty1 = 10, 86, 42, 58
    P.plinth(v, tx0, ty0, tx1, ty1, 1, mat("stone", 0.84), out=1)
    Q.ashlar(v, tx0, ty0, tx1, ty1, 1, 34)
    Q.cornice(v, tx0, ty0, tx1, ty1, 34)
    tr = P.roof(v, tx0, tx1, ty0, ty1, 35, "tiles", along="x", rise=1.2, m=ROOF, gable=WALL, seed=seed, eaves=False)
    fe = P.Face(v, "x-", tx0)
    Q.rose_window(fe, 50, 25, r=5, glass=GLASS)
    for a in (45, 53):
        Q.lancet(fe, a, 4, 2, 12, glass=GLASS)
    P.entrance(fe, 49, 2, 3, 7, leaf=TIMBER_DARK, frame=Q.DRESSED, lintel=Q.DRESSED)
    for y in (ty0, ty1 - 2):
        Q.buttress(v, tx0, y, 1, 33, "x-", w=2, depth=3)
    ft = P.Face(v, "y+", ty1 - 1)
    for a in (14, 20, 76, 82):
        Q.lancet(ft, a, 6, 2, 12, glass=GLASS)
    # Flèche on the crossing.
    cx, cy, cz = 48, 50, max(nave.ridge_z, tr.ridge_z)
    v.box(cx - 2, cy - 2, cz - 2, cx + 2, cy + 2, cz + 6, Q.DRESSED)
    for x, y in ((cx - 2, cy - 2), (cx + 1, cy - 2), (cx - 2, cy + 1), (cx + 1, cy + 1)):
        v.box(x, y, cz + 6, x + 1, y + 1, cz + 10, Q.DRESSED)
    fr = P.roof(v, cx - 2, cx + 2, cy - 2, cy + 2, cz + 10, "tiles", hip=True, rise=4.0, m=ROOF, seed=seed, eaves=False)
    Q.finial(v, cx, cy, fr.top, BRASS, h=3)
    # Choir: lower, narrower, tall lancets.
    P.plinth(v, 36, 6, 60, 22, 1, mat("stone", 0.84), out=1)
    Q.ashlar(v, 36, 6, 60, 22, 1, 28)
    Q.cornice(v, 36, 6, 60, 22, 28)
    P.roof(v, 36, 60, 6, 22, 29, "tiles", along="y", rise=1.2, m=ROOF, gable=WALL, seed=seed, eaves=False, hip=True)
    for a in (9, 15):
        Q.lancet(P.Face(v, "x-", 36), a, 6, 2, 14, glass=GLASS)
        Q.buttress(v, 36, a + 3, 1, 27, "x-", w=2, depth=2)
    # West front: two towers and the gable with the rose window.
    for x0 in (18, 64):
        x1 = x0 + 14
        y0, y1 = 90, 104
        P.plinth(v, x0, y0, x1, y1, 1, mat("stone", 0.84), out=1)
        Q.ashlar(v, x0, y0, x1, y1, 1, 62)
        for z in (18, 34, 48):
            Q.string_course(v, x0, y0, x1, y1, z)
        Q.cornice(v, x0, y0, x1, y1, 62)
        r = P.roof(v, x0, x1, y0, y1, 63, "tiles", hip=True, rise=3.6, m=ROOF, seed=seed, eaves=False)
        Q.finial(v, (x0 + x1) // 2, (y0 + y1) // 2, r.top, BRASS, h=3)
        for side, plane in (("y+", y1 - 1), ("x-", x0)):
            f = P.Face(v, side, plane)
            lo = x0 if side == "y+" else y0
            Q.lancet(f, lo + 5, 6, 2, 9, glass=GLASS)
            Q.lancet(f, lo + 5, 22, 2, 9, glass=GLASS)
            Q.lancet(f, lo + 4, 51, 2, 8, glass=TIMBER_DARK)
            Q.lancet(f, lo + 8, 51, 2, 8, glass=TIMBER_DARK)
            Q.lancet(f, lo + 5, 37, 3, 7, glass=GLASS)
        for x, y in ((x0, y1), (x1 - 2, y1)):
            Q.buttress(v, x, y - 1, 1, 46, "y+", w=2, depth=3)
    # The front gable between the towers.
    ff = P.Face(v, "y+", 103)
    Q.ashlar(v, 32, 98, 64, 104, 1, 36)
    Q.cornice(v, 32, 98, 64, 104, 36)
    P.roof(v, 32, 64, 98, 104, 37, "tiles", along="x", rise=1.0, m=ROOF, gable=WALL, seed=seed, eaves=False)
    Q.rose_window(ff, 48, 25, r=7, glass=GLASS)
    for k in range(3):  # the stepped portal
        for j in range(14 - k):
            for i in range(-4 + k, 4 - k):
                ff.put(48 + i, 2 + j, None, out=-k)
        for j in range(14 - k):
            ff.put(48 - 5 + k, 2 + j, Q.DRESSED, out=-k)
            ff.put(48 + 4 - k, 2 + j, Q.DRESSED, out=-k)
    P.entrance(P.Face(v, "y+", 100), 46, 2, 4, 10, leaf=TIMBER_DARK, frame=Q.DRESSED, lintel=Q.DRESSED, step=None)
    for a in (36, 58):
        Q.lancet(ff, a, 6, 2, 10, glass=GLASS)
    for i in range(-8, 8, 2):  # a gallery of statue niches over the portal
        ff.put(48 + i, 19, Q.DRESSED, out=1)
    # Forecourt.
    for k in range(3):
        v.box(36 - k * 2, 104 + k * 2, 0, 60 + k * 2, 106 + k * 2, 1, Q.DRESSED)
    for x in (30, 66):
        P.lamp_post(v, x, 112, h=9)
    for x in (12, 76):
        P.bench(v, x, 116, 1, 8)
        P.tree(v, x + 4, 122, 1, kind="broad", seed=seed + x)
    P.flower_bed(v, 8, 108, 26, 111, seed=seed)
    P.flower_bed(v, 70, 108, 88, 111, seed=seed + 1)
    for x in range(4, 92):
        if 40 <= x < 56:
            continue
        v.set(x, 126, 1, mat("stone", 0.9))
        if x % 2 == 0:
            v.set(x, 126, 2, mat("stone", 0.9))
    for x in (38, 56):
        v.box(x, 125, 1, x + 2, 127, 6, Q.DRESSED)
        v.set(x, 125, 6, BRASS)
    # Churchyard trees along the east end.
    for x, y in ((14, 14), (24, 8), (78, 12), (86, 26)):
        P.tree(v, x, y, 1, kind="conifer", seed=seed + x + y)
    return P.colour_jitter(v, seed=seed)

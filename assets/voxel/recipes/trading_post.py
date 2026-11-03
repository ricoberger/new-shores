"""
Trading post (6 × 6, four levels; D-057 §3, D-062, D-065; V7 rework after the
Anno 1404 small warehouse and the warehouse levels): a timber pier on piles
with cross-bracing over the one water row, rope rails at the ends, bollards
at the berths, cargo cranes with a hanging crate, goods on the deck and
tall banner poles (cloth, sway group `flag`), and a storehouse behind the
quay that grows as the warehouse does: 1 a plank barn under weathered
thatch with a hoist and a counting hut, 2 a half-timbered hall on rubble
with a hoist wing under terracotta, 3 the same on a brick-pier arcade under
dark tile, 4 a brick Speicher with cream counting house and flag tower
under slate. Dirt yard at levels 1–2, cobbles at 3–4. The four berth
anchors are the same at every level (the content grows 1–4 berths).
"""

from nsvoxel import detail_v4 as V
from nsvoxel import detail_v5 as Q
from nsvoxel import parts as P
from nsvoxel import parts_v7 as W
from nsvoxel.grid import mat, shade_of
from nsvoxel.mats import CANVAS, IRON, PLANK, SLATE, STONE, STONE_DARK, TERRACOTTA, TIMBER, TIMBER_DARK, TIMBER_LIGHT

VOXELS_PER_TILE = 12
LEVELS = 4
GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

#: The one water row (voxels) the pier stands over; the content allows 1–2 (D-062), the model is one.
WATER = 12
LAND = 24  # the first row of the settled land (ctx.land)
FLAG = mat("dye-blue", 1.0, "flag")
BOARDS = mat("timber", 0.85)
PLINTH = mat("stone", 1.1)
BRICK = mat("brick")
CREAM = mat("plaster", 0.95)
TILE = mat("tile-dark")
TILE_RIDGE = mat("tile-dark", 0.62)
TERRA_RIDGE = mat("terracotta", 0.66)
SLATE_RIDGE = mat("slate", 0.6)
SHADE_TILE = (1.2, 0.84)
SHADE_SLATE = (1.18, 0.8)
BRICK_BAND = shade_of(BRICK, 0.88)
BERTHS = (27, 45, 9, 63)
ASHLAR = mat("stone", 0.95)
COPING = mat("stone", 1.15)
WET = mat("stone", 0.6)


def quay(v, x0, x1):
    """
    The stone quay of levels 3–4 over the water row: a solid ashlar block into
    the sea (courses in two shades, a darker wet band at the waterline as the
    D-060 quays), a paved ashlar deck with a light coping course along the sea
    edge and the ends, iron bollards at the berths and timber fenders on the
    sea face; the quay edge of the land behind as on the pier.
    """
    for z in range(-13, 0):
        m = WET if -6 <= z < -2 else shade_of(ASHLAR, 0.96 if ((z + 13) // 2) % 2 else 0.82)
        v.box(x0, 1, z, x1, WATER, z + 1, m)
    for y in range(1, WATER):
        for x in range(x0, x1):
            edge = y <= 2 or x < x0 + 2 or x >= x1 - 2
            v.set(x, y, 0, COPING if edge else shade_of(ASHLAR, 1.0 if ((x // 6) + (y // 3)) % 2 else 0.9))
    for x in range(x0 + 4, x1 - 4, 9):  # timber fenders on the sea face
        v.box(x, 0, -7, x + 1, 1, 0, TIMBER)
        v.set(x, 0, -8, TIMBER_DARK)
    for x in range(x0, x1):  # the quay edge of the land behind
        v.box(x, WATER, -3, x + 1, WATER + 2, 1, STONE_DARK if x % 4 else STONE)
    for x in (b for b in BERTHS if x0 <= b < x1):  # iron bollards
        v.box(x - 1, 3, 1, x + 1, 5, 4, IRON)
        v.box(x - 2, 3, 4, x + 2, 5, 5, IRON)


def pier(v, x0, x1):
    """The plank deck on 2 × 2 piles with X bracing between them and a stone quay edge behind."""
    for y in range(1, WATER):
        for x in range(x0, x1):
            v.set(x, y, 0, shade_of(PLANK, 1.0 if (x // 3) % 2 else 0.9))
    xs = list(range(x0 + 1, x1 - 2, 8))
    for y in (1, 7):
        for x in xs:
            v.box(x, y, -13, x + 2, y + 2, 0, TIMBER_DARK)
    for a, b in zip(xs, xs[1:]):  # X bracing on the sea face, a rail beam under the deck
        for i in range(6):
            z = -11 + (i * 7 + 2) // 5
            for dz in (0, 1):
                v.set(a + 2 + i, 1, z + dz, TIMBER)
                v.set(b - 1 - i, 1, z + dz, TIMBER)
        for x in range(a + 2, b):
            v.box(x, 1, -3, x + 1, 2, -1, TIMBER_DARK)
    for x in range(x0, x1):  # the quay edge of dressed stone
        v.box(x, WATER, -3, x + 1, WATER + 2, 1, STONE_DARK if x % 4 else STONE)
    for x in (b for b in BERTHS if x0 <= b < x1):  # bollards at the berths
        v.box(x - 1, 2, 1, x + 1, 4, 4, TIMBER_DARK)
        v.set(x - 1, 2, 4, IRON)
        v.set(x, 2, 4, IRON)
    for x in (x0, x1 - 1):  # rope rail at the pier ends
        for y in range(1, WATER, 5):
            v.box(x, y, 1, x + 1, y + 1, 5, TIMBER_DARK)
        for y in range(1, WATER):
            v.set(x, y, 4, TIMBER_LIGHT)


def crane(v, x, y=8, top=18, jib=7, base=False):
    """A timber cargo crane on the deck: a stout post with braces, a jib out over the water, rope, pulley and a crate."""
    if base:  # a stone base on the quay
        v.box(x - 1, y - 1, 1, x + 3, y + 3, 3, ASHLAR)
        v.box(x - 1, y - 1, 3, x + 3, y + 3, 4, COPING)
    v.box(x, y, 1, x + 2, y + 2, top, TIMBER)
    for k in range(4):
        v.box(x - 1 - k, y, 3 + k, x - k, y + 2, 4 + k, TIMBER)
        v.box(x + 2 + k, y, 3 + k, x + 3 + k, y + 2, 4 + k, TIMBER)
    for j in range(jib + 1):
        v.box(x, y - j, top, x + 2, y - j + 1, top + 1, TIMBER_LIGHT)
    for j in range(1, 4):  # strut
        v.set(x, y - j, top - j, TIMBER)
        v.set(x + 1, y - j, top - j, TIMBER)
    for z in range(top - 8, top):
        v.set(x, y - jib, z, IRON)
    P.box_crate(v, x - 1, y - jib - 1, top - 11, s=3)


def banner(v, x, y, h=26, w=5, drop=9):
    """A tall pole with a cross-yard and a hanging cloth banner."""
    v.box(x, y, 1, x + 1, y + 1, h, TIMBER_DARK)
    v.set(x, y, h, IRON)
    for i in range(-w // 2, w // 2 + 1):
        v.set(x + i, y, h - 2, TIMBER_LIGHT)
    for i in range(-w // 2 + 1, w // 2):
        for z in range(h - 2 - drop, h - 2):
            v.set(x + i, y, z, FLAG)


def deck_goods(v, spots):
    for k, (x, y) in enumerate(spots):
        if k % 3 == 0:
            P.box_crate(v, x, y, 1, s=4)
            P.box_crate(v, x + 4, y + 1, 1, s=3)
        elif k % 3 == 1:
            P.cask(v, x, y, 1, h=5)
            P.cask(v, x + 3, y, 1, h=4)
            P.cask(v, x + 1, y + 3, 1, h=4)
        else:
            P.sacks(v, x, y, 1, n=3, m=CANVAS)
            P.box_crate(v, x + 5, y, 1, s=3)


def level1(v, seed):
    pier(v, 12, 60)
    crane(v, 40)
    banner(v, 57, 9)
    deck_goods(v, [(18, 3), (26, 3), (46, 3)])
    # The plank barn under weathered thatch, a hoist out of the gable.
    thatch = mat("thatch", 0.8)
    x0, y0, x1, y1 = 6, 28, 30, 62
    top = 12
    P.plinth(v, x0, y0, x1, y1, 1, PLINTH, out=0)
    P.fill(v, x0, y0, x1, y1, 1, 2, PLINTH)
    P.boarded(v, x0, y0, x1, y1, 2, top, m=BOARDS, batten=TIMBER, every=4)
    r = P.roof(v, x0, x1, y0, y1, top, "thatch", along="y", rise=1.9, ov=2, gable=BOARDS, seed=seed, m=thatch)
    W.thatch_finish(v, r, seed)
    f = P.Face(v, "y+", y1 - 1)
    W.gate(f, 13, 10, 9)
    V.hoist(f, 18, r.ridge_z - 5, length=9, rope=8, load=TIMBER_LIGHT)
    for a in (8, 24):
        P.casement(f, a, 6, 2, 3, frame=None, sill=TIMBER_LIGHT, shutters=TIMBER_LIGHT, bars=False)
    for x in range(x0 + 4, x1 - 2, 6):  # back wall relief
        v.box(x, y0 - 1, 3, x + 1, y0, 11, TIMBER_DARK)
    bf = P.Face(v, "y-", y0 - 1)  # the sea gable: a hoist beam and one small window
    V.hoist(bf, 18, r.ridge_z - 5, length=8, rope=7, load=TIMBER_LIGHT)
    P.casement(bf, 20, 5, 2, 3, frame=None, sill=TIMBER_LIGHT, shutters=TIMBER_LIGHT, bars=False)
    # The counting hut: boarded walls, a thatched roof along x.
    hx0, hy0, hx1, hy1 = 40, 38, 62, 58
    P.plinth(v, hx0, hy0, hx1, hy1, 1, PLINTH, out=0)
    P.fill(v, hx0, hy0, hx1, hy1, 1, 2, PLINTH)
    P.boarded(v, hx0, hy0, hx1, hy1, 2, 10, m=mat("timber", 1.0), batten=TIMBER_DARK, every=4)
    hr = P.roof(v, hx0, hx1, hy0, hy1, 10, "thatch", along="x", rise=1.4, ov=2, gable=BOARDS, seed=seed + 1, m=mat("thatch", 0.9))
    W.thatch_finish(v, hr, seed + 1)
    hf = P.Face(v, "y+", hy1 - 1)
    P.entrance(hf, 48, 2, 4, 6)
    for a in (42, 56):
        P.casement(hf, a, 5, 2, 3, frame=None, sill=TIMBER_LIGHT, shutters=TIMBER_LIGHT, bars=False)
    P.woodpile(v, 36, 30, 1, length=8, along="y", rows=3)
    W.store_goods(v, [(34, 64), (50, 64), (4, 66)])
    P.handcart(v, 64, 64, 1, along="x", load=CANVAS)


def level2(v, seed):
    pier(v, 3, 69)
    crane(v, 30)
    banner(v, 66, 9)
    deck_goods(v, [(10, 3), (40, 3), (52, 3)])
    kw = dict(roof=TERRACOTTA, ridge=TERRA_RIDGE, shades=SHADE_TILE, verge=0.66, shutters=mat("dye-blue"))
    a = W.framed_house(v, 4, 36, 40, 62, "x", ground=11, top=22, kind="tiles", rise=1.4, seed=seed, windows={"y+": (0, 2), "x-": (0,)}, plain=("y-",), **kw)
    W.gate(a.face("y+"), 15, 10, 9, arch=True)
    b = W.framed_house(v, 44, 26, 66, 62, "y", ground=11, top=25, kind="tiles", rise=1.5, seed=seed + 1, windows={"y+": (), "x-": (0, 2)}, plain=("y-",), **kw)
    W.loft_door(v, b.upper[3] - 1, 53, 13, frame=P.DRESSED, beam_z=25 + 4, rope=10)
    V.balcony(a.face("y+"), 7, 15, 12, depth=2)
    W.dormer(v, a.roof, 22, 28, "y+", wall=mat("plaster", 0.95), frame=TIMBER_LIGHT, course=3, h=6, m=TERRACOTTA, ridge=TERRA_RIDGE, shades=SHADE_TILE, verge=0.66)
    W.stack(v, 12, 42, a.roof.ridge_z - 2, a.roof.ridge_z + 4, 3, 3)
    W.store_goods(v, [(8, 66), (28, 66), (48, 66)])
    P.handcart(v, 56, 68, 1, along="x", load=CANVAS)


def level3(v, seed):
    quay(v, 3, 69)
    crane(v, 20, base=True)
    crane(v, 50, top=20, base=True)
    banner(v, 8, 9)
    banner(v, 64, 9)
    deck_goods(v, [(8, 3), (28, 3), (56, 3)])
    kw = dict(roof=TILE, ridge=TILE_RIDGE, shades=SHADE_TILE, verge=0.62, stone=mat("stone", 0.95), shutters=mat("dye-blue"))
    a = W.framed_house(v, 4, 38, 40, 64, "x", ground=11, top=23, kind="tiles", rise=1.4, seed=seed, windows={"y+": (0, 2)}, plain=("y-",), **kw)
    b = W.framed_house(v, 44, 26, 66, 64, "y", ground=11, top=27, kind="tiles", rise=1.5, seed=seed + 1, windows={"y+": (), "x-": (0, 2)}, plain=("y-",), **kw)
    back = shade_of(mat("stone", 0.95), 0.5)
    W.round_arcade(b.face("y+"), 44, 66, 2, 9, bay=6, pier=2, depth=3, back=back, pier_m=BRICK, arch_m=BRICK)
    W.round_arcade(a.face("y+"), 4, 22, 2, 9, bay=6, pier=2, depth=3, back=back, pier_m=BRICK, arch_m=BRICK)
    W.gate(a.face("y+"), 28, 9, 9, arch=True)
    W.loft_door(v, b.upper[3] - 1, 52, 13, frame=P.DRESSED, beam_z=27 + 4, rope=11)
    for x0 in (10, 24):
        W.dormer(v, a.roof, x0, x0 + 6, "y+", wall=mat("plaster", 0.95), frame=Q.DRESSED, course=3, h=6, m=TILE, ridge=TILE_RIDGE, shades=SHADE_TILE, verge=0.62)
    W.stack(v, 30, 44, a.roof.ridge_z - 2, a.roof.ridge_z + 4, 3, 3)
    W.store_goods(v, [(6, 68), (26, 68), (48, 68)])


def level4(v, seed):
    quay(v, 3, 69)
    crane(v, 18, top=20, base=True)
    crane(v, 48, top=20, base=True)
    banner(v, 5, 9)
    banner(v, 33, 9, h=28)
    banner(v, 66, 9)
    deck_goods(v, [(8, 3), (26, 3), (56, 3)])
    # The brick Speicher (gable to the front, stepped), light dressings, slate.
    x0, y0, x1, y1 = 4, 28, 38, 66
    cx = (x0 + x1) // 2
    top = 24
    P.plinth(v, x0, y0, x1, y1, 1, STONE_DARK, out=0)
    P.fill(v, x0, y0, x1, y1, 1, 2, STONE_DARK)
    Q.ashlar(v, x0, y0, x1, y1, 2, 12, BRICK, BRICK_BAND)
    P.fill(v, x0, y0, x1, y1, 12, top, CREAM)
    P.dressed_quoins(v, x0, y0, x1, y1, 2, top)
    Q.string_course(v, x0, y0, x1, y1, 12)
    r = P.roof(v, x0, x1, y0, y1, top, "slate", along="y", rise=0.9, ov=1, gable=BRICK, m=SLATE, ridge=SLATE_RIDGE, shades=SHADE_SLATE, verge=0.66)
    W.roof_core(v, r, BRICK, SLATE)
    ff, fx = P.Face(v, "y+", y1 - 1), P.Face(v, "x-", x0)
    back = shade_of(BRICK, 0.55)
    W.round_arcade(ff, x0, x1, 2, 9, bay=6, pier=2, depth=3, back=back, pier_m=BRICK, arch_m=Q.DRESSED)
    W.round_arcade(fx, y0, y1, 2, 9, bay=6, pier=2, depth=3, back=back, pier_m=BRICK, arch_m=Q.DRESSED)
    for a in range(x0 + 4, x1 - 6, 8):
        if abs(a + 2 - cx) > 5:
            W.arched_window(ff, a, 13, 5, 5)
    for a in range(y0 + 5, y1 - 6, 8):
        W.arched_window(fx, a, 13, 5, 5)
    W.loft_door(v, y1 - 1, cx - 2, 13, frame=Q.DRESSED, beam_z=top + 4, rope=12, length=9)
    bf = P.Face(v, "y-", y0)  # the sea side is the business side: gate, loft door with hoist, two windows a floor
    W.gate(bf, cx - 4, 8, 8, arch=True)
    for a in (cx - 13, cx + 9):
        W.arched_window(bf, a, 4, 4, 5)
    for a in (cx - 11, cx + 7):
        W.arched_window(bf, a, 14, 4, 5)
    W.loft_door(v, y0, cx - 2, 13, frame=Q.DRESSED, beam_z=top + 4, rope=12, length=9, side="y-")
    W.stepped_gable(v, r, "y+", m=BRICK, coping=Q.DRESSED, balls="apex")
    W.stepped_gable(v, r, "y-", m=BRICK, coping=Q.DRESSED, balls="apex")
    for a in (34, 50):
        W.dormer(v, r, a, a + 6, "x-", wall=CREAM, frame=Q.DRESSED, course=3, h=6, m=SLATE, ridge=SLATE_RIDGE, shades=SHADE_SLATE, verge=0.66, kind="slate")
    # The counting house with a flag tower: cream over a brick base, slate hip roof.
    cx0, cy0, cx1, cy1 = 44, 40, 66, 64
    P.plinth(v, cx0, cy0, cx1, cy1, 1, STONE_DARK, out=0)
    P.fill(v, cx0, cy0, cx1, cy1, 1, 2, STONE_DARK)
    Q.ashlar(v, cx0, cy0, cx1, cy1, 2, 10, BRICK, BRICK_BAND)
    P.fill(v, cx0, cy0, cx1, cy1, 10, 19, CREAM)
    P.dressed_quoins(v, cx0, cy0, cx1, cy1, 2, 19)
    Q.string_course(v, cx0, cy0, cx1, cy1, 10)
    cr = P.roof(v, cx0, cx1, cy0, cy1, 19, "slate", along="x", rise=1.2, ov=1, gable=CREAM, m=SLATE, ridge=SLATE_RIDGE, shades=SHADE_SLATE, verge=0.66)
    cf = P.Face(v, "y+", cy1 - 1)
    P.entrance(cf, 52, 2, 5, 7, leaf=mat("dye-blue"), frame=P.DRESSED, lintel=P.DRESSED, arch=True)
    for a in (46, 58):
        W.arched_window(cf, a, 12, 4, 5)
        W.arched_window(cf, a, 4, 4, 4, shutters=mat("dye-blue"))
    tx, ty = cx0 + 3, (cy0 + cy1) // 2 - 1
    v.box(tx, ty, cr.ridge_z, tx + 2, ty + 2, cr.ridge_z + 6, TIMBER_DARK)
    for i in range(6):
        for z in (cr.ridge_z + 4, cr.ridge_z + 5):
            v.set(tx + 2 + i, ty, z, FLAG)
    W.store_goods(v, [(6, 70), (26, 70), (48, 69)])


def build(ctx):
    v = ctx.vox()  # 72 × 72
    lv = ctx.level
    seed = 70 + lv
    P.yard(v, 0, WATER + 2, 72, 72, "dirt" if lv <= 2 else "paved", seed=seed)
    {1: level1, 2: level2, 3: level3, 4: level4}[lv](v, seed)
    for k, x in enumerate((36 - 9, 36 + 9, 36 - 27, 36 + 27)):
        v.anchor(f"berth_{k + 1}", x, 1.8, 0.72)
    P.lamp_post(v, 30, 70)
    P.lamp_post(v, 42, 70)
    v.anchor("cart", 53, 66, 1)
    v.anchor("door", 36, 72, 0)
    v.anchors.pop("status", None)
    P.tie_floating(v, ground=0)
    return P.colour_jitter(v, seed=seed)

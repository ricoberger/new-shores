"""
The tier kit of the V7 rework (12 voxels per tile buildings), added next to
`parts_v7.py`; recipes import it as `from nsvoxel import parts_kit as K`.

`hall` builds the main block of a building in the vocabulary of its tier
(D-064 §3): I dark boards on a flush stone band under weathered thatch;
II rubble ground floor, half-timber storey, terracotta; III the same under
dark burgundy tiles; IV ashlar ground floor, cream plaster, slate. It sets
door, windows, a slim chimney and the smoke anchors. `ground`/`tufts`
paint the worked-ground blob and the grass tufts of a plot, `pile`
is a large stack of goods, `kiln` a brick-accent oven with a slim chimney,
`silo` a round plank granary, `lean` a thatched or tiled lean-to,
`stall` an open-fronted shed, `gate_wall` a low wall with a gap.
"""

from types import SimpleNamespace

from . import detail as _d
from . import detail_v4 as _v
from . import detail_v5 as Q
from . import parts as P
from . import parts_v7 as W
from .grid import hash3, mat, shade_of
from .mats import CANVAS, DYE_BLUE, FLOWER, GRASS_A, GRASS_B, PLANK, PLASTER, SLATE, STONE, STONE_DARK, STONE_LIGHT, TERRACOTTA, THATCH_DARK, TIMBER, TIMBER_DARK, TIMBER_LIGHT

BOARDS = mat("timber", 0.8)  # the settlers' board walls
THATCH = mat("thatch", 0.8)  # weathered thatch
FRAME = mat("timber", 0.62)  # heavy frames of tiers II–III
PLINTH = mat("stone", 1.1)  # the pale flush band of tier I
BRICK = mat("brick")  # accent only
TILE_DARK = mat("tile-dark")
TILE_RIDGE = mat("tile-dark", 0.62)
SLATE_RIDGE = mat("slate", 0.6)
CREAM = mat("plaster", 0.95)
ASHLAR = mat("stone", 0.8)
GREEN = mat("grass-b", 0.8)
FRESH = shade_of(PLANK, 1.3)  # fresh-cut planks
DRESSED = P.DRESSED


# ---------------------------------------------------------------- ground


def ground(v, cx, cy, rx, ry, seed=0, kind="dirt"):
    """An irregular rounded patch of worked ground: an ellipse with a noisy rim (the yard map, D-068)."""
    for x in range(int(cx - rx - 2), int(cx + rx + 3)):
        for y in range(int(cy - ry - 2), int(cy + ry + 3)):
            d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2
            if d < 1.0 + (hash3(x // 4, y // 4, 5, seed) - 0.5) * 0.3:
                P.yard(v, x, y, x + 1, y + 1, kind, seed=seed)


def tufts(v, seed=0, density=0.04):
    """Grass tufts and flowers on the cells left to the terrain."""
    for x in range(v.w):
        for y in range(v.d):
            if (x, y) in v.ground or v.has(x, y, 1) or hash3(x, y, 91, seed) >= density:
                continue
            if hash3(y, x, 92, seed) < 0.25:
                v.set(x, y, 1, shade_of(GRASS_A, 1.05))
                v.set(x, y, 2, FLOWER)
            else:
                v.set(x, y, 1, shade_of(GRASS_B, 1.08))
                if hash3(x, y, 93, seed) < 0.45:
                    v.set(x, y, 2, shade_of(GRASS_B, 1.16))


# ---------------------------------------------------------------- the main block


def _n_panels(a0, a1):
    return len(W.bays(a0, a1)) - 1


def hall(v, x0, y0, x1, y1, tier, along="x", seed=0, door=None, storeys=None, smoke=False, chim=None, rise=None, windows=True, wins=None, ov=None, hip=False, stone=None, chimney=False, plinth=None, upper=None, tall=False, dressed=None, dark=False):
    """
    The main block in the vocabulary of `tier` (1–4) over x0..x1 × y0..y1. `door` = (side, a) with `a` the first
    voxel of a four-wide door along the side (default: the middle of the y+ face); `storeys` = (ground, top) of
    tiers II–IV (tier I: wall height); `smoke` sets the chimney and smoke anchors with a slim chimney at `chim`; `dark` puts the tier III burgundy
    tile on a tier II block (a grand tier-4 workshop in the workshop look, D-075 §3).
    Returns a namespace with `.roof`, `.ridge`, `.face(side)`, `.top` and the rectangle `.rect`.
    """
    side, a = door if door else ("y+", (x0 + x1) // 2 - 2 if along == "x" else (x0 + x1) // 2 - 2)
    cx, cy = chim if chim else ((x0 + x1) // 2 + (x1 - x0) // 4, y0 + (y1 - y0) // 3)
    wall_h = (storeys or (0, 13))[1] if tier == 1 else None
    if tier == 1:
        P.plinth(v, x0, y0, x1, y1, 1, PLINTH, out=0)
        P.fill(v, x0, y0, x1, y1, 1, 2, PLINTH)
        P.boarded(v, x0, y0, x1, y1, 2, wall_h, m=BOARDS, batten=TIMBER_DARK, every=4)
        r = P.roof(v, x0, x1, y0, y1, wall_h, "thatch", along=along, rise=rise or 1.0, ov=ov or 2, gable=shade_of(BOARDS, 1.1), seed=seed, m=THATCH, hip=hip)
        W.thatch_finish(v, r, seed)
        planes = {"y+": y1 - 1, "y-": y0, "x-": x0, "x+": x1 - 1}
        face = lambda s: P.Face(v, s, planes[s])  # noqa: E731
        ridge = r.ridge_z
        top = wall_h
        _openings(v, face, (x0, y0, x1, y1), tier, side, a, windows, wins, 2, wall_h)
        if smoke or chimney:
            P.roof_chimney(v, r, cx, cy, above=3, anchor=smoke)
        out = SimpleNamespace(roof=r, ridge=ridge, face=face, top=top, rect=(x0, y0, x1, y1), tier=tier)
        return out
    g, t = storeys or ((10, 19) if tier == 2 else (11, 22) if tier == 3 else ((9, 24) if tall else (10, 20)))
    if tier == 4:
        parts = (g - 1, (t - g + 1) // 2, (t - g + 1) - (t - g + 1) // 2) if tall else (g - 1, t - g + 1)
        b = Q.palazzo(v, x0, y0, x1, y1, parts, upper=upper or CREAM, base=ASHLAR, roof=SLATE, kind="slate", along=along, rise=rise or 1.5, ov=ov or 1, seed=seed, ridge=SLATE_RIDGE, shades=(1.18, 0.8), verge=0.66, hip=hip)
        face = b.face
        r = b.roof
        _openings(v, face, (x0, y0, x1, y1), tier, side, a, windows, wins, 2, g, dressed)
    else:
        kw = {}
        if tier == 3 or dark:
            kw = dict(roof=TILE_DARK, ridge=TILE_RIDGE, shades=(1.2, 0.84), verge=0.62)
        upx0, upx1, upy0, upy1 = x0 - 1, x1 + 1, y0 - 1, y1 + 1
        win = {}
        if windows:
            nx, ny = _n_panels(upx0, upx1), _n_panels(upy0, upy1)
            along_front, along_side = (nx, ny)
            win = {"y+": tuple(range(nx)), "y-": tuple(range(nx)), "x-": tuple(range(ny))}
            if side == "y+" and a is not None:
                pass
        b = W.framed_house(v, x0, y0, x1, y1, along, ground=g, top=t, infill=PLASTER if tier == 2 else shade_of(PLASTER, 0.97), frame=FRAME, rise=rise or (1.5 if tier == 2 else 1.8), seed=seed, windows=win, shutters=DYE_BLUE if tier == 2 else GREEN, hip=hip, ov=ov or 1, **({"stone": stone} if stone else {}), **({"plinth": plinth} if plinth else {}), **kw)
        face = b.face
        r = b.roof
        _openings(v, face, (x0, y0, x1, y1), tier, side, a, windows, wins, 2, g, dressed)
    if smoke or chimney:
        sx, sy = cx, cy
        W.stack(v, sx, sy, 1, r.ridge_z + 4, 2, 2)
        if smoke:
            v.anchor("chimney", sx + 1.0, sy + 1.0, r.ridge_z + 7)
            v.anchor("smoke", sx + 1.0, sy + 1.0, r.ridge_z + 8)
    return SimpleNamespace(roof=r, ridge=r.ridge_z, face=face, top=t, rect=(x0, y0, x1, y1), tier=tier, b=b)


def _openings(v, face, rect, tier, side, a, windows, wins, z0, g, dressed=None):
    """The front door and the ground windows either side of it (tier styles)."""
    dr = dressed or DRESSED
    x0, y0, x1, y1 = rect
    lo, hi = (x0, x1) if side in ("y+", "y-") else (y0, y1)
    if a is not None:
        f = face(side)
        if tier == 1:
            P.entrance(f, a, 2, 4, 7, leaf=TIMBER_LIGHT, frame=TIMBER, step=PLINTH, steps=1)
        elif tier == 4:
            P.entrance(f, a, 2, 4, 8, leaf=TIMBER, frame=dr, lintel=dr, steps=2)
        else:
            P.entrance(f, a, 2, 4, 7 if tier == 2 else 8, leaf=TIMBER_LIGHT if tier == 2 else TIMBER, frame=dr, lintel=dr, steps=1)
    if not windows:
        return
    spots = wins if wins is not None else [p for p in range(lo + 3, hi - 6, 9) if a is None or abs(p - a) > 5]
    f = face(side)
    for p in spots:
        if tier == 1:
            P.casement(f, p, 6, 3, 3, frame=PLANK, sill=PLANK, shutters=TIMBER_LIGHT, bars=False)
        elif tier == 4:
            W.arched_window(f, p, 4, 3, 5)
        else:
            P.casement(f, p, 4, 3, 4, frame=dr, sill=dr, lintel=dr, bars=False)
    # a window in the west gable end for every tier
    gx = lambda s: face(s)  # noqa: E731
    mid = (y0 + y1) // 2 - 1
    if tier == 1:
        P.casement(gx("x-"), mid, 6, 3, 3, frame=PLANK, sill=PLANK, bars=False)


# ---------------------------------------------------------------- props


def pile(v, x, y, z, w, d, h, m, seed=0, cap=None):
    """A large stack of goods (w × d × h) in two shades with a ragged, lighter top layer — the building's signature prop."""
    for k in range(h):
        c = m if k % 2 == 0 else shade_of(m, 0.88)
        for i in range(w):
            for j in range(d):
                if k == h - 1 and hash3(x + i, y + j, z + k, seed) < 0.25:
                    continue
                v.set(x + i, y + j, z + k, (cap or shade_of(m, 1.1)) if k == h - 1 else c)


def ore_bin(v, x0, y0, x1, y1, z, h, ore, seed=0, front=2):
    """An open plank bin x0..x1 × y0..y1: back and sides `h` high, the y+ front only `front` high, heaped with `ore` above the rim."""
    v.walls(x0, y0, x1, y1, z, z + h, BOARDS)
    v.box(x0, y1 - 1, z + front, x1, y1, z + h, None)
    for x in range(x0, x1, 3):
        v.box(x, y0, z, x + 1, y0 + 1, z + h + 1, TIMBER_DARK)  # battens
    v.box(x0 + 1, y0 + 1, z, x1 - 1, y1 - 1, z + h, ore)
    for i in range(x0 + 2, x1 - 2):  # a ridge of heaped ore, one shade lighter
        for j in range(y0 + 2, y1 - 2):
            if (i + 2 * j + seed) % 5:
                v.set(i, j, z + h, shade_of(ore, 1.12))


def kiln(v, x, y, z, w=6, d=6, h=8, seed=0, chim=True):
    """A brick-accent kiln: a block with an arched mouth on the y+ side, a banded top and a slim brick chimney."""
    for i in range(w):
        for j in range(d):
            for k in range(h):
                v.set(x + i, y + j, z + k, shade_of(BRICK, 1.0 if (i + k) % 3 else 0.9))
    v.box(x + w // 2 - 1, y + d - 1, z, x + w // 2 + 1, y + d, z + 3, shade_of(BRICK, 0.4))  # the mouth
    v.box(x + w // 2 - 1, y + d - 1, z + 3, x + w // 2 + 1, y + d, z + 4, STONE_LIGHT)
    if chim:
        v.box(x + w // 2 - 1, y + d // 2 - 1, z + h, x + w // 2 + 1, y + d // 2 + 1, z + h + 8, BRICK)
        v.box(x + w // 2 - 1, y + d // 2 - 1, z + h + 8, x + w // 2 + 1, y + d // 2 + 1, z + h + 9, STONE_DARK)


def silo(v, cx, cy, r, h, m=None, cone=None, door=True):
    """A round plank granary with timber bands and a conical thatch roof (the wheat farm's)."""
    m = m or shade_of(PLANK, 0.95)
    cone = cone or mat("thatch", 0.95)
    for x in range(cx - r - 1, cx + r + 2):
        for y in range(cy - r - 1, cy + r + 2):
            d = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5
            if r - 0.9 < d <= r + 0.3:
                for z in range(1, h):
                    v.set(x, y, z, TIMBER_DARK if z % 5 == 0 else shade_of(m, 1.0 if (x + y) % 2 else 0.92))
            if d <= r + 0.3:
                v.set(x, y, h - 1, shade_of(m, 0.9))
    rr, z = r + 1, h
    while rr >= 1:
        for x in range(cx - rr, cx + rr + 1):
            for y in range(cy - rr, cy + rr + 1):
                if ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5 <= rr + 0.2:
                    for k in range(2):
                        v.set(x, y, z + k, shade_of(cone, 1.0 if z % 2 else 0.9))
        rr -= 1
        z += 2
    v.box(cx, cy, z, cx + 1, cy + 1, z + 2, TIMBER_DARK)
    if door:
        v.box(cx - 1, cy + r - 1, 1, cx + 1, cy + r + 1, 6, TIMBER_DARK)


def lean(v, x0, x1, y0, y1, z, down, tier=1, posts=True, seed=0):
    """A lean-to against a wall: thatch for tier I, tiles above, `down` names its low side."""
    if tier == 1:
        P.lean_to(v, x0, x1, y0, y1, z, "thatch", down=down, ov=0, m=THATCH, posts=posts, seed=seed)
    else:
        P.lean_to(v, x0, x1, y0, y1, z, "tiles", down=down, ov=0, m=TILE_DARK if tier == 3 else TERRACOTTA, posts=posts, seed=seed)


def low_wall(v, x0, y0, x1, y1, h=3, seed=0, m=STONE):
    """A low field-stone wall run."""
    W.coursed_stone_2(v, x0, y0, x1, y1, 1, 1 + h, m, seed)


def crates(v, spots, m=None):
    """Goods crates (2 × 2 × 2) at the given (x, y, z) spots."""
    for x, y, z in spots:
        P.box_crate(v, x, y, z)


def set_cart(v, x, y, z=1):
    v.anchor("cart", x, y, z)


def pig(v, x, y, z, along="x", tone=1.0):
    """A pig: a pink body 5 long and 3 wide, a head with a darker snout, four stubs of legs."""
    pink = mat("terracotta", 1.5 * tone)
    snout = mat("terracotta", 1.1)
    a, b = (5, 3) if along == "x" else (3, 5)
    v.box(x, y, z + 1, x + a, y + b, z + 3, pink)
    for dx, dy in ((0, 0), (a - 1, 0), (0, b - 1), (a - 1, b - 1)):
        v.set(x + dx, y + dy, z, snout)
    if along == "x":
        v.box(x + a, y, z + 1, x + a + 2, y + b, z + 3, pink)
        v.set(x + a + 1, y + 1, z + 2, snout)
    else:
        v.box(x, y + b, z + 1, x + a, y + b + 2, z + 3, pink)
        v.set(x + 1, y + b + 1, z + 2, snout)


def mine(v, seed, seam, ore, peak=21, share=0.45, frame=False, whim=None, spoil=None, ax=12, tubs=2):
    """
    A mine strip 36 × 96 (12 voxels per tile): a banded rock hill at the back with a timbered adit, rails on
    sleepers to the front with `tubs` loaded with `ore`, a heap of `ore` and a cart; `frame` adds a timber
    headframe with a sheave wheel at the east of the pit, `whim` (a brine material) a horse whim there, `spoil`
    a spoil tip on the hill. The winding house is the recipe's own `hall`.
    """
    from . import detail_v4 as V
    from .mats import IRON, ROCK_DEEP

    V.mine_hill(v, 0, 36, 0, 42, peak=peak, seam=seam, share=share, seed=seed)
    v.box(ax, 24, 1, ax + 12, 42, 11, None)
    v.box(ax, 24, 1, ax + 12, 30, 11, seam if seam is not None else IRON)
    for x in (ax - 1, ax + 12):
        v.box(x, 39, 1, x + 1, 42, 12, TIMBER)
    v.box(ax - 1, 39, 12, ax + 13, 42, 13, TIMBER_DARK)
    for x in range(ax - 1, ax + 13, 3):
        v.set(x, 41, 13, PLANK)
    v.box(ax, 39, 11, ax + 12, 40, 12, TIMBER)
    for y in range(30, 76):
        for x in (ax + 2, ax + 9):
            v.set(x, y, 1, IRON)
        if y % 2 == 0:
            v.box(ax + 1, y, 0, ax + 11, y + 1, 1, TIMBER)
    for k in range(tubs):
        ty = 48 + k * 11
        v.box(ax + 2, ty, 2, ax + 10, ty + 7, 5, TIMBER_DARK)
        v.box(ax + 2, ty, 4, ax + 10, ty + 7, 5, IRON)
        v.box(ax + 2, ty, 5, ax + 10, ty + 7, 6, ore)
        v.box(ax + 4, ty + 2, 6, ax + 8, ty + 5, 7, ore)
    if frame:
        sx, sy = 26, 46
        for dx in (0, 7):
            for dy in (0, 7):
                v.box(sx + dx, sy + dy, 1, sx + dx + 1, sy + dy + 1, 22, TIMBER)
        for z in (7, 14, 21):
            v.walls(sx, sy, sx + 8, sy + 8, z, z + 1, TIMBER_DARK)
        for a in range(-4, 5):
            for b in range(-4, 5):
                if 9 <= a * a + b * b <= 15:
                    v.set(sx + 4 + a, sy + 3, 25 + b, IRON)
        v.box(sx + 4, sy + 3, 22, sx + 5, sy + 5, 25, TIMBER_DARK)
        for z in range(5, 22):
            v.set(sx + 4, sy + 4, z, mat("canvas", 0.8))
    if whim is not None:
        cx, cy = 28, 52
        for x in range(cx - 6, cx + 7):
            for y in range(cy - 6, cy + 7):
                if (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= 36:
                    v.set(x, y, 0, shade_of(mat("dirt"), 0.9))
        v.box(cx, cy, 1, cx + 2, cy + 2, 14, TIMBER_DARK)
        v.box(cx - 3, cy - 3, 9, cx + 5, cy + 5, 11, TIMBER_LIGHT)
        v.box(cx - 6, cy, 5, cx + 8, cy + 1, 6, TIMBER)
        P.cask(v, 22, 62, 1, lid=whim)
        P.cask(v, 26, 62, 1, lid=whim)
    if spoil is not None:
        _v.heap(v, 28, 8, r=4.5, h=4, m=spoil, seed=seed + 1, z=17)
    _v.heap(v, 8, 78, r=6, h=7, m=ore, seed=seed)
    P.log_stack(v, 2, 88, 1, length=12, along="x", n=2)
    P.handcart(v, 16, 90, 1, along="x", load=ore)
    v.anchor("cart", 12, 94, 1)
    P.scatter(v, 0, 42, 36, 96, 0.012, seed=seed, kinds=("pebble",))


from .mats import PLANK  # noqa: E402


def rack(v, x0, x1, y, goods, h=9, drop=6, post=None, every=4):
    """A drying rack along x at y: posts, a top rail and hanging strips of `goods` (a material or a list), no sway."""
    post = post or TIMBER_DARK
    goods = goods if isinstance(goods, list) else [goods]
    for x in range(x0, x1 + 1, every):
        v.box(x, y, 1, x + 1, y + 1, h + 1, post)
    v.box(x0, y, h, x1 + 1, y + 1, h + 1, shade_of(post, 1.2))
    k = 0
    for x in range(x0 + 1, x1, every):
        v.box(x, y, h - drop, x + every - 1, y + 1, h, goods[k % len(goods)])
        k += 1


def cow(v, x, y, z=1, along="x", m=None, patch=None):
    """A cow 7 long and 4 wide: body, head with horns, legs, a patch."""
    m = m or mat("canvas", 1.1)
    patch = patch or mat("timber", 0.55)
    a, b = (7, 4) if along == "x" else (4, 7)
    v.box(x, y, z + 2, x + a, y + b, z + 5, m)
    for dx, dy in ((0, 0), (a - 1, 0), (0, b - 1), (a - 1, b - 1)):
        v.box(x + dx, y + dy, z, x + dx + 1, y + dy + 1, z + 2, patch)
    if along == "x":
        v.box(x + a, y + 1, z + 3, x + a + 2, y + 3, z + 6, m)
        v.set(x + a, y, z + 6, TIMBER_LIGHT)
        v.set(x + a, y + 3, z + 6, TIMBER_LIGHT)
        v.box(x + 2, y, z + 3, x + 4, y + b, z + 5, patch)
    else:
        v.box(x + 1, y + b, z + 3, x + 3, y + b + 2, z + 6, m)
        v.set(x, y + b, z + 6, TIMBER_LIGHT)
        v.set(x + 3, y + b, z + 6, TIMBER_LIGHT)
        v.box(x, y + 2, z + 3, x + a, y + 4, z + 5, patch)


def hive(v, x, y, z=1, m=None):
    """A straw skep: a 4 × 4 dome of three layers on a plank."""
    m = m or mat("thatch", 1.25)
    v.box(x, y, z, x + 4, y + 4, z + 1, TIMBER_LIGHT)
    v.box(x, y, z + 1, x + 4, y + 4, z + 3, m)
    v.box(x + 1, y + 1, z + 3, x + 3, y + 3, z + 4, m)
    v.set(x + 1, y, z + 1, TIMBER_DARK)


def still(v, cx, cy, z=1, m=None, r=4):
    """A copper still: a round pot on a stone hearth, a head and a pipe."""
    m = m or mat("terracotta", 1.25)
    v.ellipsoid(cx, cy, z, r + 1.5, r + 1.5, 2.5, lambda x, y, zz: STONE_DARK, keep=lambda x, y, zz: zz >= z and zz < z + 2)
    v.ellipsoid(cx, cy, z + 2, r, r, r, lambda x, y, zz: m, keep=lambda x, y, zz: zz >= z + 2)
    v.ellipsoid(cx, cy, z + 2 + r, 2, 2, 3, lambda x, y, zz: m)
    v.box(cx, cy - 1, z + 2 + r + 2, cx + 6, cy + 1, z + 2 + r + 3, m)


def furnace(v, cx, cy, hgt=29, r=8, glow=None, ember=None, wall=None, anchors=True):
    """A battered furnace tower of ashlar (r → r − 3), an arched glowing mouth on the y+ side and a slim stack with the chimney and smoke anchors."""
    glow = glow or mat("ochre", 1.7)
    ember = ember or mat("terracotta", 1.5)
    a, b = wall or mat("stone", 0.8), mat("stone", 0.7)
    for z in range(1, hgt + 1):
        rr = r - 3 * z / hgt
        x0, x1, y0, y1 = int(cx - rr), int(cx + rr), int(cy - rr), int(cy + rr)
        for x in range(x0, x1):
            for y in range(y0, y1):
                if z == hgt or x in (x0, x1 - 1) or y in (y0, y1 - 1):
                    v.set(x, y, z, a if (z // 3) % 2 else b)
    W.stack(v, cx - 1, cy - 1, hgt, hgt + 9, 2, 2)
    if anchors:
        v.anchor("chimney", cx, cy, hgt + 9)
        v.anchor("smoke", cx, cy, hgt + 10)
    v.box(cx - 3, cy + r - 3, 1, cx + 3, cy + r + 1, 8, None)
    v.box(cx - 2, cy + r - 2, 1, cx + 2, cy + r, 6, ember)
    v.box(cx - 1, cy + r - 2, 1, cx + 1, cy + r, 4, glow)


# ------------------------------------------------------------- massings

_EAVE = {1: 12, 2: 10, 3: 11, 4: 10}


def _clamp(a, lo, hi):
    return max(lo, min(hi, a))


def workshop(v, x0, y0, x1, y1, tier, mass="a", seed=0, door=None, smoke=False, chim=None, out="kiln", wins=None, tall=False, **kw):
    """
    The main block of a production building in one of five massings inside the rectangle x0..x1 × y0..y1 (the
    plot's props stand in front of it): "a" a long range, the ridge along the longer side; "b" the ridge along y
    with a lean-to shed on the west flank; "c" an L-plan, a long range with a lower wing at the front-left; "d" a
    house with an open work bay 14 deep in front of it, beyond y1 (posts, a lean-to roof, 10 clear); "e" the house and a
    separate outbuilding (`out`: "kiln", "silo", "tower" or "stable") at the west. Tier IV is two storeys unless
    `tall`. Returns what `hall` returns for the main block.
    """
    w, d = x1 - x0, y1 - y0
    side, a = door if door else ("y+", None)
    cx, cy = chim if chim else (None, None)
    g = _EAVE[tier]
    lt = 3 if kw.get("dark") and tier == 2 else tier  # the lean-tos follow the roof
    if tier == 4 and wins == []:
        wins = None  # arched ground windows: relief on the plain two-storey wall
    if side != "y+":
        return hall(v, x0, y0, x1, y1, tier, "x" if w >= d else "y", seed, door=door, smoke=smoke, chim=chim, wins=wins, tall=tall, **kw)

    wl = _clamp(int(w * 0.4), 10, max(10, w - 14))

    def place(rx0, ry0, rx1, ry1, along, dx, **more):
        da = _clamp(dx if dx is not None else (rx0 + rx1) // 2 - 2, rx0 + 3, rx1 - 7)
        c = None
        if smoke or chim:
            c = (_clamp(cx if cx is not None else rx1 - 8, rx0 + 2, rx1 - 5), _clamp(cy if cy is not None else ry0 + (ry1 - ry0) // 3, ry0 + 2, ry1 - 5))
        ww = None if wins is None else [p for p in wins if rx0 + 3 <= p < rx1 - 6 and (mass != "c" or p > x0 + wl + 2)]
        return hall(v, rx0, ry0, rx1, ry1, tier, along, seed, door=(side, da), smoke=smoke, chim=c, wins=ww, tall=tall, **more, **kw)

    if mass == "a":
        return place(x0, y0, x1, y1, "x" if w >= d else "y", a)
    if mass == "b":
        lw = _clamp(w // 3, 6, 10)
        main = place(x0 + lw, y0, x1, y1, "y", a)
        lean(v, x0, x0 + lw + 1, y0 + 3, y1 - 3, g - 1, "x-", tier=lt, posts=True, seed=seed)
        return main
    if mass == "c":
        ym = y0 + _clamp(int(d * 0.58), 12, d - 10)
        main = place(x0, y0, x1, ym, "x", a if a is not None and a >= x0 + wl + 3 else x1 - 10)
        wg = (g - 2, g + 4) if tier != 4 else (g - 1, g + 5)
        hall(v, x0, ym, x0 + wl, y1, tier, "y", seed + 1, door=("y+", None), windows=True, wins=None, storeys=wg, tall=False, **{k: x for k, x in kw.items() if k not in ("windows", "chimney")})
        return main
    if mass == "d":
        ld = 10
        main = place(x0, y0, x1, y1, "x" if w >= d else "y", a)
        z = g + 1
        lean(v, x0 + 1, x1 - 1, y1, y1 + ld, z, "y+", tier=lt, posts=True, seed=seed)
        for px in range(x0 + 12, x1 - 6, 12):
            v.box(px, y1 + ld - 1, 1, px + 1, y1 + ld, z + 1, TIMBER)
        return main
    if mass == "e":
        ow = 12
        hx0 = x0 + ow + 3
        main = place(hx0, y0, x1, y1, "x" if x1 - hx0 >= d else "y", a)
        oy = y0 + 2
        if out == "kiln":
            kiln(v, x0, oy, 1, w=ow, d=ow, h=12, seed=seed)
        elif out == "silo":
            silo(v, x0 + ow // 2, oy + ow // 2, ow // 2 - 1, 20)
        elif out == "tower":
            _tower(v, x0 + 1, oy, 10, 10, 24, tier=tier)
        else:
            hall(v, x0, oy, x0 + ow + 2, oy + 16, 1, "y", seed + 2, door=("y+", None), windows=False)
        return main
    raise ValueError(f"mass {mass!r}")


def _tower(v, x, y, w, d, h, tier=2):
    """A plank drying tower: dark boards with louvre slots, a small hip roof (thatch in the tier I look, else terracotta tiles)."""
    P.boarded(v, x, y, x + w, y + d, 1, h, m=BOARDS, batten=TIMBER_DARK, every=3)
    for z in range(5, h - 3, 4):
        for i in range(2, w - 2, 2):
            v.set(x + i, y + d - 1, z, TIMBER_DARK)
            v.set(x + i, y + d - 1, z + 1, TIMBER_DARK)
        for j in range(2, d - 2, 2):
            v.set(x, y + j, z, TIMBER_DARK)
    if tier == 1:
        r = P.roof(v, x, x + w, y, y + d, h, "thatch", along="x", rise=1.2, ov=1, gable=BOARDS, seed=seed_of(x, y), m=THATCH, hip=True)
        W.thatch_finish(v, r, seed_of(x, y))
        return
    P.roof(v, x, x + w, y, y + d, h, "tiles", along="x", rise=1.2, ov=1, gable=BOARDS, seed=seed_of(x, y), m=TERRACOTTA, hip=True)


def seed_of(x, y):
    return x * 7 + y

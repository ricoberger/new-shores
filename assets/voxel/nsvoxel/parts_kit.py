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


def hall(v, x0, y0, x1, y1, tier, along="x", seed=0, door=None, storeys=None, smoke=False, chim=None, rise=None, windows=True, wins=None, ov=None, hip=False, stone=None, chimney=False, plinth=None):
    """
    The main block in the vocabulary of `tier` (1–4) over x0..x1 × y0..y1. `door` = (side, a) with `a` the first
    voxel of a four-wide door along the side (default: the middle of the y+ face); `storeys` = (ground, top) of
    tiers II–IV (tier I: wall height); `smoke` sets the chimney and smoke anchors with a slim chimney at `chim`.
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
    g, t = storeys or ((10, 19) if tier == 2 else (11, 22) if tier == 3 else (9, 24))
    if tier == 4:
        parts = (g - 1, (t - g + 1) // 2, (t - g + 1) - (t - g + 1) // 2)
        b = Q.palazzo(v, x0, y0, x1, y1, parts, upper=CREAM, base=ASHLAR, roof=SLATE, kind="slate", along=along, rise=rise or 1.5, ov=ov or 1, seed=seed, ridge=SLATE_RIDGE, shades=(1.18, 0.8), verge=0.66, hip=hip)
        face = b.face
        r = b.roof
        _openings(v, face, (x0, y0, x1, y1), tier, side, a, windows, wins, 2, g)
    else:
        kw = {}
        if tier == 3:
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
        _openings(v, face, (x0, y0, x1, y1), tier, side, a, windows, wins, 2, g)
    if smoke or chimney:
        sx, sy = cx, cy
        W.stack(v, sx, sy, 1, r.ridge_z + 4, 2, 2)
        if smoke:
            v.anchor("chimney", sx + 1.0, sy + 1.0, r.ridge_z + 7)
            v.anchor("smoke", sx + 1.0, sy + 1.0, r.ridge_z + 8)
    return SimpleNamespace(roof=r, ridge=r.ridge_z, face=face, top=t, rect=(x0, y0, x1, y1), tier=tier, b=b)


def _openings(v, face, rect, tier, side, a, windows, wins, z0, g):
    """The front door and the ground windows either side of it (tier styles)."""
    x0, y0, x1, y1 = rect
    lo, hi = (x0, x1) if side in ("y+", "y-") else (y0, y1)
    if a is not None:
        f = face(side)
        if tier == 1:
            P.entrance(f, a, 2, 4, 7, leaf=TIMBER_LIGHT, frame=TIMBER, step=PLINTH, steps=1)
        elif tier == 4:
            P.entrance(f, a, 2, 4, 8, leaf=TIMBER, frame=DRESSED, lintel=DRESSED, steps=2)
        else:
            P.entrance(f, a, 2, 4, 7 if tier == 2 else 8, leaf=TIMBER_LIGHT if tier == 2 else TIMBER, frame=DRESSED, lintel=DRESSED, steps=1)
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
            P.casement(f, p, 4, 3, 4, frame=DRESSED, sill=DRESSED, lintel=DRESSED, bars=False)
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

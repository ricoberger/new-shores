"""
Parts added for the tier-3 (Merchants) recipes (D-057 V4), on top of the
v2 parts in detail.py (which stay unchanged): the merchant townhouse block
(tall coursed-stone ground floor, jettied half-timber upper storey in any
timber colour, a jettied gable), oriels, balconies, shop fronts with
awnings, flat signboards and hoist beams; round work pieces (vats,
kettles, domes, round towers, conical heaps), drying and hide frames,
louvred walls, stacks of bricks, paper and books, hop poles and mine
hills with seams.

Recipes import it next to the parts: `from nsvoxel import detail_v4 as V`.
Conventions as in parts.py / detail.py: voxels (8 per tile), x east, y to
the front (+y), z up from the ground plate (z = 0); facades through Face;
hidden volumes filled solid; flat palette colours (the shader jitters),
authored shade steps only where they are structure (courses, staves,
stacks, terraces).
"""

import math

from . import parts as _p  # first: parts imports detail at its end
from . import detail as _d
from .grid import hash3, mat, shade_of
from .mats import (
    BRASS,
    CANVAS,
    IRON,
    PLANK,
    STONE,
    STONE_DARK,
    TIMBER,
    TIMBER_DARK,
    TIMBER_LIGHT,
    WINDOW,
)

Face = _p.Face

#: Copper (kettles, vent hoods, still domes): brass in a deeper, redder shade.
COPPER = mat("brass", 0.82)
#: Copper gone green (old domes): the shallows' teal, darkened.
VERDIGRIS = mat("shallows", 0.78)

# ---------------------------------------------------------------- the merchant townhouse


def townhouse(v, x0, y0, x1, y1, along="x", ground=9, top=17, infill=None, frame=TIMBER_DARK, roof=None, kind="tiles", rise=None, hip=False, seed=0, spacing=4, braces=True, rail=None, gable_jetty=True, z0=1, ov=1):
    """
    A merchant's townhouse block (tier 3): a proud plinth at z0, a tall
    coursed-stone ground floor with dressed quoins up to `ground`, a jetty
    of joist ends, a half-timbered upper storey (frame in any colour,
    optional mid `rail`) one voxel wider on every side up to `top`, and a
    roof of courses (`roof` material, kind tiles/slate/thatch). With
    gable_jetty the gable ends stand one voxel proud again over a second
    row of joist ends (the jettied attic of a gabled house); the attic is
    filled solid. Returns a detail.Building (ground and upper blocks,
    faces, roof).
    """
    infill = infill or mat("ochre")
    _d.plinth(v, x0, y0, x1, y1, z0, STONE_DARK, out=1)
    _d.fill(v, x0, y0, x1, y1, z0, z0 + 1, STONE_DARK)
    _d.coursed_stone(v, x0, y0, x1, y1, z0 + 1, ground, STONE, seed)
    _d.dressed_quoins(v, x0, y0, x1, y1, z0 + 1, ground)
    _d.jetty_course(v, x0, y0, x1, y1, ground)
    ux0, uy0, ux1, uy1 = x0 - 1, y0 - 1, x1 + 1, y1 + 1
    _d.half_timber(v, ux0, uy0, ux1, uy1, ground + 1, top, infill, frame, spacing=spacing, braces=braces, rail=rail, sill=False)
    rx0, rx1, ry0, ry1 = ux0, ux1, uy0, uy1
    if gable_jetty and not hip:
        # The gable ends overhang the storey below by one more voxel.
        if along == "x":
            for y in range(uy0, uy1):
                v.set(ux0 - 1, y, top - 1, frame if y % 2 else PLANK)
                v.set(ux1, y, top - 1, frame if y % 2 else PLANK)
            rx0, rx1 = ux0 - 1, ux1 + 1
        else:
            for x in range(ux0, ux1):
                v.set(x, uy0 - 1, top - 1, frame if x % 2 else PLANK)
                v.set(x, uy1, top - 1, frame if x % 2 else PLANK)
            ry0, ry1 = uy0 - 1, uy1 + 1
    r = _d.roof(v, rx0, rx1, ry0, ry1, top, kind, along=along, rise=rise, ov=ov, gable=infill, seed=seed, hip=hip, m=roof)
    if gable_jetty and not hip:
        _gable_frame(v, r, along, frame, infill)
    return _d.Building(v, (x0, y0, x1, y1), (ux0, uy0, ux1, uy1), z0, ground, top, r)


def _gable_frame(v, r, along, frame, infill):
    """Timbers on the outer gable faces of a Roof: a king post up the middle and a collar beam half-way."""
    if along == "x":
        mid = (r.y0 + r.y1 - 1) / 2
        ends = (r.x0, r.x1 - 1)
        for x in ends:
            for z in range(r.z, r.ridge_z):
                for y in (math.floor(mid), math.ceil(mid)):
                    if v.get(x, y, z) == infill:
                        v.set(x, y, z, frame)
            zc = r.z + max(1, (r.ridge_z - r.z) // 2)
            for y in range(r.y0, r.y1):
                if v.get(x, y, zc) == infill:
                    v.set(x, y, zc, frame)
    else:
        mid = (r.x0 + r.x1 - 1) / 2
        ends = (r.y0, r.y1 - 1)
        for y in ends:
            for z in range(r.z, r.ridge_z):
                for x in (math.floor(mid), math.ceil(mid)):
                    if v.get(x, y, z) == infill:
                        v.set(x, y, z, frame)
            zc = r.z + max(1, (r.ridge_z - r.z) // 2)
            for x in range(r.x0, r.x1):
                if v.get(x, y, zc) == infill:
                    v.set(x, y, zc, frame)


def oriel(f, a, z, w=4, h=5, depth=2, wall=None, frame=TIMBER_DARK, roof=None, glass=WINDOW, corbel=STONE):
    """
    An oriel: a bay `depth` voxels out of a facade from z to z + h, w wide,
    glazed on its front (two lights) and cheeks, standing on stepped
    corbels (`corbel`) and capped by a little roof of `roof` that steps
    back to the wall. Frames in `frame`.
    """
    wall = wall or mat("plaster")
    roof = roof or mat("terracotta")
    for d in range(1, depth + 1):
        for i in range(w):
            for j in range(h):
                edge = i in (0, w - 1) or j in (0, h - 1)
                f.put(a + i, z + j, frame if edge else wall, out=d)
    # Front lights: glass between the posts (a mullion when w ≥ 5).
    for i in range(1, w - 1):
        for j in range(1, h - 1):
            f.put(a + i, z + j, frame if (w >= 5 and i == w // 2) or j == h // 2 + 1 and h >= 6 else glass, out=depth)
    # Cheeks: a light each side.
    if depth >= 2:
        for j in range(1, h - 1):
            for d in range(1, depth):
                f.put(a, z + j, glass if d == depth - 1 else frame, out=d)
                f.put(a + w - 1, z + j, glass if d == depth - 1 else frame, out=d)
    # Corbels: stepped back to the wall below.
    for k in range(depth):
        for d in range(1, depth + 1 - k):
            for i in range(k, w - k):
                f.put(a + i, z - 1 - k, corbel, out=d)
    # Roof: courses stepping back to the wall over the bay.
    for d in range(depth, 0, -1):
        zz = z + h + (depth - d)
        for i in range(-1, w + 1):
            f.put(a + i, zz, shade_of(roof, 1.0 if d % 2 else 0.92), out=d)
    for i in range(-1, w + 1):
        f.put(a + i, z + h - 1, TIMBER_DARK, out=depth + 1)


def balcony(f, a0, a1, z, depth=2, floor=PLANK, rail=TIMBER, brackets=TIMBER_DARK, flowers=None):
    """A balcony on a facade from a0 to a1 at floor level z: plank floor `depth` out on brackets, balusters every other voxel, a hand rail, optional flower pots."""
    for i in range(a0, a1):
        for d in range(1, depth + 1):
            f.put(i, z, floor, out=d)
        f.put(i, z + 1, rail if (i - a0) % 2 == 0 or i == a1 - 1 else None, out=depth)
        f.put(i, z + 2, TIMBER_DARK, out=depth)
    for d in range(1, depth + 1):
        f.put(a0, z + 1, rail, out=d)
        f.put(a0, z + 2, TIMBER_DARK, out=d)
        f.put(a1 - 1, z + 1, rail, out=d)
        f.put(a1 - 1, z + 2, TIMBER_DARK, out=d)
    for i in (a0, a1 - 1):
        f.put(i, z - 1, brackets, out=1)
    if flowers is not None:
        for i in range(a0 + 1, a1 - 1, 3):
            f.put(i, z + 3, flowers, out=depth)


def shop_front(f, a, z, w=6, h=4, frame=TIMBER_DARK, goods=(), glass=WINDOW, board=None):
    """
    A shop front: a wide display window (glass one voxel back) in a heavy
    frame with a counter sill one voxel proud carrying goods (materials
    cycled), and an optional fascia board in `board` above it.
    """
    for i in range(-1, w + 1):
        for j in range(-1, h + 1):
            if 0 <= i < w and 0 <= j < h:
                f.put(a + i, z + j, None)
                f.put(a + i, z + j, glass, out=-1)
            else:
                f.put(a + i, z + j, frame)
    for i in range(0, w, 3):
        for j in range(h):
            if 0 < i < w:
                f.put(a + i, z + j, frame, out=-1)
    for i in range(-1, w + 1):
        f.put(a + i, z - 1, PLANK, out=1)
    for k, i in enumerate(range(0, w)):
        if goods:
            f.put(a + i, z, goods[k % len(goods)], out=1 if i % 2 == 0 else -1)
    if board is not None:
        for i in range(-1, w + 1):
            f.put(a + i, z + h + 1, board, out=1)


def face_awning(f, a0, a1, z, depth=3, stripes=(CANVAS, mat("terracotta", 1.05)), posts=False):
    """A striped awning out of a facade from a0 to a1, sloping down one voxel every two out from z; optional poles at its front corners."""
    for d in range(1, depth + 1):
        for i in range(a0, a1):
            f.put(i, z - (d - 1) // 2, stripes[((i - a0) // 2) % len(stripes)], out=d)
    if posts:
        zf = z - (depth - 1) // 2
        for i in (a0, a1 - 1):
            for zz in range(1, zf):
                f.put(i, zz, TIMBER, out=depth)


def signboard(f, a, z, w=5, h=3, colour=None, frame=TIMBER_DARK, board=PLANK, mark=None, out=1):
    """A flat signboard on a facade: a framed board `out` voxels proud with a mark in the good's colour (a bar, or the cells of `mark` (i, j) pairs)."""
    for i in range(-1, w + 1):
        for j in range(-1, h + 1):
            edge = i in (-1, w) or j in (-1, h)
            f.put(a + i, z + j, frame if edge else board, out=out)
    if colour is not None:
        cells = mark if mark is not None else [(i, h // 2) for i in range(1, w - 1)]
        for i, j in cells:
            f.put(a + i, z + j, colour, out=out)


def hoist(f, a, z, length=3, rope=4, load=None):
    """A hoist beam out of a gable at height z with a pulley, a rope `rope` voxels down and an optional hanging load (a 2 × 2 sack or crate material)."""
    for k in range(1, length + 1):
        f.put(a, z, TIMBER_DARK, out=k)
    f.put(a, z - 1, IRON, out=length)
    for j in range(2, rope + 1):
        f.put(a, z - j, mat("canvas", 0.85), out=length)
    if load is not None:
        for dz in range(2):
            for i in (0, 1):
                f.put(a + i, z - rope - 1 - dz, load, out=length)


def cross_gable(v, b, x0, x1, infill, frame=TIMBER_DARK, roof=None, kind="tiles", rise=1.5):
    """
    A cross gable (wall dormer) on the front of an along-x townhouse b: the
    upper storey's front wall rises from x0 to x1 into a gable of its own
    (framed, flush with the facade) under a roof along y that runs back
    into the main roof. The main eave in front of it is cut away. Returns
    the cross gable's Roof (its gable face is b's upper front plane).
    """
    r = b.roof
    yf = b.upper[3] - 1
    top = b.wall_top
    for x in range(x0 - 1, x1 + 1):
        for y in range(yf + 1, yf + 4):
            for z in range(top - 1, top + 4):
                v.set(x, y, z, None)
    yb = (r.y0 + r.y1) // 2
    rr = _d.roof(v, x0, x1, yb, yf + 1, top, kind, along="y", rise=rise, ov=1, gable=infill, m=roof, eaves=True)
    for x in range(x0, x1):
        v.set(x, yf, top - 1, frame)
    _gable_frame(v, rr, "y", frame, infill)
    return rr


def stepped_gable(v, r, side, m=STONE, coping=None, step=2, above=2):
    """
    A crow-stepped stone gable on the `side` ("x-" or "x+") end of an
    along-x Roof r: the outer gable layer becomes coursed stone standing
    `above` voxels over the roof in steps `step` voxels wide, each step
    capped with a coping stone; the verge overhang there is removed.
    """
    coping = coping or _d.DRESSED
    x = r.x0 if side == "x-" else r.x1 - 1
    xo = x - r.ov if side == "x-" else x + r.ov
    lo, hi = r.y0 - r.ov, r.y1 + r.ov - 1
    for y in range(lo, hi + 1):
        for z in range(r.z - 1, r.top + 2):
            for xx in ((xo,) if r.ov == 1 else range(min(x, xo), max(x, xo) + 1)):
                if xx != x:
                    v.set(xx, y, z, None)
    mid = (r.y0 + r.y1 - 1) / 2.0
    for y in range(r.y0, r.y1):
        # The step's height: the roof surface at the step cell nearest the ridge, plus `above`.
        d = abs(y + 0.5 - (mid + 0.5))
        k = int(d) // step * step
        yy = int(round(mid - k)) if y <= mid else int(round(mid + k))
        yy = min(max(yy, r.y0), r.y1 - 1)
        h = r.surface(x, yy) + above
        for z in range(r.z, h):
            c = m if ((z // 2) + y // 3) % 2 == 0 else shade_of(m, 0.93)
            v.set(x, y, z, c)
        v.set(x, y, h, coping)


# ---------------------------------------------------------------- heaps, hills and pits


def heap(v, cx, cy, r=3.5, h=4, m=None, cap=None, seed=0, z=1, ragged=0.7):
    """
    A conical heap (salt, coal, clay, ore) of radius r and height h on the
    ground at z: layers shrinking upward with a ragged rim (hashed), an
    optional cap material on the top layer. Flat colour (the shader jitters).
    """
    m = m or STONE
    for zz in range(h):
        t = zz / max(1, h)
        rr = r * (1 - t) + 0.6
        for x in range(math.floor(cx - rr - 1), math.ceil(cx + rr + 1)):
            for y in range(math.floor(cy - rr - 1), math.ceil(cy + rr + 1)):
                d = math.hypot(x + 0.5 - cx, y + 0.5 - cy)
                if d <= rr - hash3(x, y, z + zz, seed + 13) * ragged:
                    v.set(x, y, z + zz, cap if (cap is not None and zz == h - 1) else m)


def mine_hill(v, x0, x1, y0, y1, peak=14, seam=None, share=0.06, seed=0, moss=None, slope=0.9):
    """
    The rock hill a mine strip cuts into (after iron_mine): rock bands three
    voxels high in two shades, a pale top layer (moss on the high parts),
    sloping down toward +y from `peak` and toward the sides; a hashed
    `share` of the rock cells in the `seam` material (ore, salt, coal) in
    lens-shaped runs along x so seams read as bands.
    """
    from .mats import MOSS, ROCK, ROCK_DEEP, ROCK_LIGHT

    moss = MOSS if moss is None else moss
    cx = (x0 + x1) / 2
    mid = y0 + (y1 - y0) // 2
    for x in range(x0, x1):
        for y in range(y0, y1):
            h = int(peak - abs(x + 0.5 - cx) * 0.5 - max(0, y - mid) * slope + hash3(x // 2, y // 2, 0, seed) * 2)
            for z in range(max(1, h)):
                if z == h - 1:
                    m = moss if h > peak - 4 else ROCK_LIGHT
                else:
                    m = ROCK if (z // 3) % 2 else ROCK_DEEP
                    # Seams: runs along x within a band (z // 3), hashed per run of 3.
                    if seam is not None and hash3(x // 3, y, z // 3, seed + 5) < share * 4 and (z % 3) != 2:
                        m = seam
                v.set(x, y, z, m)


def terraces(v, x0, y0, x1, y1, steps, m, edge=None, z=1, seed=0, open_side="y+"):
    """
    Stepped banks round a pit floor (the pit dug into the ground reads as
    terraces rising outward): `steps` rings, each one voxel wider and one
    higher outward, from the floor rectangle x0..x1 × y0..y1 outward; the
    `open_side` stays open (a ramp side). Ring tops get the `edge` shade.
    """
    edge = edge or shade_of(m, 1.12)
    for k in range(1, steps + 1):
        for x in range(x0 - k * 2, x1 + k * 2):
            for y in range(y0 - k * 2, y1 + k * 2):
                inside_prev = x0 - (k - 1) * 2 <= x < x1 + (k - 1) * 2 and y0 - (k - 1) * 2 <= y < y1 + (k - 1) * 2
                if inside_prev:
                    continue
                if open_side == "y+" and y >= y1:
                    continue
                if open_side == "y-" and y < y0:
                    continue
                for zz in range(z, z + k * 2):
                    v.set(x, y, zz, m if zz < z + k * 2 - 1 else edge)


# ---------------------------------------------------------------- crops


def hop_pole(v, x, y, h=11, seed=0, bine=None, cone=None, pole=TIMBER):
    """A hop pole h voxels high with a bine climbing it: ragged leaves round the pole, pale cones, the pole's top bare."""
    bine = bine or mat("hemp", 1.05)
    cone = cone or mat("pasture-mark", 1.0)
    v.box(x, y, 1, x + 1, y + 1, h + 1, pole)
    for z in range(2, h - 1):
        # Leaves in runs two voxels high (z // 2) so the bine stays a few big quads.
        for dx, dy in ((1, 0), (0, 1), (-1, 0), (0, -1)):
            hh = hash3(x + dx, y + dy, z // 2, seed + 21)
            if hh < 0.7 - (0.3 if z > h - 4 else 0):
                v.set(x + dx, y + dy, z, cone if hh < 0.14 and z % 2 else bine)


def leafy_rows(v, x0, y0, x1, y1, leaf, top=None, flower=None, along="y", pitch=3, furrow=1, h=2, seed=0, share=0.6, flowers=0.08):
    """
    Rows of leafy rosette plants (woad, cabbage-like crops) on ploughed
    soil: ridges `pitch − furrow` wide filled with `leaf`, a hashed `share`
    of the ridge cells one layer higher in `top` (or leaf) and a few
    flowers on top.
    """
    _d.soil_rows(v, x0, y0, x1, y1, along, pitch, 0, furrow=furrow)
    top = top or leaf
    for x in range(x0, x1):
        for y in range(y0, y1):
            i = (x - x0) if along == "y" else (y - y0)
            if i % pitch >= pitch - furrow:
                continue
            for z in range(1, h):
                v.set(x, y, z, leaf)
            hh = hash3(x, y, 63, seed)
            if hh < share:
                v.set(x, y, h, top)
                if flower is not None and hh < flowers:
                    v.set(x, y, h + 1, flower)

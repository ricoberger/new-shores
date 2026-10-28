"""Decor models (trees, bushes, rocks, crags, stumps, tufts, deposit outcrops) at 8 voxels per tile, centred on the origin."""

import math

from nsvoxel.grid import hash3, mat, shade_of
from nsvoxel.mats import CROWN, FOREST, ROCK, ROCK_DEEP, ROCK_LIGHT, MOSS, TIMBER, TIMBER_DARK, TIMBER_LIGHT, GRASS_A, GRASS_B, FLOWER, IRON_ORE, STONE, PLANK


def _v(ctx):
    return ctx.vox(0, 0)


def noise3(x, y, z, seed, cell=2.5):
    """Smooth value noise in [0, 1): hash3 lattice every `cell` voxels, trilinear with a smoothstep."""
    fx, fy, fz = x / cell, y / cell, z / cell
    ix, iy, iz = math.floor(fx), math.floor(fy), math.floor(fz)
    tx, ty, tz = (t * t * (3 - 2 * t) for t in (fx - ix, fy - iy, fz - iz))

    def lerp(a, b, t):
        return a + (b - a) * t

    c = [[[hash3(ix + i, iy + j, iz + k, seed) for k in (0, 1)] for j in (0, 1)] for i in (0, 1)]
    return lerp(
        lerp(lerp(c[0][0][0], c[0][0][1], tz), lerp(c[0][1][0], c[0][1][1], tz), ty),
        lerp(lerp(c[1][0][0], c[1][0][1], tz), lerp(c[1][1][0], c[1][1][1], tz), ty),
        tx,
    )


def canopy(v, blobs, base, seed, hole=0.14, rough=0.42, light=1.13, dark=0.84, sway="canopy"):
    """
    An irregular leaf canopy: the union of ellipsoid lobes (cx, cy, cz, rx,
    ry, rz) with a value-noise surface, holes in the rim, sunlit top cells,
    a darker underside and a few lighter leaf clumps. The cells carry the
    canopy sway group (the client's wind sway; ordinary normals).
    """
    leaf = mat(base[0], base[1], sway)
    x0 = math.floor(min(b[0] - b[3] for b in blobs)) - 1
    x1 = math.ceil(max(b[0] + b[3] for b in blobs)) + 1
    y0 = math.floor(min(b[1] - b[4] for b in blobs)) - 1
    y1 = math.ceil(max(b[1] + b[4] for b in blobs)) + 1
    z0 = math.floor(min(b[2] - b[5] for b in blobs)) - 1
    z1 = math.ceil(max(b[2] + b[5] for b in blobs)) + 1
    lo = min(b[2] for b in blobs)
    cells = set()
    for x in range(x0, x1 + 1):
        for y in range(y0, y1 + 1):
            for z in range(max(0, z0), z1 + 1):
                d = min(math.sqrt(((x + 0.5 - b[0]) / b[3]) ** 2 + ((y + 0.5 - b[1]) / b[4]) ** 2 + ((z + 0.5 - b[2]) / b[5]) ** 2) for b in blobs)
                if d <= 1.0 + rough * (noise3(x, y, z, seed) - 0.5):
                    cells.add((x, y, z))
    # Holes and a ragged rim: drop some cells open to the side.
    for x, y, z in sorted(cells):
        side = sum((x + dx, y + dy, z) not in cells for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))
        if side >= 2 and hash3(x, y, z, seed + 11) < hole * side:
            cells.discard((x, y, z))
    for x, y, z in cells:
        top = (x, y, z + 1) not in cells
        if top:
            f = light * (1.08 if hash3(x // 2, y // 2, z, seed + 3) < 0.25 else 1.0)
        elif z + 0.5 < lo - 0.4:
            f = dark
        else:
            f = 1.0 if hash3(x // 2, y // 2, z // 2, seed + 5) < 0.75 else 0.93
        v.set(x, y, z, shade_of(leaf, f))
    return cells


def trunk(v, h, m=TIMBER, w=1):
    v.box(0, 0, 0, w, w, h, m)
    # Root flare: one voxel at the foot on two sides.
    v.set(-1, 0, 0, m)
    v.set(w, w - 1, 0, m)


def branch(v, a, b, m=TIMBER):
    v.line(a, b, m)


def tree_a(ctx):
    """Oak: a broad lumpy crown on a stout trunk, two branches into its lobes."""
    v = _v(ctx)
    trunk(v, 5)
    branch(v, (0, 0, 3), (-2, 1, 5))
    branch(v, (0, 0, 4), (2, -1, 6))
    canopy(v, [(0.5, 0.5, 6.4, 2.9, 2.9, 2.3), (-1.6, 1.4, 5.6, 2.2, 2.0, 1.8), (2.4, -0.9, 6.0, 2.0, 2.2, 1.9), (0.8, -0.2, 8.0, 1.9, 1.9, 1.5)], CROWN, 1)
    return v


def tree_b(ctx):
    """Beech: tall, light green, a crown of stacked lobes over a long bare trunk."""
    v = _v(ctx)
    trunk(v, 7, TIMBER_LIGHT)
    branch(v, (0, 0, 4), (2, 0, 6), TIMBER_LIGHT)
    branch(v, (0, 0, 5), (-2, -1, 8), TIMBER_LIGHT)
    canopy(v, [(1.4, 0.5, 6.4, 2.2, 2.1, 1.7), (-0.9, -0.2, 8.6, 2.2, 2.0, 1.8), (0.5, 0.6, 10.2, 1.6, 1.6, 1.4)], mat("grass-a", 0.92), 2, light=1.1)
    return v


def tree_c(ctx):
    """Conifer: ragged tiers narrowing to a spike, dark needles, no sway at the stem."""
    v = _v(ctx)
    v.box(0, 0, 0, 1, 1, 4, TIMBER_DARK)
    needles = mat("forest-floor", 0.95, "canopy")
    z = 2
    for i, r in enumerate((3.4, 2.9, 2.4, 1.9, 1.4, 0.9)):
        for x in range(-4, 5):
            for y in range(-4, 5):
                d = math.hypot(x, y)
                rr = r + (hash3(x, y, i, 7) - 0.5) * 1.1
                if d > rr:
                    continue
                f = 1.12 if d > rr - 1.0 else 0.92
                v.set(x, y, z, shade_of(needles, f * (0.9 if i == 0 else 1.0)))
                if d < rr - 0.8:
                    v.set(x, y, z + 1, shade_of(needles, 1.0 + 0.04 * i))
        z += 2
    v.set(0, 0, z, shade_of(needles, 1.2))
    v.set(0, 0, z + 1, shade_of(needles, 1.2))
    return v


def tree_d(ctx):
    """Birch: a slender pale trunk with dark marks, a loose small crown of light leaves."""
    v = _v(ctx)
    bark = mat("canvas", 0.95)
    v.box(0, 0, 0, 1, 1, 7, bark)
    for z in (1, 3, 4, 6):
        v.set(0, 0, z, mat("iron", 1.2))
    branch(v, (0, 0, 5), (2, 1, 7), bark)
    canopy(v, [(0.6, 0.6, 7.6, 2.0, 2.0, 2.2), (1.8, 1.0, 6.4, 1.4, 1.3, 1.2), (-0.6, -0.4, 9.0, 1.4, 1.4, 1.3)], mat("grass-b", 1.0), 4, hole=0.22, light=1.08)
    return v


def bush(seed, r=1.6, h=2.0, base=CROWN, berry=None):
    def b(ctx):
        v = _v(ctx)
        cells = canopy(v, [(0.0, 0.0, h * 0.55, r, r, h * 0.6), (r * 0.6, -r * 0.3, h * 0.4, r * 0.7, r * 0.7, h * 0.45)], base, seed, hole=0.1, sway=None)
        if berry:
            for x, y, z in sorted(cells):
                if (x, y, z + 1) not in cells and hash3(x, y, z, seed + 21) < 0.3:
                    v.set(x, y, z, berry)
        return v

    return b


def rock(n, rx, ry, h, seed):
    def b(ctx):
        v = _v(ctx)
        for x in range(-rx, rx + 1):
            for y in range(-ry, ry + 1):
                d = (x / (rx + 0.5)) ** 2 + (y / (ry + 0.5)) ** 2
                if d > 1:
                    continue
                hh = max(1, int(round(h * (1 - d) + hash3(x, y, 0, seed) * 1.2)))
                for z in range(hh):
                    m = ROCK_LIGHT if z == hh - 1 else (ROCK if z > 0 else ROCK_DEEP)
                    v.set(x, y, z, m)
        if n == "moss":
            v.set(0, 0, h, MOSS)
        return v

    return b


def crag(seed, h):
    """A tall stepped crag for the mountain plateaus (about 0.8 tile across)."""

    def b(ctx):
        v = _v(ctx)
        for x in range(-3, 4):
            for y in range(-3, 4):
                d = (x * x + y * y) / 12.0
                if d > 1.05:
                    continue
                hh = int(round(h * (1 - d * 0.75) - hash3(x, y, 1, seed) * 2.5))
                for z in range(max(1, hh)):
                    band = (z + int(hash3(x, y, 2, seed) * 2)) // 2 % 3
                    m = (ROCK_LIGHT, ROCK, ROCK_DEEP)[band] if z < hh - 1 else ROCK_LIGHT
                    v.set(x, y, z, m)
        return v

    return b


def stump(r):
    def b(ctx):
        v = _v(ctx)
        v.box(0, 0, 0, r, r, 2, TIMBER)
        v.box(0, 0, 1, r, r, 2, TIMBER_LIGHT)
        return v

    return b


def tuft(seed):
    def b(ctx):
        v = _v(ctx)
        for x, y, h in ((0, 0, 3), (1, 0, 2), (0, 1, 2)) if seed == 0 else ((0, 0, 3), (-1, 0, 2)):
            for z in range(h):
                v.set(x, y, z, shade_of(GRASS_B, 1.1) if z == h - 1 else GRASS_B)
        return v

    return b


def flowers(heads, seed):
    """A clump of flowers (16 voxels per tile): stems of two or three voxels, one coloured head each."""

    def b(ctx):
        v = _v(ctx)
        for i, (x, y) in enumerate(((0, 0), (2, 1), (-1, 2), (1, -2), (-2, -1))):
            h = 2 + int(hash3(x, y, 0, seed) * 2)
            for z in range(h):
                v.set(x, y, z, GRASS_B if z else shade_of(GRASS_A, 0.9))
            v.set(x, y, h, heads[i % len(heads)])
        return v

    return b


def mushrooms(seed):
    """Two toadstools (16 voxels per tile): pale stems, red caps with white dots."""

    def b(ctx):
        v = _v(ctx)
        cap = mat("orchard-mark", 1.05)
        for cx, cy, h, r in ((0, 0, 3, 1), (3, 1, 2, 0)):
            v.box(cx, cy, 0, cx + 1, cy + 1, h, mat("canvas", 0.95))
            v.box(cx - r, cy - r, h, cx + r + 1, cy + r + 1, h + 1, cap)
            if r:
                v.set(cx, cy, h + 1, cap)
                v.set(cx - 1, cy, h, mat("canvas", 1.05))
                v.set(cx + 1, cy + 1, h, mat("canvas", 1.05))
        return v

    return b


def log(n):
    """A fallen log along x: bark, light cut ends, moss on top."""

    def b(ctx):
        v = _v(ctx)
        for x in range(-n // 2, n - n // 2):
            v.set(x, 0, 0, TIMBER)
            v.set(x, 1, 0, shade_of(TIMBER, 0.9))
            if hash3(x, 0, 1, n) < 0.45:
                v.set(x, 0, 1, MOSS)
        for x in (-n // 2, n - n // 2 - 1):
            v.set(x, 0, 0, TIMBER_LIGHT)
            v.set(x, 1, 0, TIMBER_LIGHT)
        return v

    return b


def pebbles(seed):
    """Beach pebbles (16 voxels per tile): a loose handful of grey and sandy stones."""

    def b(ctx):
        v = _v(ctx)
        for i in range(6):
            x = int(hash3(i, 0, 0, seed) * 7) - 3
            y = int(hash3(i, 1, 0, seed) * 7) - 3
            m = (ROCK_LIGHT, ROCK, mat("sand", 0.86), mat("mountain", 1.1))[int(hash3(i, 2, 0, seed) * 4)]
            v.set(x, y, 0, m)
            if i % 3 == 0:
                v.set(x + 1, y, 0, m)
                v.set(x, y, 1, shade_of(m, 1.1))
        return v

    return b


def reeds(seed):
    """Dune grass (16 voxels per tile): pale dry blades of three to five voxels."""

    def b(ctx):
        v = _v(ctx)
        for i, (x, y) in enumerate(((0, 0), (1, 1), (-1, 1), (2, -1))):
            h = 3 + int(hash3(x, y, 0, seed) * 3)
            for z in range(h):
                v.set(x, y, z, mat("dry", 1.08 if z == h - 1 else (0.9 if z == 0 else 1.0)))
        return v

    return b


def fern(seed):
    """A forest-floor fern (16 voxels per tile): fronds splayed out low from a centre."""

    def b(ctx):
        v = _v(ctx)
        g = mat("forest-floor", 1.25)
        v.box(0, 0, 0, 1, 1, 2, g)
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            for k in range(1, 4):
                v.set(dx * k, dy * k, 2 if k < 3 else 1, shade_of(g, 1.1 if k == 1 else 0.95))
        if seed:
            for dx, dy in ((1, -1), (-1, 1)):
                v.set(dx * 2, dy * 2, 1, shade_of(g, 0.9))
        return v

    return b


def outcrop(m):
    """Deposit outcrop: a boulder cluster with veins of the deposit colour (tinted per kind by the client)."""

    def b(ctx):
        v = _v(ctx)
        for cx, cy, r, h, s in ((-1, -1, 2.6, 3, 1), (2, 1, 2.0, 2, 2), (-2, 2, 1.6, 2, 3)):
            for x in range(int(cx - r) - 1, int(cx + r) + 2):
                for y in range(int(cy - r) - 1, int(cy + r) + 2):
                    d = ((x - cx) ** 2 + (y - cy) ** 2) / (r * r)
                    if d > 1:
                        continue
                    hh = max(1, int(round(h * (1.2 - d))))
                    for z in range(hh):
                        vein = hash3(x, y, z, s) < 0.22
                        v.set(x, y, z, m if vein else (ROCK_LIGHT if z == hh - 1 else ROCK))
        return v

    return b


RECIPES = {
    "decor_tree_a": {"build": tree_a},
    "decor_tree_b": {"build": tree_b},
    "decor_tree_c": {"build": tree_c},
    "decor_tree_d": {"build": tree_d},
    "decor_bush_a": {"build": bush(1, 2.2, 2.4)},
    "decor_bush_b": {"build": bush(2, 1.9, 2.8, shade_of(CROWN, 0.92), mat("orchard-mark", 1.0))},
    "decor_bush_c": {"build": bush(3, 2.4, 1.8, shade_of(FOREST, 1.1), FLOWER)},
    "decor_rock_a": {"build": rock("moss", 1, 1, 3, 1)},
    "decor_rock_b": {"build": rock("", 1, 0, 2, 2)},
    "decor_rock_c": {"build": rock("", 2, 2, 2, 3)},
    "decor_crag_a": {"build": crag(1, 6)},
    "decor_crag_b": {"build": crag(2, 7)},
    "decor_crag_c": {"build": crag(3, 6)},
    "decor_stump_a": {"build": stump(2)},
    "decor_stump_b": {"build": stump(1)},
    "decor_tuft_a": {"build": tuft(0), "scale": 16},
    "decor_tuft_b": {"build": tuft(1), "scale": 16},
    "decor_flowers_a": {"build": flowers((FLOWER, mat("canvas", 1.05), FLOWER), 1), "scale": 16},
    "decor_flowers_b": {"build": flowers((mat("orchard-mark", 1.1), mat("dye-blue", 1.25), mat("canvas", 1.05)), 2), "scale": 16},
    "decor_mushroom_a": {"build": mushrooms(1), "scale": 16},
    "decor_log_a": {"build": log(5)},
    "decor_pebbles_a": {"build": pebbles(1), "scale": 16},
    "decor_pebbles_b": {"build": pebbles(2), "scale": 16},
    "decor_reeds_a": {"build": reeds(1), "scale": 16},
    "decor_fern_a": {"build": fern(0), "scale": 16},
    "decor_fern_b": {"build": fern(1), "scale": 16},
    "decor_outcrop_iron": {"build": outcrop(IRON_ORE)},
    "decor_outcrop_other": {"build": outcrop(STONE)},
    "decor_outcrop_stone": {"build": outcrop(mat("stone", 1.1))},
}


"""Decor models (trees, bushes, rocks, crags, stumps, tufts, deposit outcrops) at 8 voxels per tile, centred on the origin."""

from nsvoxel.grid import hash3, mat, shade_of
from nsvoxel.mats import CROWN, FOREST, ROCK, ROCK_DEEP, ROCK_LIGHT, MOSS, TIMBER, TIMBER_LIGHT, GRASS_A, GRASS_B, FLOWER, IRON_ORE, STONE, PLANK


def _v(ctx):
    return ctx.vox(0, 0)


def crown(v, cx, cy, cz, rx, ry, rz, base, seed, top=1.1, low=0.9):
    """A stepped crown: light top layers, darker underside, ragged rim by hash."""

    def keep(x, y, z):
        edge = ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 + ((z + 0.5 - cz) / rz) ** 2 > 0.7
        return not (edge and hash3(x, y, z, seed) < 0.3)

    v.ellipsoid(cx, cy, cz, rx, ry, rz, lambda x, y, z: shade_of(base, top if z + 0.5 >= cz + rz * 0.35 else (1.0 if z + 0.5 >= cz - rz * 0.3 else low)), keep)


def tree_a(ctx):
    """Round broadleaf."""
    v = _v(ctx)
    v.box(0, 0, 0, 1, 1, 4, TIMBER)
    crown(v, 0.5, 0.5, 6.0, 3.6, 3.6, 3.2, CROWN, 1)
    return v


def tree_b(ctx):
    """Tall broadleaf with two crown lobes."""
    v = _v(ctx)
    v.box(0, 0, 0, 1, 1, 6, TIMBER)
    v.set(1, 0, 3, TIMBER)
    crown(v, 1.0, 0.5, 5.0, 3.2, 3.0, 2.5, CROWN, 2)
    crown(v, -0.2, 0.2, 8.0, 2.6, 2.6, 2.2, CROWN, 3)
    return v


def tree_c(ctx):
    """Conifer: stacked square tiers."""
    v = _v(ctx)
    v.box(0, 0, 0, 1, 1, 3, TIMBER)
    z = 2
    for r in (3, 2, 2, 1, 1, 0):
        m = shade_of(FOREST, 1.0 + 0.06 * (3 - r))
        v.box(-r, -r, z, r + 1, r + 1, z + 2, m)
        if r:
            for cx, cy in ((-r, -r), (r, -r), (-r, r), (r, r)):
                v.set(cx, cy, z + 1, None)
        z += 2 if r > 1 else 1
    v.set(0, 0, z, shade_of(FOREST, 1.2))
    return v


def tree_d(ctx):
    """Low bushy broadleaf, wider than tall."""
    v = _v(ctx)
    v.box(0, 0, 0, 1, 1, 3, TIMBER)
    crown(v, 0.5, 0.5, 4.5, 3.8, 3.6, 2.4, shade_of(CROWN, 1.06), 4)
    return v


def bush(seed, r=1.6, h=2.4):
    def b(ctx):
        v = _v(ctx)
        crown(v, 0.0, 0.0, 1.0, r, r, h, CROWN, seed, top=1.12, low=0.95)
        if seed % 2:
            v.set(0, -1, 2, FLOWER)
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
    "decor_bush_a": {"build": bush(1)},
    "decor_bush_b": {"build": bush(2, 1.4, 3.0)},
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
    "decor_outcrop_iron": {"build": outcrop(IRON_ORE)},
    "decor_outcrop_other": {"build": outcrop(STONE)},
    "decor_outcrop_stone": {"build": outcrop(mat("stone", 1.1))},
}


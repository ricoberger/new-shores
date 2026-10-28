"""Ships (bow toward +x, waterline z = 0) at 20 voxels per tile: sloop, brig, galleon from one hull builder; cargo attachment of crates and barrels."""

from nsvoxel.grid import mat, shade_of
from nsvoxel.mats import BRASS, CANVAS, DYE_BLUE, OCHRE, PLANK, TERRACOTTA, TIMBER, TIMBER_DARK, TIMBER_LIGHT

SCALE = 20
SAIL = mat("canvas", 1.0, "sail")
SAIL_SHADE = mat("canvas", 0.92, "sail")
FLAG = mat("dye-blue", 1.0, "flag")


def half_beam(x, length, beam):
    """Half-width of the deck outline at x (stern −length/2, bow +length/2)."""
    h = length // 2
    t = (x + h) / length
    if t > 0.62:
        return max(1, int(round(beam * (1 - ((t - 0.62) / 0.38) ** 1.6))))
    if t < 0.1:
        return beam - 1
    return beam


def hull(v, length, beam, trim, castle):
    h = length // 2
    for x in range(-h, h):
        hw = half_beam(x, length, beam)
        for z in range(-3, 6):
            w = hw - (2 if z < -1 else 1 if z < 1 else 0)
            if w < 1:
                continue
            for y in range(-w, w):
                edge = y in (-w, w - 1) or x in (-h, h - 1) or z == -3
                if z <= 3 and not edge and z > -3:
                    continue
                if z < 1:
                    m = TIMBER_DARK
                elif z == 3:
                    m = trim
                else:
                    m = TIMBER
                v.set(x, y, z, m)
        # Deck and bulwark.
        for y in range(-hw + 1, hw - 1):
            v.set(x, y, 3, PLANK)
        for y in (-hw, hw - 1):
            v.set(x, y, 4, TIMBER_LIGHT)
            v.set(x, y, 5, TIMBER_LIGHT)
    # Transom and stern castle.
    if castle:
        cx0 = -h
        cx1 = -h + castle
        for x in range(cx0, cx1):
            hw = half_beam(x, length, beam)
            for y in range(-hw, hw):
                for z in range(4, 9):
                    edge = y in (-hw, hw - 1) or x in (cx0, cx1 - 1) or z == 8
                    if edge:
                        v.set(x, y, z, TIMBER if z < 8 else PLANK)
            for y in range(-hw + 1, hw - 1, 3):
                v.set(cx0, y, 6, mat("window"))
        for y in range(-beam, beam, 2):
            v.set(cx0, y, 9, TIMBER_LIGHT)
    # Bowsprit.
    for k in range(6):
        v.set(h + k - 1, 0, 5 + k // 2, TIMBER)


def mast(v, x, top, sails, yards=True):
    """Mast at x with stacked square sails (rows of canvas with a belly toward +x)."""
    v.box(x, 0, 4, x + 1, 1, top, TIMBER)
    v.box(x - 1, -1, top - 4, x + 2, 2, top - 3, TIMBER_DARK)
    for z0, z1, w in sails:
        for z in range(z0, z1):
            belly = 1 if z0 + 1 < z < z1 - 2 else 0
            for y in range(-w, w + 1):
                m = SAIL if (z - z0) % 4 else SAIL_SHADE
                v.set(x + 1 + belly, y, z, m)
        if yards:
            v.box(x + 1, -w - 1, z1, x + 2, w + 2, z1 + 1, TIMBER)
    v.box(x, 0, top, x + 1, 1, top + 1, BRASS)
    for k in range(4):
        v.set(x - 1 - k, 0, top - 1, FLAG)
        v.set(x - 1 - k, 0, top - 2, FLAG if k < 3 else None)


def gaff(v, x, z0, z1, aft):
    """A fore-and-aft gaff sail behind the mast at x."""
    for z in range(z0, z1):
        span = aft - (z1 - z) // 4
        for k in range(1, span):
            v.set(x - k, 0, z, SAIL if (k // 3) % 2 else SAIL_SHADE)
    v.box(x - aft, 0, z0 - 1, x, 1, z0, TIMBER)


def jib(v, x0, x1, z0, z1):
    """Triangular headsail from the mast top toward the bowsprit."""
    for x in range(x0, x1):
        t = (x - x0) / (x1 - x0)
        top = int(z1 - (z1 - z0) * t)
        for z in range(z0 + int(t * 2), top):
            v.set(x, 0, z, SAIL)


def sloop(ctx):
    v = ctx.vox(0, 0)
    hull(v, 40, 8, OCHRE, 0)
    mast(v, 2, 36, [], yards=False)
    gaff(v, 2, 7, 33, 16)
    jib(v, 4, 20, 7, 30)
    return v


def brig(ctx):
    v = ctx.vox(0, 0)
    hull(v, 52, 10, TERRACOTTA, 8)
    mast(v, 9, 48, [(10, 22, 7), (24, 34, 6), (36, 43, 4)])
    mast(v, -8, 44, [(12, 22, 6), (24, 33, 5), (35, 41, 4)])
    jib(v, 11, 28, 8, 40)
    return v


def galleon(ctx):
    v = ctx.vox(0, 0)
    hull(v, 64, 12, DYE_BLUE, 12)
    mast(v, 14, 56, [(10, 24, 9), (26, 38, 7), (40, 50, 5)])
    mast(v, -2, 62, [(10, 26, 10), (28, 42, 8), (44, 55, 6)])
    mast(v, -18, 48, [(14, 26, 6), (28, 38, 5)])
    jib(v, 16, 35, 8, 46)
    return v


def cargo(ctx):
    """Deck cargo shown while loaded: crates, barrels and a covered stack amidships."""
    v = ctx.vox(0, 0)
    for x, y in ((-6, -4), (-6, 1), (-2, -4), (-2, 2)):
        v.box(x, y, 4, x + 3, y + 3, 7, TIMBER_LIGHT)
        v.box(x, y, 6, x + 3, y + 3, 7, PLANK)
    for x, y in ((3, -3), (3, 1)):
        v.box(x, y, 4, x + 2, y + 2, 7, TIMBER)
        v.box(x, y, 5, x + 2, y + 2, 6, TIMBER_DARK)
    v.box(-6, -1, 7, -2, 2, 9, CANVAS)
    return v


RECIPES = {
    "sloop": {"build": sloop, "scale": SCALE, "cargo": cargo, "ship": {"length_tiles": 2.0, "masts": 3, "sail_scale": 1.0}},
    "brig": {"build": brig, "scale": SCALE, "cargo": cargo, "ship": {"length_tiles": 2.6, "masts": 2, "sail_scale": 1.0}},
    "galleon": {"build": galleon, "scale": SCALE, "cargo": cargo, "ship": {"length_tiles": 3.2, "masts": 3, "sail_scale": 1.0}},
}

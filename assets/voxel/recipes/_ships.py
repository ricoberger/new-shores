"""
Ships (bow toward +x, waterline z = 0) at 20 voxels per tile (D-057 §3,
V5): sloop, brig and galleon from one hull builder.

The hull: a tarred bottom, planking in courses (alternating shades), a
dark wale, a painted trim band in the ship's colour, a bulwark with a
pale rail cap, a deck of planks in courses, gunports on the brig and the
galleon, a bowsprit with a jib boom and a stem post. Masts 1 / 2 / 3
carry yards, a top and shrouds down to the rails; square sails and the
gaff and jib are sway groups ("sail"), the masthead pennants "flag". The
brig and galleon have a stern cabin with a row (two on the galleon) of
windows, a stern gallery and lanterns; the galleon a forecastle; the
sloop a tiller and a lantern on a stern post. Each ship's cargo
attachment shows one prop per cargo slot (2 / 4 / 6) on its free deck,
clear of masts, cabin and boom. Anchors: `status` (the pipeline's
default) and `wake` (the stern at the waterline, where the wake starts).
Hull lengths at the waterline are length_tiles × SCALE (2 / 2.6 / 3.2).
"""

from nsvoxel.grid import mat, shade_of
from nsvoxel.mats import BRASS, CANVAS, DYE_BLUE, OCHRE, PLANK, TERRACOTTA, TIMBER, TIMBER_DARK, TIMBER_LIGHT

SCALE = 20
SAIL = mat("canvas", 1.0, "sail")
SAIL_SHADE = mat("canvas", 0.92, "sail")
FLAG = mat("dye-blue", 1.0, "flag")
GLOW = mat("flower", 1.0)
WINDOW = mat("window")
ROPE = shade_of(TIMBER_DARK, 0.85)
BOTTOM = TIMBER_DARK
COURSE_A = TIMBER
COURSE_B = shade_of(TIMBER, 0.9)
WALE = shade_of(TIMBER_DARK, 0.9)
DECK_B = shade_of(PLANK, 0.93)

#: Hull length at the waterline in voxels (length_tiles × SCALE).
HULL_LENGTH = {"sloop": 40, "brig": 52, "galleon": 64}


def half_beam(x, length, beam):
    """Half-width of the deck outline at x (stern −length/2, bow +length/2)."""
    h = length // 2
    t = (x + h) / length
    if t > 0.62:
        return max(1, int(round(beam * (1 - ((t - 0.62) / 0.38) ** 1.6))))
    if t < 0.1:
        return beam - 1
    return beam


def shell(z, trim):
    """Hull side material by height: tarred bottom, two plank courses, the wale, the trim band."""
    if z < 0:
        return BOTTOM
    return (COURSE_A, COURSE_B, WALE, trim)[min(z, 3)]


def lantern(v, x, y, z):
    """A lantern on a post: a brass post, a glowing pane, a brass cap (top at z + 3)."""
    v.set(x, y, z, BRASS)
    v.set(x, y, z + 1, GLOW)
    v.set(x, y, z + 2, BRASS)


def hull(v, length, beam, trim, cabin=0, cabin_h=4, ports=(), forecastle=0):
    """
    The hull (see the module doc): `cabin` voxels of stern cabin aft,
    `cabin_h` high above the deck (8 = two rows of windows), gunports at
    the side x positions `ports`, a forecastle `forecastle` voxels long.
    Returns the half-length.
    """
    h = length // 2
    for x in range(-h, h):
        hw = half_beam(x, length, beam)
        for z in range(-3, 4):
            w = hw - (2 if z < -1 else 1 if z < 1 else 0)
            if w < 1:
                continue
            for y in range(-w, w):
                edge = y in (-w, w - 1) or x in (-h, h - 1) or z == -3
                if z == 3 and not edge:
                    v.set(x, y, z, PLANK if (y // 2) % 2 else DECK_B)
                elif edge:
                    v.set(x, y, z, shell(z, trim))
        # Bulwark and rail cap.
        ends = range(-hw, hw) if x in (-h, h - 1) else (-hw, hw - 1)
        for y in ends:
            v.set(x, y, 4, TIMBER)
            v.set(x, y, 5, TIMBER_LIGHT)
    for x in ports:
        hw = half_beam(x, length, beam)
        for y in (-hw, hw - 1):
            v.set(x, y, 1, TIMBER_DARK)
            v.set(x + 1, y, 1, TIMBER_DARK)
            v.set(x, y, 2, trim)
            v.set(x + 1, y, 2, trim)
    # Stem post and bowsprit with a jib boom.
    v.box(h - 1, -1, 3, h, 1, 7, TIMBER_DARK)
    n = length // 5
    for k in range(n):
        v.set(h + k, 0, 6 + k // 3, TIMBER)
    v.set(h + n, 0, 6 + n // 3, TIMBER_DARK)
    # Forecastle.
    if forecastle:
        for x in range(h - forecastle - 2, h - 2):
            hw = half_beam(x, length, beam)
            for y in range(-hw, hw):
                edge = y in (-hw, hw - 1) or x == h - forecastle - 2
                v.set(x, y, 4, TIMBER if edge else PLANK)
                v.set(x, y, 5, TIMBER if edge else None)
                v.set(x, y, 6, TIMBER_LIGHT if edge else None)
        for y in range(-half_beam(h - forecastle - 2, length, beam) + 2, half_beam(h - forecastle - 2, length, beam) - 2, 3):
            v.set(h - forecastle - 2, y, 4, TIMBER_DARK)  # a door and two shutters
    # Stern cabin with windows, a gallery and lanterns.
    if cabin:
        x0, x1 = -h, -h + cabin
        top = 4 + cabin_h
        for x in range(x0, x1):
            hw = half_beam(x, length, beam)
            for y in range(-hw, hw):
                for z in range(4, top):
                    if y in (-hw, hw - 1) or x in (x0, x1 - 1):
                        v.set(x, y, z, trim if z == top - 1 else TIMBER)
                v.set(x, y, top, PLANK if y % 2 else DECK_B)
            for y in (-hw, hw - 1):
                v.set(x, y, top + 1, TIMBER_LIGHT)
        hw = half_beam(x0, length, beam)
        rows = (6,) if cabin_h <= 5 else (6, 9)
        for z in rows:
            for y in range(-hw + 2, hw - 2, 3):
                v.set(x0, y, z, WINDOW)
            for x in range(x0 + 2, x1 - 2, 3):
                v.set(x, -hw, z, WINDOW)
                v.set(x, hw - 1, z, WINDOW)
        for y in range(-hw + 1, hw - 1):
            v.set(x0, y, top + 1, TIMBER_LIGHT)
        for y in range(-hw + 1, hw - 1):  # stern gallery
            v.set(x0 - 1, y, rows[-1] - 2, TIMBER_LIGHT)
            if y % 2 == 0:
                v.set(x0 - 1, y, rows[-1] - 1, TIMBER_LIGHT)
        lantern(v, x0, -hw + 1, top + 2)
        lantern(v, x0, hw - 2, top + 2)
        if cabin_h > 5:
            lantern(v, x0, 0, top + 2)
        v.box(x1 - 1, -1, 4, x1, 1, 7, TIMBER_DARK)  # door onto the deck
    return h


def shrouds(v, x, hw, z0, z1):
    """Shrouds from both rails (at z0) up to the mast at z1: a staircase per side (vertical runs merge cheaply)."""
    for side in (-1, 1):
        y0 = (hw - 1) if side > 0 else -hw
        for z in range(z0, z1):
            t = (z - z0) / max(1, z1 - z0)
            y = int(round(y0 * (1 - t) + side * 1 * t)) - (1 if side < 0 and t > 0.99 else 0)
            v.set(x, y, z, ROPE)


def mast(v, x, top, sails, hw, yards=True, top_z=None):
    """Mast at x with stacked square sails (canvas rows with a belly toward +x), yards, a top, shrouds and a pennant."""
    v.box(x, 0, 4, x + 1, 1, top, TIMBER)
    tz = top_z or (sails[0][1] + 1 if sails else top - 6)
    v.box(x - 1, -1, tz, x + 2, 2, tz + 1, PLANK)  # the top
    v.box(x - 1, -1, top - 4, x + 2, 2, top - 3, TIMBER_DARK)  # cross-trees
    for z0, z1, w in sails:
        for z in range(z0, z1):
            belly = 1 if z0 + 1 < z < z1 - 2 else 0
            for y in range(-w, w + 1):
                m = SAIL if (z - z0) % 4 else SAIL_SHADE
                v.set(x + 1 + belly, y, z, m)
        if yards:
            v.box(x + 1, -w - 1, z1, x + 2, w + 2, z1 + 1, TIMBER)
    shrouds(v, x - 1, hw, 6, tz)
    v.box(x, 0, top, x + 1, 1, top + 1, BRASS)
    for k in range(4):
        v.set(x - 1 - k, 0, top - 1, FLAG)
        v.set(x - 1 - k, 0, top - 2, FLAG if k < 3 else None)


def gaff(v, x, z0, z1, aft):
    """A fore-and-aft gaff sail behind the mast at x, on a boom and under a gaff."""
    for z in range(z0, z1):
        span = aft - (z1 - z) // 4
        for k in range(1, span):
            v.set(x - k, 0, z, SAIL if (k // 3) % 2 else SAIL_SHADE)
    v.box(x - aft, 0, z0 - 1, x, 1, z0, TIMBER)
    v.box(x - aft + (z1 - z0) // 4, 0, z1, x, 1, z1 + 1, TIMBER)


def jib(v, x0, x1, z0, z1):
    """Triangular headsail from the mast top toward the bowsprit, with its stay above."""
    for x in range(x0, x1):
        t = (x - x0) / (x1 - x0)
        top = int(z1 - (z1 - z0) * t)
        for z in range(z0 + int(t * 2), top):
            v.set(x, 0, z, SAIL)
        v.set(x, 0, top, ROPE)


def sloop(ctx):
    v = ctx.vox(0, 0)
    L = HULL_LENGTH["sloop"]
    h = hull(v, L, 8, OCHRE)
    mast(v, 2, 36, [], 8, yards=False, top_z=30)
    gaff(v, 2, 7, 33, 16)
    jib(v, 4, 20, 7, 30)
    # Tiller, a hatch and the stern lantern on its post.
    v.box(-h + 1, 0, 4, -h + 5, 1, 5, TIMBER_DARK)
    v.box(-4, -2, 4, 0, 2, 5, TIMBER_DARK)
    v.box(-h, 0, 4, -h + 1, 1, 8, TIMBER)
    lantern(v, -h, 0, 8)
    v.anchor("wake", -h, 0, 0)
    return v


def brig(ctx):
    v = ctx.vox(0, 0)
    L = HULL_LENGTH["brig"]
    h = hull(v, L, 10, TERRACOTTA, cabin=8, cabin_h=4, ports=(-14, -6, 2, 10))
    mast(v, 9, 48, [(10, 22, 7), (24, 34, 6), (36, 43, 4)], 10)
    mast(v, -8, 44, [(12, 22, 6), (24, 33, 5), (35, 41, 4)], 10)
    jib(v, 11, 28, 8, 40)
    v.anchor("wake", -h, 0, 0)
    return v


def galleon(ctx):
    v = ctx.vox(0, 0)
    L = HULL_LENGTH["galleon"]
    h = hull(v, L, 12, DYE_BLUE, cabin=12, cabin_h=8, ports=(-18, -12, -6, 0, 6, 12), forecastle=7)
    mast(v, 14, 56, [(10, 24, 9), (26, 38, 7), (40, 50, 5)], 10)
    mast(v, -2, 62, [(14, 26, 10), (28, 42, 8), (44, 55, 6)], 12)
    mast(v, -18, 48, [(16, 26, 6), (28, 38, 5)], 12)
    jib(v, 16, 35, 8, 46)
    v.anchor("wake", -h, 0, 0)
    return v


# ---------------------------------------------------------------- cargo

#: Deck spots (x, y) of the cargo props per ship, one per cargo slot (2 / 4 / 6), clear of masts, cabins and the sloop's boom.
CARGO_SPOTS = {
    "sloop": ((6, -4), (6, 1)),
    "brig": ((-5, -6), (-5, 2), (1, -6), (1, 2)),
    "galleon": ((-15, -7), (-15, 2), (-10, -3), (2, -7), (2, 2), (7, -3)),
}


def crate(v, x, y):
    """A crate: 4 × 4 × 3 with a plank lid band."""
    v.box(x, y, 4, x + 4, y + 4, 7, TIMBER_LIGHT)
    v.box(x, y, 6, x + 4, y + 4, 7, PLANK)


def barrels(v, x, y):
    """Two barrels side by side (2 × 2 × 3 each) with a dark hoop."""
    for dy in (0, 2):
        v.box(x + 1, y + dy, 4, x + 3, y + dy + 2, 7, TIMBER)
        v.box(x + 1, y + dy, 5, x + 3, y + dy + 2, 6, TIMBER_DARK)


def bale(v, x, y):
    """A bale under canvas: 4 × 4 × 2 with a lashing."""
    v.box(x, y, 4, x + 4, y + 4, 6, CANVAS)
    v.box(x + 1, y, 6, x + 3, y + 4, 7, CANVAS)
    v.box(x + 2, y, 4, x + 3, y + 4, 7, ROPE)


PROPS = (crate, barrels, bale)


def cargo(ctx):
    """Deck cargo shown while loaded: one prop per slot at the ship's CARGO_SPOTS (crates, barrels, bales in turn)."""
    v = ctx.vox(0, 0)
    spots = CARGO_SPOTS.get(ctx.cid, CARGO_SPOTS["brig"])
    n = int(ctx.defn.get("slots", len(spots)))
    for i, (x, y) in enumerate(spots[:n]):
        PROPS[i % len(PROPS)](v, x, y)
    return v


RECIPES = {
    "sloop": {"build": sloop, "scale": SCALE, "cargo": cargo, "ship": {"length_tiles": 2.0, "masts": 1, "sail_scale": 1.0}},
    "brig": {"build": brig, "scale": SCALE, "cargo": cargo, "ship": {"length_tiles": 2.6, "masts": 2, "sail_scale": 1.0}},
    "galleon": {"build": galleon, "scale": SCALE, "cargo": cargo, "ship": {"length_tiles": 3.2, "masts": 3, "sail_scale": 1.0}},
}

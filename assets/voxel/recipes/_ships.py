"""
Ships (bow toward +x, waterline z = 0) at 20 voxels per tile (D-057 §3,
V5): the Hanseatic ladder of D-075 §4 — cog, hulk and carrack — from one
hull builder.

The hull: a tarred bottom, planking in courses (alternating shades), a
dark wale, a painted trim band in the ship's colour, a bulwark with a
pale rail cap, a deck of planks in courses, gunports on the hulk and the
carrack, a bowsprit and a stem post. `sides` raises the bulwark in
clinker strakes (alternating shades, each strake's lower edge dark, the
overlap). Castles (`castle`) are raised decks on plank walls with a
painted rail and crenels. Square sails, the lateen and the jib are sway
groups ("sail"), the masthead pennants "flag".

- Cog: high clinker sides, one mast with one square sail, a stern castle
  with the tiller under it, a short bowsprit, a lantern on the castle.
- Hulk: the round hull with fore and stern castles (the stern one with a
  row of windows), two masts with square sails and a jib.
- Carrack: three masts — square sails on the fore- and mainmast, a
  lateen on the mizzen — a high two-storey forecastle, the stern cabin
  with two rows of windows, a gallery and lanterns.

Each ship's cargo attachment shows one prop per cargo slot (2 / 4 / 6) on
its free deck, clear of masts and castles. Anchors: `status` (the
pipeline's default) and `wake` (the stern at the waterline, where the
wake starts). Hull lengths at the waterline are length_tiles × SCALE
(2 / 2.6 / 3.2).

Lite (far LOD, V7): each ship has its own simplified lite model at
SCALE / 4 = 5 voxels per tile — the hull with its trim band, the masts,
the sails as flat slabs and the pennants, no cargo — so the far view
reads hull, masts and sail silhouettes within the lite budgets
(config.LITE_BUDGET_SHIPS). It shares the full model's anchors and
length.
"""

from nsvoxel.grid import mat, shade_of
from nsvoxel.mats import BRASS, CANVAS, DYE_BLUE, OCHRE, PLANK, TERRACOTTA, TIMBER, TIMBER_DARK, TIMBER_LIGHT

SCALE = 20
CRENELS = False
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
HULL_LENGTH = {"cog": 40, "hulk": 52, "carrack": 64}


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


def hull(v, length, beam, trim, cabin=0, cabin_h=4, ports=(), forecastle=0, sides=0, bowsprit=5):
    """
    The hull (see the module doc): `cabin` voxels of stern cabin aft,
    `cabin_h` high above the deck (8 = two rows of windows), gunports at
    the side x positions `ports`, a forecastle `forecastle` voxels long
    (one storey; castle() builds higher ones), `sides` extra clinker
    strakes above the bulwark, a bowsprit length / `bowsprit` voxels long.
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
        # Bulwark (clinker strakes when `sides`) and rail cap.
        ends = range(-hw, hw) if x in (-h, h - 1) else (-hw, hw - 1)
        for y in ends:
            v.set(x, y, 4, TIMBER)
            for k in range(sides):
                v.set(x, y, 5 + k, COURSE_A)
            v.set(x, y, 5 + sides, TIMBER_LIGHT)
    for x in ports:
        hw = half_beam(x, length, beam)
        for y in (-hw, hw - 1):
            v.set(x, y, 1, TIMBER_DARK)
            v.set(x + 1, y, 1, TIMBER_DARK)
            v.set(x, y, 2, trim)
            v.set(x + 1, y, 2, trim)
    # Stem post and bowsprit with a jib boom.
    v.box(h - 1, -1, 3, h, 1, 7, TIMBER_DARK)
    n = length // bowsprit
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


def castle(v, x0, x1, length, beam, floor, trim, windows=False):
    """
    A castle from x0 to x1 (exclusive) on the deck: plank walls along the
    hull sides and its open end up to the castle deck at `floor`, a painted
    rail above and crenels on top every other voxel; `windows` puts a row
    of windows into the side walls.
    """
    for x in range(x0, x1):
        hw = half_beam(x, length, beam)
        for y in range(-hw, hw):
            edge = y in (-hw, hw - 1) or x in (x0, x1 - 1)
            if edge:
                for z in range(4, floor + 1):
                    v.set(x, y, z, COURSE_A)
                v.set(x, y, floor + 1, trim)
                if CRENELS and (x + y) % 2 == 0:
                    v.set(x, y, floor + 2, TIMBER_LIGHT)
            else:
                v.set(x, y, floor, PLANK if y % 2 else DECK_B)
        if windows and (x - x0) % 3 == 1 and x0 < x < x1 - 1:
            v.set(x, -hw, floor - 2, WINDOW)
            v.set(x, hw - 1, floor - 2, WINDOW)


def lateen(v, x, fore, aft, z_low, z_high, foot):
    """A lateen sail beside the mast at x: the yard from `fore` voxels before the mast at z_low up to `aft` behind it at z_high, the sail below it down to a foot rising from z_low to `foot` aft."""
    x_lo, x_hi = x - aft, x + fore
    for xx in range(x_lo, x_hi + 1):
        t = (x_hi - xx) / (x_hi - x_lo)
        top = int(round(z_low + (z_high - z_low) * t))
        bottom = int(round(z_low + (foot - z_low) * t))
        for z in range(bottom, top):
            v.set(xx, 1, z, SAIL if (xx // 3) % 2 else SAIL_SHADE)
        v.set(xx, 1, top, TIMBER)


def shrouds(v, x, hw, z0, z1):
    """Shrouds from both rails (at z0) up to the mast at z1: a staircase per side (vertical runs merge cheaply)."""
    for side in (-1, 1):
        y0 = (hw - 1) if side > 0 else -hw
        for z in range(z0, z1):
            t = (z - z0) / max(1, z1 - z0)
            y = int(round(y0 * (1 - t) + side * 1 * t)) - (1 if side < 0 and t > 0.99 else 0)
            v.set(x, y, z, ROPE)


def mast(v, x, top, sails, hw, yards=True, top_z=None, stripes=True, rigging=True):
    """
    Mast at x with stacked square sails (canvas rows with a belly toward +x,
    shaded every fourth row unless not `stripes`), yards, a top, shrouds
    (unless not `rigging`) and a pennant.
    """
    v.box(x, 0, 4, x + 1, 1, top, TIMBER)
    tz = top_z or (sails[0][1] + 1 if sails else top - 6)
    v.box(x - 1, -1, tz, x + 2, 2, tz + 1, PLANK)  # the top
    v.box(x - 1, -1, top - 4, x + 2, 2, top - 3, TIMBER_DARK)  # cross-trees
    for z0, z1, w in sails:
        for z in range(z0, z1):
            belly = 1 if z0 + 1 < z < z1 - 2 else 0
            for y in range(-w, w + 1):
                m = SAIL if (z - z0) % 4 or not stripes else SAIL_SHADE
                v.set(x + 1 + belly, y, z, m)
        if yards:
            v.box(x + 1, -w - 1, z1, x + 2, w + 2, z1 + 1, TIMBER)
    if rigging:
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


def cog(ctx):
    v = ctx.vox(0, 0)
    L = HULL_LENGTH["cog"]
    h = hull(v, L, 8, OCHRE, sides=3, bowsprit=8)
    # The stern castle over the tiller, with the lantern on its rail.
    castle(v, -h, -h + 8, L, 8, 11, OCHRE)
    lantern(v, -h, 0, 14)
    mast(v, 1, 40, [(12, 34, 9)], 8, top_z=30, stripes=True, rigging=False)

    v.anchor("wake", -h, 0, 0)
    return v


def hulk(ctx):
    v = ctx.vox(0, 0)
    L = HULL_LENGTH["hulk"]
    h = hull(v, L, 10, TERRACOTTA, ports=(-14, -6, 2, 10), sides=1)
    castle(v, -h, -h + 10, L, 10, 11, TERRACOTTA, windows=True)
    castle(v, h - 10, h - 2, L, 10, 10, TERRACOTTA)
    lantern(v, -h, -half_beam(-h, L, 10) + 1, 14)
    lantern(v, -h, half_beam(-h, L, 10) - 2, 14)
    mast(v, 6, 48, [(12, 24, 8), (26, 36, 6), (38, 44, 4)], 10)
    mast(v, -12, 40, [(15, 25, 6), (27, 35, 4)], 10)
    jib(v, 8, 26, 12, 40)
    v.anchor("wake", -h, 0, 0)
    return v


def carrack(ctx):
    v = ctx.vox(0, 0)
    L = HULL_LENGTH["carrack"]
    h = hull(v, L, 12, DYE_BLUE, cabin=12, cabin_h=8, ports=(-18, -12, -6, 0, 6, 12), sides=1)
    # The high forecastle: two storeys over the bow.
    castle(v, h - 12, h - 1, L, 12, 13, DYE_BLUE, windows=True)
    mast(v, 18, 54, [(16, 28, 8), (30, 40, 6), (42, 50, 4)], 10)
    mast(v, -2, 62, [(14, 26, 10), (28, 42, 8), (44, 55, 6)], 12)
    mast(v, -18, 46, [], 12, yards=False, top_z=38, rigging=False)
    lateen(v, -18, 9, 12, 16, 44, 18)
    jib(v, 20, 36, 15, 48)
    v.anchor("wake", -h, 0, 0)
    return v


# ---------------------------------------------------------------- lite

#: Full-model voxels per lite voxel (config.SHIP_LITE_DOWNSAMPLE): the lite models are built at SCALE / LITE voxels per tile.
LITE = 4


def lite_hull(v, length, beam, trim, castle=0, forecastle=0):
    """
    The lite hull, in lite voxels covering the full hull (stern to stem): a
    tarred keel row, the planked side, the trim band as the bulwark round an
    open deck, a stern castle `castle` voxels long (one storey higher), a
    forecastle and the bowsprit. Returns (stern x, bow x) in lite voxels.
    """
    h = length // 2
    lo, hi = (-h) // LITE, -(-h // LITE)
    bw = max(2, (beam + LITE // 2) // LITE)

    def hw_at(x):
        c = min(h - 1, max(-h, x * LITE + LITE // 2))
        return min(bw, max(1, int(round(half_beam(c, length, beam) / LITE + 0.25))))

    for x in range(lo, hi):
        hw = hw_at(x)
        if hw > 1:
            v.box(x, -hw + 1, -1, x + 1, hw - 1, 0, BOTTOM)
        v.box(x, -hw, 0, x + 1, hw, 1, COURSE_A)
        for y in range(-hw, hw):
            edge = y in (-hw, hw - 1) or x in (lo, hi - 1)
            v.set(x, y, 1, trim if edge else None)
            if not edge:
                v.set(x, y, 0, PLANK)
    for x in range(lo, lo + castle):
        hw = hw_at(x)
        v.box(x, -hw, 1, x + 1, hw, 2, TIMBER)
        v.box(x, -hw, 2, x + 1, hw, 3, trim)
    for x in range(hi - forecastle - 1, hi - 1) if forecastle else ():
        hw = hw_at(x)
        v.box(x, -hw, 1, x + 1, hw, 2, TIMBER)
        v.box(x, -hw, 2, x + 1, hw, 3, trim)
    # The bowsprit, as long as the full model's (length / 5 voxels).
    n = max(2, round(length / 5 / LITE))
    for k in range(n):
        v.set(hi + k, 0, 1 + k // 2, TIMBER_DARK)
    return lo, hi


def lite_mast(v, x, top, sails):
    """A lite mast at x up to `top` with square sails (z0, z1, half-width) as slabs across the hull, and its pennant."""
    v.box(x, 0, 1, x + 1, 1, top, TIMBER_DARK)
    for z0, z1, w in sails:
        v.box(x, -w, z0, x + 1, w, z1, SAIL)
    v.set(x - 1, 0, top - 1, FLAG)


def cog_lite(ctx):
    v = ctx.vox(0, 0)
    lo, _ = lite_hull(v, HULL_LENGTH["cog"], 8, OCHRE, castle=2)
    lite_mast(v, 0, 10, [(3, 9, 2)])
    v.set(lo, 0, 3, BRASS)  # the stern lantern
    return v


def hulk_lite(ctx):
    v = ctx.vox(0, 0)
    lite_hull(v, HULL_LENGTH["hulk"], 10, TERRACOTTA, castle=2, forecastle=2)
    lite_mast(v, 1, 12, [(3, 6, 2), (6, 9, 1)])
    lite_mast(v, -3, 10, [(4, 6, 1), (6, 8, 1)])
    return v


def carrack_lite(ctx):
    v = ctx.vox(0, 0)
    lite_hull(v, HULL_LENGTH["carrack"], 12, DYE_BLUE, castle=3, forecastle=3)
    lite_mast(v, 4, 14, [(4, 7, 2), (7, 10, 1)])
    lite_mast(v, -1, 16, [(4, 7, 3), (7, 11, 2), (11, 14, 1)])
    v.box(-5, 0, 1, -4, 1, 12, TIMBER_DARK)  # the mizzen with its lateen
    for z in range(4, 11):
        v.box(-7 + (z - 4) // 3, 1, z, -4 + max(0, (10 - z) // 3), 2, z + 1, SAIL)
    v.set(-6, 0, 11, FLAG)
    return v


# ---------------------------------------------------------------- cargo

#: Deck spots (x, y) of the cargo props per ship, one per cargo slot (2 / 4 / 6), clear of masts and castles.
CARGO_SPOTS = {
    "cog": ((5, -4), (5, 1)),
    "hulk": ((-5, -6), (-5, 2), (1, -6), (1, 2)),
    "carrack": ((-15, -7), (-15, 2), (-10, -3), (2, -7), (2, 2), (7, -3)),
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
    spots = CARGO_SPOTS.get(ctx.cid, CARGO_SPOTS["hulk"])
    n = int(ctx.defn.get("slots", len(spots)))
    for i, (x, y) in enumerate(spots[:n]):
        PROPS[i % len(PROPS)](v, x, y)
    return v


RECIPES = {
    "cog": {"build": cog, "lite": cog_lite, "scale": SCALE, "cargo": cargo, "ship": {"length_tiles": 2.0, "masts": 1, "sail_scale": 1.0}},
    "hulk": {"build": hulk, "lite": hulk_lite, "scale": SCALE, "cargo": cargo, "ship": {"length_tiles": 2.6, "masts": 2, "sail_scale": 1.0}},
    "carrack": {"build": carrack, "lite": carrack_lite, "scale": SCALE, "cargo": cargo, "ship": {"length_tiles": 3.2, "masts": 3, "sail_scale": 1.0}},
}

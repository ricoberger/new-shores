"""
Warships (D-077 §6, Patricians; bow toward +x, waterline z = 0; 20 voxels
per tile like the cargo ships): the Hanseatic navy next to the cog, hulk
and carrack of `_ships.py`, built from its hull builder, castles, masts,
lateen and lite hull. They are planned entries (`planned/d077.json`,
`length_tiles` 2 / 2.6 / 3.2, no cargo slots), held until the content
lists them.

- Balinger (2 tiles): a long, narrow clinker hull, one mast with a
  striped square sail, a row of oars on each side and shields along the
  rail, a raised stem post with a carved head.
- War cog (2.6): the cog's high clinker sides with crenellated castles
  fore and aft, a fighting top on the single mast, shields on the
  castles, pennants.
- War carrack (3.2): the carrack's three masts and high castles with two
  rows of gun ports (dark voxels) in the hull and the bulwark, shields
  along the castles' rails and banners.

The sails (and the lateen) are sway group "sail", pennants and banners
"flag", as on the cargo ships; each has a lite model (config.LITE_BUDGET_SHIPS).
"""

import importlib.util
import os

from nsvoxel.grid import mat, shade_of
from nsvoxel.mats import BRASS, CANVAS, DYE_BLUE, IRON, PLANK, TERRACOTTA, TIMBER, TIMBER_DARK, TIMBER_LIGHT


def _load_ships():
    spec = importlib.util.spec_from_file_location("voxrecipe__ships_for_war", os.path.join(os.path.dirname(os.path.abspath(__file__)), "_ships.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


S = _load_ships()
SCALE = S.SCALE
HULL_LENGTH = {"balinger": 40, "war_cog": 52, "war_carrack": 64}
RED_SAIL = mat("terracotta", 1.12, "sail")
RED_SAIL_DARK = mat("terracotta", 0.95, "sail")
WHITE_SAIL = mat("canvas", 1.0, "sail")
BANNER = mat("terracotta", 1.1, "flag")
BLACK = mat("tile-dark", 0.62)
SHIELDS = (mat("terracotta", 1.1), mat("canvas", 1.1), mat("dye-blue", 1.05), mat("ochre", 1.1))


def shields(v, length, beam, x0, x1, step=3, z=4):
    """Round shields hung on the outside of the rail (2 long, 2 high), colours in turn, on both sides."""
    for i, x in enumerate(range(x0, x1, step)):
        hw = S.half_beam(x, length, beam)
        m = SHIELDS[i % len(SHIELDS)]
        for y in (-hw - 1, hw):
            v.box(x, y, z, x + 2, y + 1, z + 2, m)
            v.set(x, y, z, shade_of(m, 0.8))


def oars(v, length, beam, x0, x1, step=4):
    """Oars from the rail down and out into the water, a blade at the end."""
    for x in range(x0, x1, step):
        hw = S.half_beam(x, length, beam)
        for side in (-1, 1):
            y0 = hw if side > 0 else -hw - 1
            v.line((x, y0 + side, 4), (x, y0 + side * 6, 0), TIMBER_LIGHT)
            ye = y0 + side * 6
            v.box(x - 1, min(ye, ye + side * 2), -1, x + 1, max(ye, ye + side * 2) + 1, 1, TIMBER_DARK)


def striped_sail(v, x, z0, z1, w):
    """A square sail with red and white vertical stripes (every three voxels), a belly toward +x."""
    for z in range(z0, z1):
        belly = 1 if z0 + 1 < z < z1 - 2 else 0
        for y in range(-w, w + 1):
            v.set(x + 1 + belly, y, z, RED_SAIL if (y + w) // 3 % 2 else WHITE_SAIL)
    v.box(x + 1, -w - 1, z1, x + 2, w + 2, z1 + 1, TIMBER)


def balinger(ctx):
    v = ctx.vox(0, 0)
    L, beam = HULL_LENGTH["balinger"], 6
    h = S.hull(v, L, beam, TERRACOTTA, sides=0, bowsprit=20)
    # The raised stem post with a carved head, a short sternpost.
    v.box(h - 1, -1, 4, h, 1, 11, TIMBER_DARK)
    v.box(h - 2, -1, 11, h + 1, 1, 13, TIMBER_DARK)
    v.box(h, -1, 12, h + 2, 1, 13, TIMBER)
    v.box(-h, -1, 4, -h + 1, 1, 9, TIMBER_DARK)
    shields(v, L, beam, -h + 6, h - 8)
    oars(v, L, beam, -h + 8, h - 8)
    # The mast with a striped sail on its yard.
    v.box(2, 0, 4, 3, 1, 32, TIMBER)
    v.box(1, -1, 31, 4, 2, 32, TIMBER_DARK)
    striped_sail(v, 2, 11, 28, 7)
    v.box(2, 0, 32, 3, 1, 33, BRASS)
    for k in range(4):
        v.set(1 - k, 0, 31, BANNER)
        v.set(1 - k, 0, 30, BANNER if k < 3 else None)
    # The helmsman's platform aft.
    v.box(-h + 1, -2, 4, -h + 5, 2, 5, PLANK)
    v.anchor("wake", -h, 0, 0)
    return v


def war_cog(ctx):
    v = ctx.vox(0, 0)
    L, beam = HULL_LENGTH["war_cog"], 9
    h = S.hull(v, L, beam, BLACK, sides=3, bowsprit=10)
    S.CRENELS = True
    S.castle(v, -h, -h + 10, L, beam, 11, BLACK)
    S.castle(v, h - 12, h - 2, L, beam, 10, BLACK)
    S.CRENELS = False
    shields(v, L, beam, -h + 2, -h + 9, step=3, z=5)
    shields(v, L, beam, h - 11, h - 3, step=3, z=5)
    S.lantern(v, -h, 0, 14)
    # One mast with a fighting top: a plank ring with a rail, and a square sail below it.
    S.mast(v, 2, 42, [(13, 34, 9)], beam, top_z=34, rigging=False)
    v.box(0, -3, 38, 5, 4, 39, PLANK)
    for x in range(0, 5):
        for y in (-3, 3):
            v.set(x, y, 39, TIMBER_LIGHT)
    for y in range(-3, 4):
        v.set(0, y, 39, TIMBER_LIGHT)
        v.set(4, y, 39, TIMBER_LIGHT)
    for x, y in ((h - 8, 0), (-h + 4, 0)):  # pennants on the castles
        v.box(x, y, 12, x + 1, y + 1, 18, TIMBER_DARK)
        for k in range(4):
            v.set(x - 1 - k, y, 17, BANNER)
    v.anchor("wake", -h, 0, 0)
    return v


def war_carrack(ctx):
    v = ctx.vox(0, 0)
    L, beam = HULL_LENGTH["war_carrack"], 12
    ports = tuple(range(-22, 20, 6))
    h = S.hull(v, L, beam, DYE_BLUE, cabin=12, cabin_h=8, ports=ports, sides=1)
    # The second row of gun ports: dark voxels in the bulwark between the first row's.
    for x in range(-19, 17, 6):
        hw = S.half_beam(x, L, beam)
        for y in (-hw, hw - 1):
            v.set(x, y, 4, BLACK)
            v.set(x + 1, y, 4, BLACK)
    S.castle(v, h - 14, h - 1, L, beam, 13, DYE_BLUE, windows=True)
    shields(v, L, beam, h - 13, h - 3, step=3, z=7)
    S.mast(v, 18, 54, [(16, 28, 8), (30, 40, 6), (42, 50, 4)], 10)
    S.mast(v, -2, 62, [(14, 26, 10), (28, 42, 8), (44, 55, 6)], 12)
    S.mast(v, -18, 46, [], 12, yards=False, top_z=38, rigging=False)
    S.lateen(v, -18, 9, 12, 16, 44, 18)
    S.jib(v, 20, 36, 15, 48)
    for x, z in ((h - 6, 14), (-h + 4, 18)):  # banners on the castles
        v.box(x, 0, z, x + 1, 1, z + 8, TIMBER_DARK)
        for k in range(5):
            for dz in range(3):
                v.set(x - 1 - k, 0, z + 7 - dz, BANNER)
    v.anchor("wake", -h, 0, 0)
    return v


# ---------------------------------------------------------------- lite


def balinger_lite(ctx):
    v = ctx.vox(0, 0)
    S.lite_hull(v, HULL_LENGTH["balinger"], 6, TERRACOTTA)
    S.lite_mast(v, 0, 8, [(3, 7, 2)])
    return v


def war_cog_lite(ctx):
    v = ctx.vox(0, 0)
    S.lite_hull(v, HULL_LENGTH["war_cog"], 9, BLACK, castle=2, forecastle=2)
    S.lite_mast(v, 0, 11, [(3, 8, 2)])
    return v


def war_carrack_lite(ctx):
    v = ctx.vox(0, 0)
    S.lite_hull(v, HULL_LENGTH["war_carrack"], 12, DYE_BLUE, castle=3, forecastle=3)
    S.lite_mast(v, 4, 14, [(4, 7, 2), (7, 10, 1)])
    S.lite_mast(v, -1, 16, [(4, 7, 3), (7, 11, 2), (11, 14, 1)])
    v.box(-5, 0, 1, -4, 1, 12, TIMBER_DARK)
    for z in range(4, 11):
        v.box(-7 + (z - 4) // 3, 1, z, -4 + max(0, (10 - z) // 3), 2, z + 1, S.SAIL)
    return v


RECIPES = {
    "balinger": {"build": balinger, "lite": balinger_lite, "scale": SCALE, "cargo": None, "ship": {"length_tiles": 2.0, "masts": 1, "sail_scale": 1.0}},
    "war_cog": {"build": war_cog, "lite": war_cog_lite, "scale": SCALE, "cargo": None, "ship": {"length_tiles": 2.6, "masts": 1, "sail_scale": 1.0}},
    "war_carrack": {"build": war_carrack, "lite": war_carrack_lite, "scale": SCALE, "cargo": None, "ship": {"length_tiles": 3.2, "masts": 3, "sail_scale": 1.0}},
}

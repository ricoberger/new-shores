"""
Glass smelter (4 × 6; V7 rework, tier IV): a battered ashlar furnace tower with a
glowing mouth and a slim stack (smoke) beside a cream-plaster casting hall
under slate, a heap of sand, a cart. Its own outbuildings on the camera side
(V7 leftovers): a round brick kiln, a beehive of brick with a glowing mouth, and
a rack of bottles and panes in the window role. 12 voxels per tile.
"""

from nsvoxel import parts as P
from nsvoxel import parts_kit as K
from nsvoxel import detail_v5 as Q
from nsvoxel.grid import mat, shade_of
from nsvoxel.mats import IRON, STONE_LIGHT, TIMBER, TIMBER_DARK, TIMBER_LIGHT

VOXELS_PER_TILE = 12
GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

GOODS = mat("shallows", 1.4)
GLOW = mat("ochre", 1.8)
GLASS = mat("window", 2.6)  # bottles and panes: the window role, lightened so they read against the paving
PANE = mat("window", 2.2)
BRICK = mat("brick")


def round_kiln(v, cx, cy, r, drum=9):
    """A beehive kiln of brick: a round drum in alternating courses, a stepped dome, a glowing arched mouth on y+ and a stone rim."""
    for x in range(cx - r - 1, cx + r + 2):
        for y in range(cy - r - 1, cy + r + 2):
            d = ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2) ** 0.5
            if d <= r + 0.2:
                for z in range(1, drum):
                    v.set(x, y, z, shade_of(BRICK, 1.0 if z % 2 else 0.88))
    Q.dome(v, cx, cy, drum, r, m=shade_of(BRICK, 0.96), bands=shade_of(BRICK, 0.82))
    v.box(cx - 3, cy + r - 3, 1, cx + 3, cy + r + 1, 7, None)
    v.box(cx - 3, cy + r - 3, 1, cx + 3, cy + r + 1, 2, None)
    v.box(cx - 2, cy + r - 2, 1, cx + 2, cy + r, 5, shade_of(IRON, 0.5))
    v.box(cx - 1, cy + r - 2, 1, cx + 1, cy + r, 4, GLOW)
    for x in (cx - 3, cx + 2):
        v.box(x, cy + r - 1, 1, x + 1, cy + r + 1, 7, STONE_LIGHT)
    v.box(cx - 3, cy + r - 1, 7, cx + 3, cy + r + 1, 8, STONE_LIGHT)
    v.box(cx - 1, cy - 1, drum + r - 1, cx + 1, cy + 1, drum + r + 3, shade_of(BRICK, 0.9))  # vent


def bottle(v, x, y, z, m=GLASS):
    """A flask: a 2 × 2 body three high with a one-voxel neck and a lip."""
    v.box(x, y, z, x + 2, y + 2, z + 3, m)
    v.set(x, y, z + 3, m)
    v.set(x, y, z + 4, shade_of(m, 1.25))


def glass_rack(v, x0, x1, y):
    """A rack on posts: a shelf of flasks on the left and a row of tall panes standing between two rails."""
    for x in (x0, (x0 + x1) // 2, x1 - 1):
        v.box(x, y, 1, x + 1, y + 2, 11, TIMBER)
    v.box(x0, y, 4, x1, y + 2, 5, TIMBER_LIGHT)
    v.box(x0, y, 10, x1, y + 2, 11, TIMBER_DARK)
    for x in range(x0 + 2, x1 - 3, 4):
        bottle(v, x, y, 5)
    for x in range(x0 + 2, x1 - 4, 7):
        v.box(x, y, 5, x + 3, y + 1, 10, PANE)


def build(ctx):
    v = ctx.vox()  # 48 × 72
    seed = 147
    K.ground(v, 24, 50, 20, 18, seed, "paved")
    K.furnace(v, 14, 18, glow=GLOW)
    K.workshop(v, 26, 8, 44, 34, 4, "a", seed, door=("x-", 22), wins=[])
    round_kiln(v, 14, 54, 8)
    glass_rack(v, 28, 46, 52)
    P.handcart(v, 30, 62, 1, along="x", load=GOODS)
    v.anchor("cart", 34, 68, 1)
    K.tufts(v, seed, 0.02)
    return P.colour_jitter(v, seed=seed)

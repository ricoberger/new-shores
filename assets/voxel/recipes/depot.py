"""
Depot (11 × 4, first row over water or sand; D-062, D-060, Citizens; one
level only): island storage along the coast. A long timber-framed hall
with a planked roof, three gates on the water side that open onto plank
loading ramps running down to the water row, a short stone quay edge with
mooring posts and rings, a door and loading bays on the road side, and
stacked crates, casks and sacks in the yard. No smoke anchor.

The content allows 0–1 water rows (D-062): the model's front row (8
voxels) holds only ramps, a quay edge and mooring posts, which stand on
sand as well as over water; the hall stands on the three rows behind.
"""

from nsvoxel import parts as P
from nsvoxel import detail_d060 as D
from nsvoxel.grid import mat
from nsvoxel.mats import CANVAS, IRON, PLASTER, STONE, STONE_DARK, TIMBER, TIMBER_DARK, TIMBER_LIGHT

PLANKED = mat("timber", 1.0)
PLANKED_RIDGE = mat("timber", 0.78)
#: The front row (voxels): ramps, quay edge and posts only.
WATER = 8


def quay(v, x0, x1, land, posts):
    """The stone quay edge (two rows deep, top at the yard's level) with mooring rings and posts at `posts`."""
    for x in range(x0, x1):
        v.box(x, land, -2, x + 1, land + 2, 1, STONE_DARK if x % 4 else STONE)
    for x in posts:
        D.mooring_ring(v, x - 3, land - 1, -2)
        v.box(x, land, 1, x + 2, land + 2, 4, TIMBER_DARK)  # the mooring post
        v.box(x, land, 4, x + 2, land + 2, 5, IRON)
        v.box(x + 2, land + 2, 1, x + 4, land + 3, 3, mat("canvas", 0.85))  # a rope coil at its foot


def crate_stack(v, x, y, s=3, rows=2):
    """Crates piled in a little pyramid on the ground at (x, y)."""
    for r in range(rows):
        for i in range(rows - r):
            P.box_crate(v, x + i * s + r, y + r, 1 + r * s, s=s)


def build(ctx):
    v = ctx.vox()  # 88 × 32
    seed = 87
    W, D_, land = ctx.W, ctx.D, WATER
    P.yard(v, 0, land, W, D_, "dirt", seed=seed)
    P.path(v, [(x, y) for x in range(41, 47) for y in range(24, D_)], kind="paved")
    quay(v, 4, W - 4, land, (16, 70))
    x0, y0, x1, y1 = 4, 12, W - 4, 24
    zt = 11
    gates = (11, 41, 71)  # three gates (6 wide) line up with three ramps
    P.plinth(v, x0, y0, x1, y1, 1, STONE_DARK, out=1)
    P.fill(v, x0, y0, x1, y1, 1, 2, STONE_DARK)
    P.half_timber(v, x0, y0, x1, y1, 2, zt, PLASTER, TIMBER, spacing=6, braces=("x-", "x+"))
    P.roof(v, x0, x1, y0, y1, zt, "tiles", along="x", gable=PLASTER, m=PLANKED, ridge=PLANKED_RIDGE, seed=seed)
    front, back = P.Face(v, "y+", y1 - 1), P.Face(v, "y-", y0)
    for gx in gates:
        P.barn_gate(back, gx, 2, 6, 7)
        if gx == 41:
            P.barn_gate(front, gx, 2, 6, 7)
        else:
            P.entrance(front, gx + 1, 2, 4, 5)
    for a in (7, 26, 56, 76):
        P.casement(front, a, 5, 2, 2, frame=None, sill=TIMBER_LIGHT, shutters=TIMBER_LIGHT, bars=False)
    for a in (27, 56):
        P.casement(back, a, 5, 2, 2, frame=None, sill=TIMBER_LIGHT, shutters=TIMBER_LIGHT, bars=False)
    # The loading ramps from the water-side gates down to the front row.
    for gx in gates:
        D.loading_ramp(v, gx, gx + 6, 2, land + 2, 1, -3, down="y-")
        for y in range(land + 2, y0):  # the plank apron from the ramp's head to the gate
            for x in range(gx, gx + 6):
                v.set(x, y, 1, P.shade_of(mat("timber", 1.62), 1.0 if y % 2 else 0.9))
    # Hoist beams out of the roof on the yard side, over the middle gate.
    v.box(43, y1, zt, 44, y1 + 4, zt + 1, TIMBER_DARK)
    for k in range(3):
        v.set(43, y1 + k, zt - 1 - k, TIMBER)
    for z in range(zt - 6, zt):
        v.set(43, y1 + 3, z, IRON)
    # Goods: stacks along the quay and in the yard, casks and sacks, hand carts.
    P.box_crate(v, 24, land, 1)
    P.sacks(v, 52, land, 1, n=2)
    P.cask(v, 30, land, 1)
    for k, x in enumerate((6, 20, 62, 78)):
        crate_stack(v, x, 26 if k % 2 == 0 else 27, rows=2)
    for x in (8, 33, 54, 84):
        P.cask(v, x, 27, 1)
        P.cask(v, x + 2, 27, 1)
    P.sacks(v, 14, 28, 1, n=3)
    P.sacks(v, 66, 28, 1, n=2)
    P.handcart(v, 30, 28, 1, along="x", load=CANVAS)
    for x in (10, 36, 52, 80):
        P.lamp_post(v, x, 25)
    v.anchor("cart", 47.2, 28, 1)
    v.anchor("door", 44, 32, 0)
    P.scatter(v, 0, land, W, D_, 0.012, seed=seed, kinds=("pebble", "tuft"))
    return P.colour_jitter(v, seed=seed)

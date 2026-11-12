"""
Shipyard (8 × 12 shore, D-057 §3, D-077 §5): the yard stands on the stone
quay plinth of the harbour buildings (D-078 §3, parts_d078.plinth: slabs
under every tile, a dressed side face into the water, mooring posts on
the sea edge); a plank slipway on piles with keel blocks and a hull on the
stocks — keel, stem and sternpost, ribs, the lower strakes planked, a
staging of poles and boards along one side with ladders and shores — runs
down a channel cut through the plinth into the sea (`slip`, the channel's
walls dressed like the plinth's face); the fitting-out berth beside it
with bollards, a big open thatched shed on posts with braces, a timber
crane with its tackle, a coursed-stone workshop with tiles and a chimney,
log and plank stacks, steam box, pitch kettle and rope coils. 12 voxels
per tile (D-078 step 6).
"""

from nsvoxel import parts as P
from nsvoxel import parts_d078 as Q
from nsvoxel import parts_v7 as W
from nsvoxel.grid import mat
from nsvoxel.mats import IRON, PLANK, STONE, STONE_LIGHT, TIMBER, TIMBER_DARK, TIMBER_LIGHT

VOXELS_PER_TILE = 12

#: The slip channel through the plinth (x SLIP_X0..SLIP_X1 over the four front rows).
SLIP_X0, SLIP_X1 = 15, 48
#: The hull's centre line (x) on the stocks.
HULL_X = 31
CANVAS_DARK = mat("canvas", 0.85)
ROPE = mat("canvas", 0.78)
STRAKE = mat("timber", 1.2)
TILE = mat("terracotta", 0.92)
TILE_RIDGE = mat("terracotta", 0.7)


def slip(v, land):
    """The channel through the plinth, the slipway's planks on piles down into the water and the keel blocks."""
    depth, step = Q.depth_of(12), Q.course(12)
    for (x, y, z) in [k for k in v.cells if SLIP_X0 <= k[0] < SLIP_X1 and k[1] < land]:
        v.set(x, y, z, None)
    for y in range(0, land):
        for x in (SLIP_X0 - 1, SLIP_X1):
            for k in range(1, depth + 1):
                v.set(x, y, -k, Q.WET if k > depth * 2 // 3 else (Q.COURSE if ((k - 1) // step) % 2 == 0 else Q.COURSE_DARK))
            v.set(x, y, 0, Q.CAPPING)
    # Slipway: a ramp of planks from the yard down into the water, keel blocks along its middle.
    for y in range(0, land + 27):
        z = min(0, (y - land) // 4)
        for x in range(SLIP_X0, SLIP_X1):
            edge = x in (SLIP_X0, SLIP_X1 - 1)
            v.set(x, y, z, TIMBER_DARK if edge else P.shade_of(PLANK, 1.0 if (y // 3) % 2 else 0.9))
        if y % 6 == 0:
            v.box(HULL_X - 1, y, z + 1, HULL_X + 2, y + 2, z + 2, TIMBER_DARK)
    for y in range(0, land, 9):
        for x in (SLIP_X0, SLIP_X1 - 1):
            v.box(x, y, -12, x + 1, y + 1, 1, TIMBER_DARK)
    v.anchor("slip", 31.2, 26.4, 0.75)


def hull(v, land):
    """A hull on the stocks at the head of the slip: keel, stem and sternpost, ribs, the lower strakes planked, staging along its east side."""
    c = land + 6  # the midship frame
    y0, y1 = land - 10, land + 22
    v.box(HULL_X, y0, 2, HULL_X + 1, y1, 4, TIMBER_DARK)  # keel
    for y in range(y0, y1):  # the keel blocks under it
        if y % 5 == 0:
            v.box(HULL_X - 1, y, 1, HULL_X + 2, y + 2, 2, TIMBER)

    def half_width(y):
        return 9 - int(abs(y - c) / 4)

    for y in range(y0 + 1, y1 - 1, 3):  # the ribs
        hw = half_width(y)
        for k in range(-hw, hw + 1):
            v.set(HULL_X + k, y, 4 + (k * k) // 9, TIMBER_LIGHT)
        for x in (HULL_X - hw, HULL_X + hw):
            v.box(x, y, 4 + (hw * hw) // 9, x + 1, y + 1, 14, TIMBER_LIGHT)
    # The lower strakes planked over the ribs on the stern half; the upper frames still open.
    for y in range(c - 3, y1 - 1):
        hw = half_width(y)
        for x in (HULL_X - hw, HULL_X + hw):
            for z in range(4 + (hw * hw) // 9, 10):
                v.set(x, y, z, STRAKE if (z // 2) % 2 else TIMBER)
    v.box(HULL_X - 9, c - 2, 14, HULL_X + 10, c - 1, 15, TIMBER)  # a deck beam across the midship frames
    v.box(HULL_X - 9, c + 4, 14, HULL_X + 10, c + 5, 15, TIMBER)
    # Stem (bow, toward the sea) and sternpost rising from the keel.
    for j in range(12):
        v.set(HULL_X, y0 - 1 - j // 3, 4 + j, TIMBER_DARK)
    v.box(HULL_X, y1 - 1, 4, HULL_X + 1, y1, 17, TIMBER_DARK)
    # Shores: raking props from the slip to the bilge.
    for y in range(y0 + 4, y1 - 2, 8):
        hw = half_width(y)
        for k in range(4):
            v.set(HULL_X - hw - 1 - k, y, 7 - k, TIMBER)
    # Staging along the east side: poles, two board levels, a ladder; a rope from the crane's jib.
    sx = HULL_X + 11
    for y in range(y0 + 2, y1, 7):
        v.box(sx + 2, y, 1, sx + 3, y + 1, 18, TIMBER)
    for z in (7, 13):
        v.box(sx, y0 + 2, z, sx + 3, y1 - 3, z + 1, PLANK)
    for z in range(1, 13):  # the ladder
        if z % 2 == 0:
            v.set(sx + 3, y0 + 9, z, TIMBER_LIGHT)
        v.set(sx + 3, y0 + 8, z, TIMBER)
        v.set(sx + 3, y0 + 10, z, TIMBER)


def shed(v, land, seed):
    """The open shed over the head of the slip: posts with knee braces, tie beams, wall plates, a thin thatch shell."""
    ya, yb = land + 30, land + 51
    for x in (12, 30, 49):
        for y in (ya, yb):
            v.box(x, y, 1, x + 3, y + 3, 21, TIMBER)
            v.box(x - 1, y - 1, 1, x + 4, y + 4, 2, STONE_LIGHT)  # a stone pad under each post
            for k in range(4):  # knee braces under the tie beam
                v.set(x + 3 + k, y + 1, 20 - k, TIMBER)
                if x > 12:
                    v.set(x - 1 - k, y + 1, 20 - k, TIMBER)
    for y in (ya, yb):
        v.box(12, y, 21, 52, y + 3, 22, TIMBER_DARK)
    # Wall plates carry the eaves of the thin roof shell on the tie beams.
    v.box(12, land + 27, 21, 52, land + 30, 22, TIMBER_DARK)
    v.box(12, land + 54, 21, 52, land + 57, 22, TIMBER_DARK)
    r = P.roof(v, 12, 52, land + 28, land + 56, 22, "thatch", along="x", ov=1, seed=seed, solid=False, gable=None)
    W.thatch_finish(v, r, seed)


def workshop(v, land, seed):
    """The coursed-stone workshop with a tiled roof, a barn gate and a chimney."""
    x0, y0, x1, y1 = 60, land + 30, 90, land + 54
    P.plinth(v, x0, y0, x1, y1, 1, STONE_LIGHT, out=0)
    P.fill(v, x0, y0, x1, y1, 1, 2, STONE_LIGHT)
    W.coursed_stone_2(v, x0, y0, x1, y1, 2, 15, STONE, seed)
    P.dressed_quoins(v, x0, y0, x1, y1, 2, 15)
    r = P.roof(v, x0, x1, y0, y1, 15, "tiles", along="y", rise=1.2, ov=1, gable=STONE, seed=seed, m=TILE, ridge=TILE_RIDGE, shades=(1.08, 0.9))
    W.roof_core(v, r, STONE, TILE)
    fy = P.Face(v, "y+", y1 - 1)
    W.gate(fy, 70, 9, 9, frame=P.DRESSED)
    W.round_window(fy, 75, 12, r=1, frame=P.DRESSED)
    fx = P.Face(v, "x-", x0)
    for a in (land + 35, land + 45):
        P.casement(fx, a, 6, 2, 4, frame=P.DRESSED, sill=P.DRESSED, lintel=P.DRESSED)
    P.casement(P.Face(v, "x+", x1 - 1), land + 40, 6, 2, 4, frame=P.DRESSED, sill=P.DRESSED, lintel=P.DRESSED)
    P.roof_chimney(v, r, 81, land + 45, above=4)
    return r


def build(ctx):
    v = ctx.vox()  # 96 × 144, land from y 48
    W_, D_, land = ctx.W, ctx.D, ctx.land
    seed = 81
    Q.plinth(v, 0, 0, W_, D_, vpt=12, edges=("y-",), seed=seed)
    slip(v, land)
    # The fitting-out berth beside the slip: bollards and a tarpaulin.
    for y in range(9, land, 12):
        v.box(66, y, 1, 68, y + 2, 4, TIMBER_DARK)
        v.box(66, y, 4, 68, y + 2, 5, IRON)
    v.box(72, 12, 1, 76, 15, 2, CANVAS_DARK)
    v.box(73, 13, 2, 75, 14, 3, CANVAS_DARK)
    hull(v, land)
    shed(v, land, seed)
    workshop(v, land, seed)
    # Crane by the slip: post on a braced foot, a jib over the hull, the tackle.
    cx, cy = 51, land + 6
    v.box(cx, cy, 1, cx + 3, cy + 3, 33, TIMBER)
    for k in range(5):  # braces from the foot
        v.set(cx - 1 - k, cy + 1, 5 - k, TIMBER_DARK)
        v.set(cx + 3 + k, cy + 1, 5 - k, TIMBER_DARK)
        v.set(cx + 1, cy - 1 - k, 5 - k, TIMBER_DARK)
        v.set(cx + 1, cy + 3 + k, 5 - k, TIMBER_DARK)
    for j in range(18):
        v.set(cx + 1 - j, cy + 1, 33, TIMBER_LIGHT)
        v.set(cx + 1 - j, cy + 2, 33, TIMBER_LIGHT)
    for k in range(6):  # the strut under the jib
        v.set(cx - 1 - k, cy + 1, 27 + k, TIMBER)
    for z in range(21, 33):
        v.set(cx - 15, cy + 1, z, IRON)
    v.box(cx - 16, cy + 1, 19, cx - 13, cy + 2, 21, TIMBER_DARK)  # the block
    # Timber stacks and planks.
    W.log_pile(v, 60, land + 6, 1, 21, along="x", n=3)
    W.log_pile(v, 60, land + 16, 1, 21, along="x", n=2)
    P.planks(v, 6, land + 60, 1, w=21, d=6, h=4)
    P.planks(v, 33, land + 63, 1, w=15, d=6, h=3)
    # Pitch kettle on a fire.
    v.box(81, land + 63, 1, 85, land + 67, 2, STONE)
    v.box(81, land + 63, 2, 85, land + 67, 5, IRON)
    v.box(82, land + 64, 5, 84, land + 66, 6, mat("iron", 0.6))
    P.cask(v, 87, land + 63, 1, h=4)
    P.cask(v, 87, land + 68, 1, h=4)
    # Steam box for bending planks, rope coils, a cart.
    v.box(54, land + 60, 1, 75, land + 65, 6, TIMBER_DARK)
    v.box(54, land + 60, 6, 75, land + 65, 7, PLANK)
    for x in range(56, 75, 4):
        v.box(x, land + 59, 1, x + 1, land + 66, 7, IRON)  # straps
    for x in (6, 12):
        v.box(x, land + 72, 1, x + 3, land + 75, 2, ROPE)
        v.set(x + 1, land + 73, 1, TIMBER_DARK)
    P.handcart(v, 36, land + 75, 1, along="x", load=PLANK)
    P.sawhorse(v, 21, land + 75, 1, along="x")
    P.tie_floating(v, ground=0)
    return P.colour_jitter(v, seed=seed)

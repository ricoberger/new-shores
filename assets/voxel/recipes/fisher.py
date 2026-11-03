"""
Fisher (3 × 8, back 3 rows over water; D-057 §3; V7 rework after the Anno 1404
fisherman's hut): a weathered boarded hut under grey-brown thatch on the
shore, a plank fishing deck on piles over the water in front of its back
door, dark net screens on poles along the deck, a stair down to the water,
a long mooring pier (the `boat` anchor at its side) and, on the land, net racks
with drying fish, an upturned boat on trestles, barrels, crates and
baskets; a stone chimney (the smoke anchor). 12 voxels per tile; dirt yard
over the land (D-068), sand at the shore.
"""

from nsvoxel import parts as P
from nsvoxel import parts_v7 as W
from nsvoxel.grid import hash3, mat, shade_of
from nsvoxel.mats import CANVAS, PLANK, STONE, STONE_LIGHT, TIMBER, TIMBER_DARK, TIMBER_LIGHT

VOXELS_PER_TILE = 12
GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

BOARDS = mat("timber", 0.8)  # the settlers' log and board walls
NET = mat("iron", 0.7)  # dark, wet netting
FLOAT = mat("timber", 1.3)  # the pale float line and knots that show the mesh
FISH = mat("iron", 2.8)  # silver
PLINTH = mat("stone", 1.1)
THATCH = mat("thatch", 0.8)  # the settlers' weathered thatch
GULL = mat("canvas", 1.4)
DECK = shade_of(PLANK, 1.12)
AWNING = mat("dye-blue", 0.95)
LAND = 36  # the first land row (ctx.land)


def deck(v, x0, y0, x1, y1, piles=6):
    """A plank deck at z = 0 (planks alternate in two shades by row) on piles every `piles` voxels."""
    for y in range(y0, y1):
        for x in range(x0, x1):
            v.set(x, y, 0, shade_of(DECK, 1.0 if (y // 2) % 2 else 0.9))
    for y in range(y0, y1, piles):
        for x in (x0, x1 - 1):
            v.box(x, y, -10, x + 1, y + 1, 0, TIMBER_DARK)
    for x in (x0, x1 - 1):
        v.box(x, y1 - 1, -10, x + 1, y1, 0, TIMBER_DARK)
    v.box(x0, y0, 0, x1, y0 + 1, 1, shade_of(TIMBER, 1.0))  # edge board on the sea side


def net_screen(v, x, y0, y1, h=10):
    """A net screen: two poles and a dark net between them along y at column x, hanging from a rail."""
    for y in (y0, y1 - 1):
        v.box(x, y, 1, x + 1, y + 1, h + 1, TIMBER)
    v.box(x, y0, h, x + 1, y1, h + 1, TIMBER_LIGHT)
    for y in range(y0 + 1, y1 - 1):
        for z in range(3, h):
            if z in (4, h - 2):
                v.set(x, y, z, FLOAT if y % 2 == 0 else NET)  # a float line / rope row
            elif (y + z) % 2 == 0 or z == h - 1:
                v.set(x, y, z, NET)
    v.box(x, y0 + 1, 2, x + 1, y1 - 1, 3, TIMBER_DARK)  # foot rope


def rack(v, x0, x1, y, seed, fish=True):
    """A drying rack: three posts, a top rail, hanging nets (a lattice) and strings of pale fish."""
    for x in (x0, (x0 + x1) // 2, x1 - 1):
        v.box(x, y, 1, x + 1, y + 1, 10, TIMBER)
    v.box(x0, y, 9, x1, y + 1, 10, TIMBER_LIGHT)
    for x in range(x0 + 1, x1 - 1):
        if x == (x0 + x1) // 2:
            continue
        for z in range(4, 9):
            if z == 8:
                v.set(x, y, z, FLOAT if x % 2 == 0 else NET)  # the head rope
            elif (x + z) % 2 == 0 and z <= 8 - (x % 3 == 0):  # a hanging lattice with a ragged hem
                v.set(x, y, z, NET)
        if fish and x % 3 == 0:  # a hung fish: silver body, a darker back line
            v.box(x, y + 1, 4, x + 1, y + 2, 8, FISH)
            v.set(x, y + 1, 7, shade_of(FISH, 0.8))


def upturned_boat(v, x, y, z=1, length=16, width=7):
    """A rowing boat upside down on two trestles: a rounded hull of planks, a keel, a pale gunwale."""
    for k in range(length):
        # Half-width of the hull along its length (pointed ends).
        t = (k + 0.5) / length
        hw = max(1, int(round((width / 2) * (1 - (2 * t - 1) ** 4))))
        for dx in range(-hw, hw + 1):
            h = 2 + (1 if abs(dx) < hw - 1 else 0) + (1 if abs(dx) < max(1, hw - 3) else 0)
            for dz in range(h):
                c = shade_of(TIMBER_LIGHT, 0.9 if (k // 2) % 2 else 1.0) if dz < h - 1 or abs(dx) == hw else shade_of(TIMBER_LIGHT, 1.1)
                v.set(x + width // 2 + dx, y + k, z + 2 + dz, c)
        v.set(x + width // 2, y + k, z + 2 + 4, TIMBER_DARK)  # the keel
    for k in (3, length - 4):
        for dx in (1, width - 2):
            v.box(x + dx, y + k, z, x + dx + 1, y + k + 1, z + 2, TIMBER_DARK)


def tub(v, x, y, z):
    """A 3 × 3 open salting tub: staves, a darker hoop, pale fish in the brine."""
    v.box(x, y, z, x + 3, y + 3, z + 3, TIMBER_LIGHT)
    v.box(x, y, z + 1, x + 3, y + 3, z + 2, TIMBER_DARK)
    v.box(x + 1, y + 1, z + 2, x + 2, y + 2, z + 3, FISH)


def tufts(v, x0, y0, x1, y1, seed):
    """Grass tufts on the cells the build leaves to the terrain."""
    for x in range(x0, x1):
        for y in range(y0, y1):
            if (x, y) in v.ground or v.has(x, y, 1) or hash3(x, y, 91, seed) >= 0.035:
                continue
            v.set(x, y, 1, mat("grass-b", 1.08))
            if hash3(x, y, 93, seed) < 0.5:
                v.set(x, y, 2, mat("grass-b", 1.16))


def build(ctx):
    v = ctx.vox()  # 36 × 96, land from y 36
    seed = 5
    # Ground (D-068): dirt only round the hut and under the platform; the rest is the terrain's grass and shore.
    P.yard(v, 1, 38, 34, 62, "dirt", seed=seed)  # round the hut
    P.yard(v, 2, 62, 23, 77, "dirt", seed=seed)  # under the work platform
    # The fishing deck in front of the hut's back door, with a net screen and a rope rail.
    dx0, dx1, dy0, dy1 = 17, 35, 20, 38
    deck(v, dx0, dy0, dx1, dy1)
    net_screen(v, dx1 - 1, dy0 + 1, dy1 - 3)
    for y in range(dy0 + 2, dy1 - 1, 5):
        v.box(dx0, y, 1, dx0 + 1, y + 1, 5, TIMBER)
    v.box(dx0, dy0 + 2, 4, dx0 + 1, dy1 - 1, 5, TIMBER_LIGHT)
    for x in range(dx0 + 2, dx1 - 2, 5):
        v.box(x, dy0, 1, x + 1, dy0 + 1, 5, TIMBER)
    v.box(dx0 + 2, dy0, 4, dx1 - 2, dy0 + 1, 5, TIMBER_LIGHT)
    P.box_crate(v, 30, 25, 1)
    P.barrel(v, 24, 31, 1)
    # The long pier from the shore out over all three water rows, beside the deck: rope rails, bollards,
    # a widened end with a hanging net frame, lobster pots (the boat lies at its west side).
    px0, px1 = 10, 16
    for y in range(2, 38):
        for x in range(px0, px1):
            v.set(x, y, 0, shade_of(DECK, 1.0 if (y // 2) % 2 else 0.9))
        if y % 6 == 2:
            for x in (px0, px1 - 1):
                v.box(x, y, -10, x + 1, y + 1, 0, TIMBER_DARK)
                v.set(x, y, 1, TIMBER_DARK)
    for y in range(2, 38, 6):  # rail posts and a rope rail on the west side
        v.box(px0, y, 1, px0 + 1, y + 1, 4, TIMBER)
    v.box(px0, 3, 3, px0 + 1, 37, 4, TIMBER_LIGHT)
    for y in range(3, 7):  # the pier end: wider planking
        for x in range(px0 - 2, px1 + 2):
            v.set(x, y, 0, shade_of(DECK, 1.0 if (y // 2) % 2 else 0.9))
    for x in (px0 - 2, px1 + 1):
        for y in (3, 6):
            v.box(x, y, -10, x + 1, y + 1, 0, TIMBER_DARK)
    for x in (px0 - 2, px1 + 1):  # bollards
        v.box(x, 4, 1, x + 1, 5, 4, TIMBER)
    v.box(px0 - 1, 5, 1, px1 + 1, 6, 2, TIMBER_DARK)  # a bench of boards
    net_screen(v, px1 + 1, 8, 20, h=8)  # a net frame beside the pier
    for x, y in ((12, 24), (13, 31)):  # lobster pots
        v.box(x, y, 1, x + 3, y + 3, 3, shade_of(TIMBER_LIGHT, 0.85))
        v.set(x + 1, y + 1, 2, None)
    for gx, gy in ((px0, 8), (px0, 20), (px1 + 1, 4)):  # gulls on the pier posts
        v.set(gx, gy, 4 if gx == px0 else 4, GULL)
    v.anchor("boat", 4.2, 18.0, 0.6)
    # The hut: a stone band, boarded walls, a plank floor on the deck's land edge, thatch with a ragged eave.
    x0, y0, x1, y1 = 10, 40, 30, 60
    P.plinth(v, x0, y0, x1, y1, 1, PLINTH, out=0)
    P.fill(v, x0, y0, x1, y1, 1, 2, PLINTH)
    P.boarded(v, x0, y0, x1, y1, 2, 13, m=BOARDS, batten=TIMBER_DARK, every=4)
    for cx in (x0, x1 - 3):  # pale stone footings under the corners, flush with the walls
        for cy in (y0, y1 - 3):
            v.box(cx, cy, 1, cx + 3, cy + 3, 4, STONE_LIGHT)
    r = P.roof(v, x0, x1, y0, y1, 13, "thatch", along="y", rise=0.95, ov=2, gable=shade_of(BOARDS, 1.1), seed=seed, m=THATCH)
    W.thatch_finish(v, r, seed)
    f = P.Face(v, "y+", y1 - 1)
    P.entrance(f, 22, 2, 4, 7, leaf=TIMBER_LIGHT, frame=TIMBER, step=PLINTH, steps=2)
    P.casement(f, 13, 6, 3, 3, frame=PLANK, sill=PLANK, shutters=TIMBER_LIGHT, bars=False)
    P.entrance(P.Face(v, "y-", y0), 22, 2, 4, 7, leaf=TIMBER_LIGHT, frame=TIMBER, step=None)  # the back door to the deck
    P.casement(P.Face(v, "y-", y0), 13, 6, 3, 3, frame=PLANK, sill=PLANK, bars=False)
    for a in (46, 53):
        P.casement(P.Face(v, "x-", x0), a, 6, 3, 3, frame=PLANK, sill=PLANK, bars=False)
    P.roof_chimney(v, r, 16, y0 + 4, above=3, anchor=True)
    # A lean-to store on the west side (visible from the camera): boarded, a pent thatch roof.
    sx0, sy0, sx1, sy1 = 2, 44, 10, 56
    P.boarded(v, sx0, sy0, sx1, sy1, 1, 9, m=shade_of(BOARDS, 0.92), batten=TIMBER_DARK, every=4)
    r2 = P.roof(v, sx0, sx1, sy0, sy1, 9, "thatch", along="y", rise=0.9, ov=2, gable=shade_of(BOARDS, 1.1), seed=seed + 1, m=THATCH)
    W.thatch_finish(v, r2, seed + 1)
    P.entrance(P.Face(v, "y+", sy1 - 1), 4, 2, 3, 5, leaf=TIMBER_LIGHT, frame=TIMBER, step=None)
    P.casement(P.Face(v, "x-", sx0), 48, 4, 3, 3, frame=PLANK, sill=PLANK, bars=False)
    # The yard: a plank work platform under a blue awning with salting tubs and fish crates (the
    # sardine hut's tubs), two net racks, an upturned boat on trestles, barrels, crates and baskets.
    for y in range(64, 75):
        for x in range(4, 21):
            v.set(x, y, 1, shade_of(DECK, 1.0 if (y // 2) % 2 else 0.9))
    v.box(4, 64, 1, 21, 65, 2, TIMBER)
    for x, y in ((5, 65), (19, 65), (5, 72), (19, 72)):
        v.box(x, y, 2, x + 1, y + 1, 9, TIMBER)
    for x in range(4, 21):
        for y in range(64, 74):
            v.set(x, y, 9, AWNING if (x // 2) % 2 else shade_of(AWNING, 0.85))
    v.box(5, 65, 10, 20, 73, 11, shade_of(AWNING, 1.1))
    tub(v, 7, 67, 2)
    tub(v, 11, 67, 2)
    tub(v, 15, 67, 2)
    P.box_crate(v, 7, 71, 2, contents=FISH)
    P.box_crate(v, 11, 71, 2, contents=FISH)
    P.cask(v, 16, 71, 2)
    rack(v, 27, 35, 68, seed)
    rack(v, 27, 35, 78, seed + 1, fish=False)
    upturned_boat(v, 4, 78, 1)
    P.barrel(v, 14, 84, 1)
    P.barrel(v, 17, 86, 1, m=shade_of(TIMBER_LIGHT, 0.9))
    P.box_crate(v, 14, 89, 1, contents=FISH)
    P.box_crate(v, 18, 90, 1)
    P.sacks(v, 28, 88, 1, n=2, m=CANVAS)
    v.box(30, 84, 1, 33, 87, 3, shade_of(TIMBER_LIGHT, 0.8))  # a basket
    v.set(31, 85, 2, None)
    v.anchor("cart", 20.4, 91.2, 1)
    v.anchor("door", 18, 96, 0)
    tufts(v, 0, 38, 36, 96, seed)
    return P.colour_jitter(v, seed=seed)

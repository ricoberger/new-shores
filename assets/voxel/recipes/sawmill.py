"""
Sawmill (4 × 6; D-057 §3; V7 rework after the Anno 1404 sawmill): a long boarded
workshop under weathered thatch, its gable to the west with a loft door and
hoist, a flush stone band and a stone chimney (smoke); in front of it an open
saw shed of fresh timber posts under a thatched roof with a log on the
carriage, a frame saw with a bright blade, stickered plank stacks and a
sawdust heap; bark-dark log piles with pale cut ends, a sawhorse, a woodpile
and a hand cart of planks in the yard. 12 voxels per tile; dirt round the
buildings only (D-068), the rest grass.
"""

from nsvoxel import parts as P
from nsvoxel import parts_v7 as W
from nsvoxel.grid import hash3, mat, shade_of
from nsvoxel.mats import BRASS, FLOWER, GRASS_A, GRASS_B, PLANK, TIMBER, TIMBER_DARK, TIMBER_LIGHT

VOXELS_PER_TILE = 12
GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

BOARDS = mat("timber", 0.66)  # dark boards, darker than the yard
THATCH = mat("thatch", 0.8)  # weathered
PLINTH = mat("stone", 1.1)
SAWDUST = mat("thatch", 1.3)  # pale yellow, the hay shade
FRESHP = shade_of(PLANK, 1.3)  # fresh-cut planks
SHED = mat("timber", 1.0)
BLADE = mat("iron", 2.1)  # bright steel
FRESH = mat("timber", 1.25)  # freshly sawn timber of the shed
PLANKS_ROOF = shade_of(PLANK, 0.95)  # the shed roof of planks


def tufts(v, x0, y0, x1, y1, seed):
    """Grass tufts and flowers on the cells left to the terrain."""
    for x in range(x0, x1):
        for y in range(y0, y1):
            if (x, y) in v.ground or v.has(x, y, 1) or hash3(x, y, 91, seed) >= 0.04:
                continue
            if hash3(y, x, 92, seed) < 0.25:
                v.set(x, y, 1, shade_of(GRASS_A, 1.05))
                v.set(x, y, 2, FLOWER)
            else:
                v.set(x, y, 1, shade_of(GRASS_B, 1.08))
                if hash3(x, y, 93, seed) < 0.45:
                    v.set(x, y, 2, shade_of(GRASS_B, 1.16))


def plank_stack(v, x, y, z, w, d, h, along="x"):
    """A stack of fresh-cut planks in layers with spacer sticks every fourth voxel: pale against the dark logs."""
    for k in range(h):
        c = FRESHP if k % 2 == 0 else shade_of(FRESHP, 0.9)
        v.box(x, y, z + k, x + w, y + d, z + k + 1, c)
        for i in range(0, w if along == "x" else d, 4):
            if along == "x":
                v.box(x + i, y, z + k, x + i + 1, y + d, z + k + 1, shade_of(TIMBER, 1.1)) if k % 2 else None
            else:
                v.box(x, y + i, z + k, x + w, y + i + 1, z + k + 1, shade_of(TIMBER, 1.1)) if k % 2 else None


def mound(v, cx, cy, r, h, m=SAWDUST):
    """A sawdust mound: a dome of radius r and height h, a lighter crown."""
    for x in range(cx - r, cx + r + 1):
        for y in range(cy - r, cy + r + 1):
            d = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5
            if d > r:
                continue
            top = max(1, int(round(h * (1 - d / (r + 0.5)))))
            for z in range(top):
                v.set(x, y, 1 + z, shade_of(m, 1.1 if z == top - 1 else 0.95))


def plank_roof(v, x0, x1, y0, y1, z, seed):
    """A one-voxel plank roof along x over x0..x1 × y0..y1: courses in two pale shades, a darker ridge board, gaps between boards."""
    mid = (y0 + y1 - 1) / 2
    half = (y1 - y0) / 2
    for y in range(y0, y1):
        d = abs(y - mid)
        zz = z + int((half - d) * 0.6)
        ridge = d < 1
        for x in range(x0, x1):
            if not ridge and hash3(x, y, 7, seed) < 0.1:
                continue  # a gap between boards
            c = shade_of(TIMBER, 1.05) if ridge else shade_of(PLANKS_ROOF, 1.0 if (y // 2) % 2 else 0.84)
            v.set(x, y, zz, c)


def blob(v, cx, cy, rx, ry, seed, kind="dirt"):
    """An irregular rounded patch of ground: an ellipse with a noisy rim (the yard map, D-068)."""
    for x in range(cx - rx - 2, cx + rx + 3):
        for y in range(cy - ry - 2, cy + ry + 3):
            d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2
            if d < 1.0 + (hash3(x // 4, y // 4, 5, seed) - 0.5) * 0.3:
                P.yard(v, x, y, x + 1, y + 1, kind, seed=seed)


def saw_blade(v, x, cy, cz, r):
    """A large circular saw blade standing against the west wall (a disc in the y–z plane at column x): bright steel, a dark hub, teeth."""
    for y in range(cy - r - 1, cy + r + 2):
        for z in range(cz - r - 1, cz + r + 2):
            d = ((y - cy) ** 2 + (z - cz) ** 2) ** 0.5
            if d <= r:
                v.set(x, y, z, BRASS if d < 1.6 else BLADE)  # a brass hub
            elif d <= r + 1.2 and (y + z) % 2 == 0:
                v.set(x, y, z, shade_of(BLADE, 0.7))  # teeth
    v.box(x - 2, cy - 1, 1, x, cy + 2, 3, TIMBER_DARK)  # a chock in front of it
    v.box(x - 1, cy - 1, 3, x, cy + 1, cz - r + 2, TIMBER)  # and a prop leaning from its foot


def build(ctx):
    v = ctx.vox()  # 48 × 72
    seed = 8
    blob(v, 23, 41, 22, 14, seed)  # dirt under the shed and round the bench only; the rest is grass
    # Workshop at the back: stone band, boarded walls, thatch (ridge along x), gable to the west.
    x0, y0, x1, y1 = 8, 6, 34, 26
    P.plinth(v, x0, y0, x1, y1, 1, PLINTH, out=0)
    P.fill(v, x0, y0, x1, y1, 1, 2, PLINTH)
    P.boarded(v, x0, y0, x1, y1, 2, 13, m=BOARDS, batten=TIMBER_DARK, every=4)
    r = P.roof(v, x0, x1, y0, y1, 13, "thatch", along="x", rise=1.0, ov=2, gable=shade_of(BOARDS, 1.1), seed=seed, m=THATCH)
    W.thatch_finish(v, r, seed)
    f = P.Face(v, "y+", y1 - 1)
    P.entrance(f, 16, 2, 4, 7, leaf=TIMBER_LIGHT, frame=TIMBER, step=PLINTH, steps=2)
    for a in (10, 24):
        P.casement(f, a, 6, 3, 3, frame=PLANK, sill=PLANK, shutters=TIMBER_LIGHT, bars=False)
    W.loft_door(v, x0, 11, 8, w=5, h=5, frame=TIMBER, side="x-", length=6, rope=6)  # the hoist on the west gable
    saw_blade(v, x0 - 2, 21, 7, 5)
    P.roof_chimney(v, r, 26, 12, above=3, anchor=True)
    # Back wall relief: posts with a tie rail, a woodpile under the eave.
    for x in range(x0 + 2, x1 - 1, 8):
        v.box(x, y0 - 1, 2, x + 1, y0, 13, TIMBER_DARK)
    v.box(x0 + 2, y0 - 1, 8, x1 - 2, y0, 9, TIMBER_DARK)
    P.woodpile(v, 12, 2, 1, length=14, along="x", rows=3)
    # The saw shed against the workshop: fresh timber posts under a plank roof (with gaps) over the plank
    # stacks, open at the front and at its west end. The gantry saw shares the shed's west posts and stands
    # under the roof's west edge, so the camera sees its blade through the open west side.
    gx, by = 15, 42
    sx0, sx1, sy0, sy1 = gx + 1, 37, 30, by + 10
    for x in (sx0 + 9, sx1 - 1):
        for y in (sy0, sy1 - 1):
            v.box(x, y, 1, x + 1, y + 1, 12, FRESH)
    plank_roof(v, gx, sx1 + 1, sy0 - 1, sy1 + 1, 12, seed + 1)
    plank_stack(v, 18, 31, 1, 12, 4, 4)
    plank_stack(v, 18, 36, 1, 10, 3, 3)
    plank_stack(v, 31, 31, 1, 4, 8, 3, along="y")
    # The bench: a carriage bed on trestles, a log on it, the frame saw in its gantry.
    v.box(8, by, 1, 34, by + 8, 3, TIMBER_DARK)
    for x in range(9, 34, 5):
        v.box(x, by, 3, x + 1, by + 8, 4, TIMBER)
    W.log(v, 10, by + 3, 4, 22, "x")
    for y in (by - 1, by + 8):  # the gantry: two stout posts (the shed's west posts), a crossbeam and a lower rail
        v.box(gx, y, 1, gx + 2, y + 2, 14, TIMBER_LIGHT)
    v.box(gx, by - 1, 13, gx + 2, by + 10, 14, TIMBER_LIGHT)
    v.box(gx, by - 1, 6, gx + 2, by + 10, 7, TIMBER_LIGHT)
    v.box(gx, by + 3, 7, gx + 1, by + 7, 13, BLADE)  # the blade: bright steel, 1 voxel wide, 6 tall
    v.box(gx + 1, by + 3, 7, gx + 2, by + 4, 13, shade_of(BLADE, 0.75))
    mound(v, 33, by + 11, 4, 4)  # sawdust at the bench's east end
    mound(v, 12, by + 12, 3, 3)  # and a second under the saw
    # Yard: bark-dark log piles with pale ends, plank stacks, sawhorse, woodpile, the cart.
    W.log_pile(v, 40, 44, 1, 16, "y", 3)
    W.log_pile(v, 38, 8, 1, 16, "y", 3)
    plank_stack(v, 38, 28, 1, 7, 4, 4)
    plank_stack(v, 38, 34, 1, 7, 4, 3)
    P.sawhorse(v, 24, 58, 1, along="x")
    W.log(v, 14, 64, 1, 8, "x")
    P.woodpile(v, 28, 66, 1, length=8, along="x", rows=2)
    P.handcart(v, 36, 64, 1, along="x", load=PLANK)
    v.anchor("cart", 38, 68, 1)
    tufts(v, 0, 0, 48, 72, seed)
    return P.colour_jitter(v, seed=seed)

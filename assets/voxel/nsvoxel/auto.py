"""
Auto voxel placeholders for every model without a recipe file: walls and a
roof sized to the footprint (water rows become a pier), a sign board with
the ID's first letters, the required anchors, so that the whole game can
run with ?voxel=1 while only the evaluation set is hand-authored.
"""

from . import parts as P
from .grid import hash3, shade_of
from .mats import (
    DIRT,
    PLANK,
    PLASTER,
    STONE,
    TERRACOTTA,
    THATCH,
    TIMBER,
    TIMBER_DARK,
    WHEAT,
    WHEAT_MARK,
    PASTURE,
    PASTURE_MARK,
    HEMP,
    HEMP_MARK,
    ORCHARD,
    APPLE,
    GRASS_A,
)

#: Roof material by tier (D-050 tier language: thatch, terracotta, then slate/stone).
ROOF = {"settlers": THATCH, "citizens": TERRACOTTA}


def short(cid):
    """Sign text: the first four letters of the ID's first word."""
    return cid.split("_")[0][:4].upper()


def building(ctx):
    v = ctx.vox()
    W, D, land = ctx.W, ctx.D, ctx.land
    seed = sum(map(ord, ctx.cid))
    # Water rows: a plank pier on piles; land: a yard.
    if ctx.water:
        for y in range(0, land):
            for x in range(W // 4, W - W // 4):
                v.set(x, y, 0, shade_of(PLANK, 1.0 if y % 2 else 0.88))
            for x in (W // 4, W - W // 4 - 1):
                if y % 6 == 0:
                    v.box(x, y, -8, x + 1, y + 1, 0, TIMBER_DARK)
    P.yard(v, 0, land, W, D, "dirt", seed=seed)
    lw, ld = W, D - land
    # Main block: most of the land, set back from the front by a tile for the yard.
    bx0 = 2 if lw >= 16 else 1
    bx1 = W - (2 if lw >= 16 else 1)
    by0 = land + (2 if ld >= 16 else 1)
    by1 = D - (6 if ld >= 24 else 3)
    if lw >= 40:
        bx1 = bx0 + int(lw * 0.62)
    wall_h = 9 if ctx.tier == "settlers" else 12
    roof = ROOF.get(ctx.tier, mat_slate())
    stone = "mine" in ctx.cid or "quarry" in ctx.cid or "smelter" in ctx.cid or "kiln" in ctx.cid
    if stone:
        P.stone_wall(v, bx0, by0, bx1, by1, 1, wall_h, STONE, seed)
    else:
        P.timber_frame(v, bx0, by0, bx1, by1, 1, wall_h, PLASTER, TIMBER, spacing=5)
    along = "x" if (bx1 - bx0) >= (by1 - by0) else "y"
    top = v.gable(bx0, bx1, by0, by1, wall_h, roof, PLASTER if not stone else STONE, along=along, rise=1 if ctx.tier != "settlers" else 2, seed=seed)
    f = P.Face(v, "y+", by1 - 1)
    mid = (bx0 + bx1) // 2
    P.door(f, mid - 1, 1, 3, 5)
    for a in range(bx0 + 2, bx1 - 3, 6):
        if abs(a - mid) > 4:
            P.window(f, a, 4, 2, 3)
    P.label(f, bx0 + 1, wall_h - 1 - 6 if wall_h >= 11 else 1, short(ctx.cid)[: max(1, (bx1 - bx0 - 4) // 4)])
    # Props in the yard.
    P.crate(v, bx1 - 3, D - 3, 1)
    P.barrel(v, bx0, D - 3, 1)
    if ctx.smoke:
        cx = bx0 + 2 if along == "x" else (bx0 + bx1) // 2 - 1
        cy = (by0 + by1) // 2 - 1
        smoke = P.chimney(v, cx, cy, 1, top + 1)
        v.anchor("chimney", smoke[0], smoke[1], smoke[2] - 1)
        v.anchor("smoke", *smoke)
    place_anchors(v, ctx)
    return v


def mat_slate():
    from .mats import SLATE

    return SLATE


def place_anchors(v, ctx):
    """Default positions of the life anchors a placeholder needs."""
    W, D, land = ctx.W, ctx.D, ctx.land
    v.anchor("door", W / 2, D, 0)
    for a in ctx.needs:
        if a in v.anchors:
            continue
        if a == "cart":
            v.anchor("cart", W - 4, D - 1.5, 1)
        elif a == "boat":
            v.anchor("boat", W / 2, max(2, land - 6), 0.4)
        elif a.startswith("berth_"):
            k = int(a.split("_")[1]) - 1
            v.anchor(a, W * (k + 1) / 5, -3, 0.4)
        elif a == "slip":
            v.anchor("slip", W / 2, land / 2, 0.5)
        elif a == "gate":
            v.anchor("gate", W / 2, D, 0)
        elif a.startswith("sheep_"):
            k = int(a.split("_")[1])
            v.anchor(a, W * k / 4, D * 0.6, 1)
        elif a in ("chimney", "smoke"):
            v.anchor(a, W / 2, D / 2, 12 if a == "chimney" else 13)
        else:
            v.anchor(a, W / 2, D / 2, 1)


FIELD = {
    "wheat_field": (WHEAT, WHEAT_MARK, 3),
    "pasture": (PASTURE, PASTURE_MARK, 1),
    "hemp_field": (HEMP, HEMP_MARK, 4),
    "orchard_plot": (ORCHARD, APPLE, 0),
}


def field(ctx):
    """A field tile: soil with crop rows of the field's colour (height in voxels per crop)."""
    v = ctx.vox()
    crop, mark, h = FIELD.get(ctx.cid, (GRASS_A, DIRT, 0))
    for x in range(ctx.W):
        for y in range(ctx.D):
            row = h > 0 and x % 4 != 3
            v.set(x, y, 0, shade_of(DIRT, 0.95) if h and not row else shade_of(crop, 0.85 if h else (1.0 if hash3(x // 4, y // 4, 0, 2) < 0.6 else 1.08)))
            if row:
                for z in range(1, h + 1):
                    v.set(x, y, z, mark if (z == h and (y // 3 + x // 4) % 3 == 0) else crop)
    place_anchors(v, ctx)
    return v


def pick(kind):
    return {"building": building, "field": field}.get(kind)



"""
Cattle farm (4 × 5 with cattle-pasture modules; D-057 §3, V5): a large
byre across the back — a coursed-stone lower storey with stalls behind
two wide gates, a boarded hay loft with its hatch and a tiled roof with
vents — and a fenced yard with a long trough, a hay rack, a manure heap
and a feed shed; a stockman's cottage, a bell post and a cart.
"""

from nsvoxel import detail_v5 as Q
from nsvoxel import parts as P
from nsvoxel.grid import mat
from nsvoxel.mats import STONE, STONE_DARK, THATCH, TIMBER, TIMBER_DARK, TIMBER_LIGHT

ROOF = mat("terracotta", 0.86)


def build(ctx):
    v = ctx.vox()  # 32 × 40
    seed = 83
    P.yard(v, 0, 0, 32, 40, "grass", seed=seed)
    P.yard(v, 1, 18, 21, 39, "dirt", seed=seed)
    # The byre: stone lower storey, boarded loft, tiled roof.
    x0, y0, x1, y1 = 2, 2, 30, 15
    P.plinth(v, x0, y0, x1, y1, 1, STONE_DARK, out=1)
    P.coursed_stone(v, x0, y0, x1, y1, 1, 8, STONE, seed)
    P.dressed_quoins(v, x0, y0, x1, y1, 1, 8)
    P.boarded(v, x0, y0, x1, y1, 8, 13)
    r = P.roof(v, x0, x1, y0, y1, 13, "tiles", along="x", m=ROOF, gable=TIMBER_LIGHT, seed=seed)
    f = P.Face(v, "y+", y1 - 1)
    P.barn_gate(f, 5, 1, 6, 6)
    P.barn_gate(f, 19, 1, 6, 6)
    P.entrance(f, 13, 9, 3, 3, step=None, hinges=False)  # loft hatch
    f.put(14, 9, THATCH, out=-1)
    v.box(13, y1, 13, 16, y1 + 1, 14, TIMBER_DARK)  # hoist beam
    for a in (3, 26):
        P.casement(f, a, 3, 1, 2, frame=P.DRESSED, sill=P.DRESSED, bars=False)
    for xv in (8, 22):
        v.box(xv, 8, r.ridge_z, xv + 2, 10, r.ridge_z + 3, TIMBER_LIGHT)
        v.box(xv - 1, 7, r.ridge_z + 3, xv + 3, 11, r.ridge_z + 4, ROOF)
    # Yard: fence with a gate, trough, hay rack, manure heap.
    P.fence_ring(v, 1, 17, 21, 39, kind="rail", gaps={(x, 38) for x in range(8, 13)}, seed=seed)
    P.trough(v, 3, 20, 1, length=10, along="x")
    v.box(15, 20, 1, 16, 26, 5, TIMBER)
    v.box(19, 20, 1, 20, 26, 5, TIMBER)
    v.box(16, 20, 2, 19, 26, 5, THATCH)
    v.box(15, 20, 5, 20, 26, 6, TIMBER)
    Q.heap(v, 6, 32, 3.5, 3.0, 2.5, mat("road-dirt", 0.62))
    P.bale(v, 12, 30, 1, 3, 2, 2)
    P.bale(v, 12, 33, 1, 3, 2, 2)
    # Stockman's cottage with a feed shed.
    c = P.building(v, 23, 22, 31, 32, "stone", along="y", height=9, roof=ROOF, seed=seed + 1)
    P.entrance(c.face("x-"), 26, 2, 2, 5)
    P.casement(c.face("y+"), 26, 4, 2, 2, frame=P.DRESSED, sill=P.DRESSED, shutters=TIMBER_LIGHT)
    P.roof_chimney(v, c.roof, 27, 24, above=2, brick=True)
    P.lean_to(v, 23, 31, 33, 37, 6, "tiles", down="y+", m=ROOF, seed=seed)
    P.sacks(v, 24, 34, 1, n=3)
    v.box(22, 38, 1, 23, 39, 8, TIMBER_DARK)
    v.set(22, 38, 8, mat("brass"))
    v.anchor("cart", 26, 39, 1)
    P.scatter(v, 0, 16, 32, 40, 0.02, seed=seed)
    _ = TIMBER
    return P.colour_jitter(v, seed=seed)

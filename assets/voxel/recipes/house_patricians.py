"""
Patrician house (3 × 3; D-057 §3, V5): a clear step above the Merchant
house — three storeys: a dressed ashlar ground floor on a proud plinth,
two plastered upper storeys with dressed quoins, string courses at the
floor lines and a cornice; tall glazed windows in dressed frames with
keystones or pediments, a panelled door under a hood, dormers, brick
chimneys with pots and a tiled roof. Three variants: an ochre townhouse
with a corner tower and a pyramid roof (warm red tiles), a pale beige
block with a top-floor loggia under a hipped roof (dark red-brown), and
a cream gable-fronted house with a ground-floor arcade and a belvedere
turret (light orange tiles).
"""

from nsvoxel import detail_v5 as Q
from nsvoxel import parts as P
from nsvoxel.grid import mat
from nsvoxel.mats import BRASS, DYE_BLUE, FLOWER, PLASTER

VARIANTS = 3

DOOR_RED = mat("terracotta", 0.72)
DOOR_GREEN = mat("grass-b", 0.7)
#: Roof colours per variant (warm palette: red tiles, the house set's dark red-brown, light orange).
ROOFS = (mat("terracotta", 1.0), mat("terracotta", 0.66), mat("terracotta", 1.14))
#: Upper-storey plaster per variant (flat colours).
WALLS = (mat("ochre", 1.0), mat("plaster", 0.93), PLASTER)


def front_door(f, a, leaf, steps=3):
    """A tall panelled door under a dressed hood with a fanlight."""
    P.entrance(f, a, 2, 3, 6, leaf=leaf, frame=Q.DRESSED, lintel=Q.DRESSED, steps=steps)
    f.put(a + 1, 7, P.mat("window"), out=-1)


def build(ctx):
    v = ctx.vox()  # 24 × 24
    k = ctx.variant
    seed = 41 + k
    roof_m, wall = ROOFS[k], WALLS[k]
    P.yard(v, 0, 0, 24, 24, "grass", seed=seed)
    P.yard(v, 1, 18, 23, 24, "paved", seed=seed)
    if k == 0:
        # Townhouse along the street with a corner tower; even three-bay rhythm.
        b = Q.palazzo(v, 3, 5, 21, 16, (7, 6, 6), upper=wall, roof=roof_m, along="x", seed=seed)
        f = b.face("y+")
        front_door(f, 8, DOOR_RED)
        Q.window(f, 4, 4, 2, 3, hood="cornice", surround=True)
        Q.window(f, 12, 4, 2, 3, hood="cornice", surround=True)
        for a in (5, 11):
            Q.window(f, a, 10, 2, 4, hood="pediment", box=FLOWER)
            Q.window(f, a, 16, 2, 3, hood="cornice")
        for z in (10, 16):
            Q.window(b.face("x-"), 9, z, 2, 3, hood="key")
        Q.window(b.face("y-"), 7, 10, 2, 4, hood="key")
        Q.window(b.face("y-"), 13, 10, 2, 4, hood="key")
        # Corner tower, one voxel proud of the front, a storey above the eaves.
        Q.ashlar(v, 15, 11, 21, 17, 2, 9)
        tr = Q.tower(v, 15, 11, 21, 17, 9, 28, wall=wall, plaster=True, roof=mat("terracotta", 0.84), rise=2.0, seed=seed)
        T = P.Face(v, "y+", 16)
        Q.window(T, 17, 4, 2, 3, hood="cornice", surround=True)
        Q.window(T, 17, 10, 2, 4, hood="key")
        Q.window(T, 17, 16, 2, 3, hood="key")
        Q.window(T, 17, 22, 2, 3, hood=None)
        Q.window(P.Face(v, "x+", 20), 13, 22, 2, 3, hood=None)
        Q.window(P.Face(v, "x+", 20), 13, 10, 2, 4, hood="key")
        P.dormer_on(v, b.roof, 9, 13, "y+", wall=wall)
        P.roof_chimney(v, b.roof, 4, 8, above=3, brick=True, pots=2)
        P.roof_chimney(v, b.roof, 12, 7, above=3, brick=True, pots=2)
        P.lamp_post(v, 3, 19, h=7)
        P.flower_bed(v, 11, 18, 14, 21, seed=seed)
        P.shrub(v, 2, 2, 1, 2, seed=seed)
        P.fruit_tree(v, 21, 2, 1, seed=seed, trunk=4, r=2.8)
    elif k == 1:
        # Hipped block with a top-floor loggia across the front; asymmetric rhythm, door at the side.
        b = Q.palazzo(v, 3, 6, 21, 17, (7, 6, 7), upper=wall, roof=roof_m, along="x", hip=True, seed=seed)
        f = b.face("y+")
        front_door(f, 15, DOOR_GREEN)
        Q.window(f, 5, 4, 3, 3, hood="cornice", surround=True)
        Q.window(f, 10, 4, 2, 3, hood="cornice", surround=True)
        for a in (6, 14):
            Q.window(f, a, 10, 2, 4, hood="key", shutters=DOOR_GREEN)
        # Loggia: three arches on the top storey, a balustrade between the piers.
        Q.arcade(f, 3, 21, 16, 5, bay=4, pier=2, depth=3)
        Q.balustrade(v, [(x, 16) for x in range(4, 20)], 16)
        for side in ("x-", "x+"):
            Q.window(b.face(side), 10, 10, 2, 4, hood="key")
            Q.window(b.face(side), 10, 17, 2, 3, hood=None)
        Q.window(b.face("y-"), 8, 10, 2, 4, hood="key")
        Q.window(b.face("y-"), 14, 17, 2, 3, hood=None)
        P.roof_chimney(v, b.roof, 6, 10, above=3, brick=True, pots=2)
        P.roof_chimney(v, b.roof, 16, 10, above=3, brick=True, pots=2)
        Q.finial(v, 11, 11, b.roof.top, BRASS)
        # Garden: a clipped hedge, a bench, an urn.
        Q.leafy_bank(v, 1, 1, 23, 3, seed=seed)
        P.bench(v, 5, 20, 1, 4)
        v.box(19, 19, 1, 21, 21, 3, Q.DRESSED)
        v.set(19, 19, 3, FLOWER)
        P.lamp_post(v, 13, 20, h=7)
    else:
        # Gable to the street, a ground-floor arcade, a belvedere turret on the ridge.
        b = Q.palazzo(v, 4, 3, 20, 17, (8, 6, 6), upper=wall, roof=roof_m, along="y", rise=1.25, seed=seed)
        f = b.face("y+")
        Q.arcade(f, 4, 20, 2, 6, bay=4, pier=2, depth=3, pier_m=Q.ASHLAR)
        door = P.Face(v, "y+", 13)
        P.entrance(door, 11, 2, 2, 5, leaf=DYE_BLUE, frame=Q.DRESSED, step=None)
        for a in (6, 16):
            Q.window(f, a, 11, 2, 4, hood="pediment", box=FLOWER)
        Q.window(f, 11, 11, 2, 4, hood="key")
        Q.window(f, 8, 17, 2, 3, hood="key")
        Q.window(f, 14, 17, 2, 3, hood="key")
        Q.window(f, 11, 23, 2, 3, hood=None)
        for side in ("x-", "x+"):
            for a in (6, 12):
                Q.window(b.face(side), a, 4, 2, 3, hood="cornice", surround=True)
                Q.window(b.face(side), a, 11, 2, 4, hood="key")
        # Belvedere on the ridge: an open turret with a pyramid roof.
        rz = b.roof.ridge_z
        v.box(10, 8, rz - 3, 14, 12, rz + 5, wall)
        P.dressed_quoins(v, 10, 8, 14, 12, rz - 3, rz + 5)
        for side, plane in (("y+", 11), ("x-", 10), ("x+", 13)):
            ff = P.Face(v, side, plane)
            for a in ((11,) if side == "y+" else (9,)):
                ff.put(a, rz + 2, None)
                ff.put(a + 1, rz + 2, None)
                ff.put(a, rz + 3, None)
                ff.put(a + 1, rz + 3, None)
        Q.string_course(v, 10, 8, 14, 12, rz + 4)
        tr = P.roof(v, 10, 14, 8, 12, rz + 5, "tiles", hip=True, rise=2.0, m=mat("terracotta", 0.86), eaves=False, seed=seed)
        Q.finial(v, 12, 10, tr.top, BRASS)
        P.roof_chimney(v, b.roof, 5, 13, above=3, brick=True, pots=2)
        P.roof_chimney(v, b.roof, 17, 5, above=3, brick=True, pots=2)
        P.flower_bed(v, 1, 19, 4, 23, seed=seed)
        P.flower_bed(v, 20, 19, 23, 23, seed=seed + 1)
        P.lamp_post(v, 5, 21, h=7)
        P.lamp_post(v, 18, 21, h=7)
        P.shrub(v, 21, 6, 1, 2, seed=seed)
    P.scatter(v, 0, 0, 24, 18, 0.03, seed=seed)
    v.anchor("door", 12, 24, 0)
    return P.colour_jitter(v, seed=seed)


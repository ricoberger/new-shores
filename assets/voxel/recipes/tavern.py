"""
Tavern (4 × 6; D-057 §3): a two-storey inn — coursed-stone ground floor
with dressed quoins and wide mullioned windows, a jettied, braced,
timber-framed plaster upper storey with blue shutters and flower boxes,
tiles with dormers and two brick chimneys, a hanging sign; an ochre
kitchen wing; a beer garden with trestle tables and benches, a stack of
casks, flower tubs, lanterns and a tree.
"""

from nsvoxel import parts as P
from nsvoxel.mats import BRASS, DYE_BLUE, FLOWER, PLASTER, TIMBER, TIMBER_DARK, TIMBER_LIGHT


def build(ctx):
    v = ctx.vox()  # 32 × 48
    P.yard(v, 0, 0, 32, 48, "grass", seed=33)
    P.yard(v, 2, 30, 30, 46, "paved", seed=33)
    # Main house: stone ground floor, jettied plaster upper floor (fronts on lite block boundaries).
    b = P.building(v, 4, 7, 24, 23, "citizen", along="x", upper=PLASTER, seed=33, spacing=4)
    f, F = b.face("y+"), b.face("y+", upper=True)
    P.entrance(f, 12, 2, 4, 5, leaf=TIMBER_DARK, frame=P.DRESSED, lintel=P.DRESSED, steps=2)
    P.casement(f, 6, 3, 4, 3, frame=TIMBER_DARK, sill=P.DRESSED, lintel=P.DRESSED)
    P.casement(f, 18, 3, 4, 3, frame=TIMBER_DARK, sill=P.DRESSED, lintel=P.DRESSED)
    for a in (5, 10, 16, 21):
        P.casement(F, a, 11, 2, 3, frame=None, sill=TIMBER_LIGHT, shutters=DYE_BLUE, box=FLOWER)
    # Hanging sign on an iron bracket: a brass tankard.
    P.trade_sign(f, 10, 7, BRASS)
    P.dormer_on(v, b.roof, 8, 12, "y+", wall=PLASTER)
    P.dormer_on(v, b.roof, 16, 20, "y+", wall=PLASTER)
    P.roof_chimney(v, b.roof, 5, 13, above=3, brick=True, pots=2)
    P.roof_chimney(v, b.roof, 21, 13, above=3, brick=True, pots=2)
    # Ochre wing (kitchen) to the east.
    w = P.building(v, 26, 9, 31, 21, "stone", along="y", seed=34, height=9)
    P.entrance(w.face("y+"), 27, 2, 3, 5)
    P.casement(w.face("x+"), 14, 4, 2, 3, frame=P.DRESSED, sill=P.DRESSED, lintel=P.DRESSED)
    # Beer garden: tables with benches, barrels, flower tubs.
    for x, y in ((5, 33), (14, 33), (5, 40), (14, 40)):
        for dx in (0, 5):
            v.box(x + dx, y, 1, x + dx + 1, y + 3, 2, TIMBER)
        v.box(x, y, 2, x + 6, y + 3, 3, TIMBER_LIGHT)
        P.bench(v, x, y - 1, 1, 6)
        P.bench(v, x, y + 3, 1, 6)
        v.set(x + 2, y + 1, 3, BRASS)
        v.set(x + 4, y + 2, 3, P.mat("timber", 1.38))
    for x, y in ((24, 32), (26, 32), (24, 35)):
        P.cask(v, x, y, 1)
    v.box(25, 33, 4, 26, 35, 5, TIMBER_LIGHT)
    P.cask(v, 25, 33, 4, h=2)
    for x in (2, 28):
        v.box(x, 44, 1, x + 2, 46, 2, TIMBER)
        v.box(x, 44, 2, x + 2, 46, 3, FLOWER)
    P.lamp_post(v, 2, 31)
    P.lamp_post(v, 22, 31)
    P.fruit_tree(v, 26, 41, 1, seed=33, trunk=5, r=3.6)
    P.scatter(v, 0, 0, 32, 30, 0.03, seed=33)
    return P.colour_jitter(v, seed=33)

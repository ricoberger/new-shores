"""
Optician (4 × 4; V7 variety pass, tier IV): a two-storey cream plaster house
with a lean-to shed and a slim chimney (smoke); in front a giant brass
telescope on a tripod, a big round glass lens on a stand and glass blanks on
a bench. 12 voxels per tile; massing and signature prop in NOTES.md.
"""

from nsvoxel import detail_v4 as V
from nsvoxel import parts as P
from nsvoxel import parts_kit as K
from nsvoxel import parts_v7 as W
from nsvoxel.grid import mat, shade_of
from nsvoxel.mats import CANVAS, IRON, STONE, TIMBER, TIMBER_DARK, TIMBER_LIGHT

VOXELS_PER_TILE = 12
GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

GOODS = mat("canvas", 1.3)
BRASS = mat("ochre", 1.5)
GLASS = mat("shallows", 1.5)

def build(ctx):
    v = ctx.vox()  # 48 × 48
    seed = 163
    K.ground(v, 24, 41, 21, 9, seed, "paved")
    h = K.workshop(v, 6, 6, 48 - 6, 28, 4, "b", seed, door=("y+", 22), smoke=True, chim=(34, 10), wins=[])
    for dx, dy in ((0, 0), (8, 0), (4, 6)):
        v.box(10 + dx, 32 + dy, 1, 11 + dx, 33 + dy, 12, TIMBER_DARK)
    v.box(8, 32, 12, 22, 40, 13, TIMBER_DARK)
    v.line((12, 35, 13), (30, 38, 28), BRASS)
    v.line((12, 36, 13), (30, 39, 28), BRASS)
    v.line((13, 35, 13), (31, 38, 28), BRASS)
    v.box(30, 37, 27, 35, 42, 32, BRASS)
    v.ellipsoid(38, 36, 6, 5, 5, 5, lambda x, y, z: GLASS, keep=lambda x, y, z: z >= 2)
    v.box(37, 35, 1, 40, 38, 3, TIMBER_DARK)
    v.box(32, 42, 1, 46, 46, 3, TIMBER_LIGHT)
    P.handcart(v, 8, 36, 1, along="x", load=GOODS)
    v.anchor("cart", 14, 42, 1)
    K.tufts(v, seed, 0.02)
    return P.colour_jitter(v, seed=seed)

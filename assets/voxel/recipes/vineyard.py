"""
Vineyard (4 × 5; V7 variety pass, tier IV): a two-storey cream plaster
winegrower's house with a plank drying tower at its west end under slate (no
chimney); in front three rows of tall staked vines hung with green leaf and
dark grapes, and a big grape vat. 12 voxels per tile; massing and signature
prop in NOTES.md.
Re-dressed in the rural look (D-075 §3, `look: rural`): the tier-I look — boarded
walls on a stone band under weathered thatch — whatever the unlock tier; the
props and the signature parts are unchanged.
"""

from nsvoxel import detail_v4 as V
from nsvoxel import parts as P
from nsvoxel import parts_kit as K
from nsvoxel import parts_v7 as W
from nsvoxel.grid import mat, shade_of
from nsvoxel.mats import CANVAS, IRON, STONE, TIMBER, TIMBER_DARK, TIMBER_LIGHT

VOXELS_PER_TILE = 12
GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

GOODS = mat("dye-blue", 0.7)
LEAF = mat("grass-b", 0.85)

def build(ctx):
    v = ctx.vox()  # 48 × 60
    seed = 171
    K.ground(v, 24, 47, 21, 15, seed, "paved")
    h = K.workshop(v, 6, 6, 48 - 6, 28, 1, "e", seed, door=("y+", 22), wins=[], out="tower")
    for y in (36, 44, 52):
        for x in range(6, 44, 4):
            v.box(x, y, 1, x + 1, y + 1, 10, TIMBER_DARK)
        v.box(6, y, 9, 45, y + 1, 10, TIMBER)
        v.box(6, y, 2, 45, y + 1, 9, LEAF)
        for x in range(7, 44, 3):
            v.box(x, y, 3, x + 1, y + 1, 6, GOODS)
    V.vat(v, 40, 57, 1, r=4, h=6, m=mat("timber", 1.1), liquid=GOODS)
    v.anchor("cart", 14, 54, 1)
    K.tufts(v, seed, 0.02)
    return P.colour_jitter(v, seed=seed)

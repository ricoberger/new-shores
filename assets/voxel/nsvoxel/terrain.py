"""
Terrain pieces of the decor recipes (D-058): the arched stone bridge that
carries a road over one or two river tiles. Coordinates are voxels (8 per
tile, grid.VPT), x along the road, y across it, z up from the river's
surface; the model is centred on the origin in x and y.
"""

from .grid import VPT, hash3
from .mats import PLANK, STONE, STONE_DARK, STONE_LIGHT

#: The deck's top above the river surface (voxels): the river runs two
#: steps (two voxels at 8 per tile) below its banks, the deck one above.
DECK_TOP = 3
#: Voxels the abutments reach onto each bank.
ABUTMENT = 2
#: Deck width (voxels) and parapet height above the deck.
WIDTH = 6
PARAPET = 1


def arch_bridge(v, tiles, seed=0):
    """
    An arched bridge over `tiles` river tiles: one stone arch per tile
    (its opening highest mid-tile), a plank deck that rises by a voxel
    over the middle of a long span, low parapets on both sides and
    abutments on the banks.
    """
    span = tiles * VPT
    half = span // 2
    x0 = -half - ABUTMENT
    x1 = half + ABUTMENT
    y0 = -WIDTH // 2
    y1 = y0 + WIDTH
    for x in range(x0, x1):
        # Arch underside: per tile, 0 at the piers, 2 voxels under the crown.
        if -half <= x < half:
            t = ((x + half) % VPT + 0.5) / VPT
            under = round(2.2 * (1 - (2 * t - 1) ** 2))
        else:
            under = 1  # the abutment stands on the bank (its top two voxels above the river)
        hump = 1 if tiles > 1 and abs(x + 0.5) < VPT * 0.6 else 0
        top = DECK_TOP + hump
        for y in range(y0, y1):
            edge = y in (y0, y1 - 1)
            for z in range(under, top):
                shade = hash3(x, y, z, seed + 5)
                m = STONE_DARK if z == under and under > 0 else (STONE_LIGHT if shade < 0.18 else STONE)
                v.set(x, y, z, m)
            if edge:
                for z in range(top, top + PARAPET):
                    v.set(x, y, z, STONE_LIGHT)
            elif -half <= x < half:
                v.set(x, y, top - 1, PLANK)
    return v

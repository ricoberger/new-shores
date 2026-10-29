"""
Theatre (11 × 14; D-057 §3): a Roman theatre in warm stone — an open
half-round cavea of tiered seats toward the street, rising to an outer
wall with an arcade of arches and pilasters, a walkway half-way up, radial
stairs; a paved half-round orchestra; a raised stage with a niched front;
behind it the stage house (scaenae frons) two storeys high with columns,
entablatures, three doors and a red tile roof, end towers; a paved forecourt
with steps, statues on plinths and cypresses.
"""

import math

from nsvoxel import parts as P
from nsvoxel.grid import mat
from nsvoxel.mats import STONE_DARK, TIMBER, TIMBER_DARK, WINDOW

WARM = mat("cliff-upper", 1.12)
WARM_DARK = mat("cliff-upper", 0.96)
SEAT = mat("cliff-upper", 1.2)
DRESSED = mat("cliff-upper", 1.3)
MARBLE = mat("plaster", 1.08)
ROOF = mat("terracotta")
SHADOW = mat("cliff-foot", 1.0)

#: Orchestra centre and the cavea's half-ellipse (radii in voxels).
CX, CY = 44, 38
RX, RY = 43, 56
R0 = 12  # orchestra radius
TREAD = 2.6


def ring(x, y):
    """Normalised radius (in voxels along x) of a cell centre from the orchestra centre on the cavea ellipse."""
    dx = (x + 0.5 - CX) / RX
    dy = (y + 0.5 - CY) / RY
    return math.hypot(dx, dy) * RX


def build(ctx):
    v = ctx.vox()  # 88 × 112
    seed = 181
    P.yard(v, 0, 0, 88, 112, "paved", seed=seed)
    n_tiers = int((RX - 3 - R0) / TREAD)
    top = 1 + n_tiers
    mid = n_tiers // 2
    # Cavea: tiers rising outward on the street side (y >= CY), radial stairs, a walkway.
    for x in range(88):
        for y in range(CY, 112):
            r = ring(x, y)
            if r < R0 or r >= RX:
                continue
            ang = math.degrees(math.atan2((y + 0.5 - CY) / RY, (x + 0.5 - CX) / RX))
            if r >= RX - 3:
                # The outer wall: from the ground to above the top tier.
                for z in range(1, top + 4):
                    v.set(x, y, z, WARM if z % 4 else WARM_DARK)
                v.set(x, y, top + 4, DRESSED)
                continue
            k = int((r - R0) / TREAD)
            h = 1 + k
            stair = min(abs(ang - a) for a in (22.5, 67.5, 112.5, 157.5)) < 2.2
            for z in range(1, h):
                v.set(x, y, z, WARM_DARK)
            if stair:
                # Half-height steps: an extra lighter layer on the outer half of each tread.
                v.set(x, y, h, DRESSED)
            elif k == mid:
                v.set(x, y, h, DRESSED)
            else:
                v.set(x, y, h, SEAT if k % 2 else WARM)
    # Arcade on the outer wall: arched openings (dark) and pilasters, a row of small windows.
    for x in range(88):
        for y in range(CY, 112):
            r = ring(x, y)
            if not (RX - 1 <= r < RX):
                continue
            ang = math.degrees(math.atan2((y + 0.5 - CY) / RY, (x + 0.5 - CX) / RX))
            ph = (ang % 7.5) / 7.5
            if 0.25 < ph < 0.75:
                for z in range(1, 7):
                    v.set(x, y, z, SHADOW)
                if 0.35 < ph < 0.65:
                    v.set(x, y, 7, SHADOW)
            elif ph < 0.1 or ph > 0.9:
                for z in range(1, top + 4):
                    v.set(x, y, z, DRESSED if z in (1, 8, top + 3) else WARM)
            if 0.4 < ph < 0.6:
                for z in (10, 11):
                    v.set(x, y, z, SHADOW)
    # Orchestra: a paved half-round of pale stone with a ring.
    for x in range(88):
        for y in range(CY, 112):
            r = math.hypot(x + 0.5 - CX, y + 0.5 - CY)
            if r < R0:
                v.set(x, y, 0, MARBLE if int(r) % 4 else DRESSED)
    # Stage: a raised platform with a niched front.
    sx0, sx1, sy0, sy1 = 12, 76, 26, 38
    P.fill(v, sx0, sy0, sx1, sy1, 1, 4, WARM_DARK)
    v.box(sx0, sy0, 4, sx1, sy1, 5, TIMBER)
    for x in range(sx0, sx1):
        v.set(x, sy1 - 1, 4, mat("timber", 1.15))
        if (x - sx0) % 6 in (2, 3):
            v.set(x, sy1 - 1, 2, SHADOW)
            v.set(x, sy1 - 1, 3, SHADOW)
    # Stage house: the scaenae frons, two orders of columns, three doors, a tiled roof.
    hx0, hx1, hy0, hy1 = 8, 80, 12, 26
    P.fill(v, hx0, hy0, hx1, hy1, 1, 30, WARM)
    for z in range(1, 30, 4):
        v.walls(hx0, hy0, hx1, hy1, z, z + 1, WARM_DARK)
    for z in (5, 17, 29):
        v.box(hx0, hy1, z, hx1, hy1 + 1, z + 1, DRESSED)
        v.box(hx0, hy1, z - 1, hx1, hy1 + 1, z, WARM_DARK)
    for x in range(hx0 + 2, hx1 - 1, 5):
        for z0, z1 in ((5, 17), (17, 29)):
            v.box(x, hy1, z0, x + 1, hy1 + 2, z1, MARBLE)
            v.box(x, hy1, z0, x + 1, hy1 + 2, z0 + 1, DRESSED)
            v.box(x, hy1, z1 - 1, x + 1, hy1 + 2, z1, DRESSED)
        # Niches between the columns.
        if x + 5 < hx1:
            for z0 in (8, 20):
                v.box(x + 2, hy1 - 1, z0, x + 4, hy1, z0 + 6, SHADOW)
    for a, w in ((41, 6), (24, 4), (60, 4)):
        v.box(a, hy1 - 1, 5, a + w, hy1, 5 + (9 if w == 6 else 7), TIMBER_DARK)
        v.box(a - 1, hy1, 5 + (9 if w == 6 else 7), a + w + 1, hy1 + 1, 6 + (9 if w == 6 else 7), DRESSED)
    P.roof(v, hx0, hx1, hy0, hy1 + 2, 30, "tiles", along="x", rise=0.7, ov=1, seed=seed, m=ROOF)
    # End towers (versurae) with windows and tiled hips.
    for tx in (1, 80):
        P.coursed_stone(v, tx, 10, tx + 7, 30, 1, 26, WARM, seed=seed + tx)
        P.roof(v, tx, tx + 7, 10, 30, 26, "tiles", along="y", hip=True, rise=0.9, ov=1, seed=seed, m=ROOF)
        f = P.Face(v, "y+", 29)
        for z in (8, 16):
            P.casement(f, tx + 3, z, 1, 3, frame=DRESSED, sill=DRESSED, bars=False)
        fx = P.Face(v, "x-", tx)
        for a in (14, 20, 25):
            P.casement(fx, a, 16, 1, 3, frame=DRESSED, sill=DRESSED, bars=False)
        P.entrance(f, tx + 2, 1, 3, 6, leaf=TIMBER, frame=DRESSED, arch=True)
    # Back portico behind the stage house.
    for x in range(10, 79, 6):
        v.box(x, 3, 1, x + 1, 4, 12, MARBLE)
    P.roof(v, 8, 80, 2, 12, 12, "tiles", along="x", rise=0.6, ov=0, seed=seed, m=mat("terracotta", 0.88))
    # Forecourt: steps up to the cavea's axis, statues on plinths, cypresses.
    for x, y in ((14, 104), (74, 104), (4, 60), (84, 60)):
        v.box(x, y, 1, x + 3, y + 3, 4, DRESSED)
        v.box(x + 1, y + 1, 4, x + 2, y + 2, 9, MARBLE)
        v.box(x, y + 1, 7, x + 3, y + 2, 8, MARBLE)
    for x, y in ((2, 92), (84, 92), (2, 40), (84, 40), (24, 108), (62, 108)):
        v.box(x, y, 1, x + 1, y + 1, 3, TIMBER)
        for z in range(3, 13):
            rr = 1.6 if z < 10 else 0.9
            for dx in range(-2, 3):
                for dy in range(-2, 3):
                    if dx * dx + dy * dy <= rr * rr:
                        v.set(x + dx, y + dy, z, mat("tree-crown", 0.8))
    for x in range(36, 52):
        for k in range(3):
            v.set(x, 106 - k * 2, 0, DRESSED)
    P.scatter(v, 0, 0, 88, 112, 0.004, seed=seed, kinds=("pebble",))
    return P.colour_jitter(v, seed=seed)

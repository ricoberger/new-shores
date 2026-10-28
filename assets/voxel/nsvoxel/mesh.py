"""
Greedy meshing of a voxel grid into quads with per-corner ambient
occlusion (0fps.net "Meshing in a Minecraft game" and "Ambient occlusion
for Minecraft-like worlds"). Faces of equal material whose four corners
have the same occlusion merge into one rectangle; faces with an occlusion
gradient stay single, so the gradient is not stretched. Faces pointing
down are dropped (the fixed camera elevation never sees them).
"""

#: (normal axis, u axis, v axis) with u × v = +normal (counter-clockwise quads seen from outside).
AXES = ((0, 1, 2), (1, 2, 0), (2, 0, 1))


def _unit(axis, s=1):
    e = [0, 0, 0]
    e[axis] = s
    return e


def faces(cells, skip_down=True, ao=True):
    """
    Visible faces grouped by plane: {(axis, sign, plane): {(u, v): key}} with
    key = (material, (o0, o1, o2, o3)), occlusion levels 0..3 per corner in
    the order (u, v), (u+1, v), (u+1, v+1), (u, v+1).
    """
    solid = cells.keys()
    out = {}
    for axis, ua, va in AXES:
        for sign in (1, -1):
            if skip_down and axis == 2 and sign == -1:
                continue
            for c, m in cells.items():
                q = list(c)
                q[axis] += sign
                if tuple(q) in solid:
                    continue
                levels = (0, 0, 0, 0)
                if ao:
                    lv = []
                    for du, dv in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                        s1 = list(q)
                        s1[ua] += du
                        s2 = list(q)
                        s2[va] += dv
                        cc = list(q)
                        cc[ua] += du
                        cc[va] += dv
                        a = tuple(s1) in solid
                        b = tuple(s2) in solid
                        lv.append(3 if (a and b) else a + b + (tuple(cc) in solid))
                    levels = tuple(lv)
                plane = c[axis] + (1 if sign > 0 else 0)
                out.setdefault((axis, sign, plane), {})[(c[ua], c[va])] = (m, levels)
    return out


def greedy(cells, skip_down=True, ao=True):
    """
    The quads of a grid: (corners, axis, sign, material, levels) with corners
    four (x, y, z) points in voxel units, counter-clockwise seen from outside.
    Deterministic order.
    """
    quads = []
    for (axis, sign, plane), face in sorted(faces(cells, skip_down, ao).items()):
        _, ua, va = AXES[axis]
        used = set()
        for u, v in sorted(face, key=lambda p: (p[1], p[0])):
            if (u, v) in used:
                continue
            key = face[(u, v)]
            o = key[1]
            # Merging is exact where the occlusion does not vary along the merge
            # direction: uniform faces grow both ways, a gradient along v lets
            # a face grow along u (and vice versa).
            uniform = len(set(o)) == 1
            along_u = uniform or (o[0] == o[1] and o[3] == o[2])
            along_v = uniform or (o[0] == o[3] and o[1] == o[2])
            w = 1
            if along_u:
                while (u + w, v) in face and (u + w, v) not in used and face[(u + w, v)] == key:
                    w += 1
            h = 1
            if along_v:
                while all((u + i, v + h) in face and (u + i, v + h) not in used and face[(u + i, v + h)] == key for i in range(w)):
                    h += 1
            for i in range(w):
                for j in range(h):
                    used.add((u + i, v + j))
            corners = []
            for cu, cv in ((u, v), (u + w, v), (u + w, v + h), (u, v + h)):
                p = [0, 0, 0]
                p[axis] = plane
                p[ua] = cu
                p[va] = cv
                corners.append(tuple(p))
            levels = key[1]
            if sign < 0:
                corners = [corners[0], corners[3], corners[2], corners[1]]
                levels = (levels[0], levels[3], levels[2], levels[1])
            quads.append((corners, axis, sign, key[0], levels))
    return quads


def triangles(quads):
    """Two triangles per quad: (corner indices) picked so the occlusion gradient is not folded (anisotropy fix)."""
    out = []
    for corners, axis, sign, m, o in quads:
        if o[0] + o[2] < o[1] + o[3]:
            idx = ((1, 2, 3), (1, 3, 0))
        else:
            idx = ((0, 1, 2), (0, 2, 3))
        for t in idx:
            out.append(([corners[i] for i in t], m, [o[i] for i in t], axis, sign))
    return out

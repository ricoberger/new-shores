"""
Everything that needs Blender (bpy): importing kit pieces (glTF) into
triangles with material names, atlas swatch classification, mesh
simplification, and the contact-sheet renders (Workbench).
"""

import math
import re

import bmesh
import bpy
from mathutils import Matrix, Vector

from . import atlas, config, geometry

_SUFFIX = re.compile(r"\.\d{3}$")


def blender_version():
    """'major.minor' (the manifest records no patch level: 5.2.x builds are identical)."""
    v = bpy.app.version
    return f"{v[0]}.{v[1]}"


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def _clear_scene():
    objs = list(bpy.data.objects)
    if objs:
        bpy.data.batch_remove(objs)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.curves, bpy.data.cameras, bpy.data.lights):
        items = [x for x in coll if x.users == 0]
        if items:
            bpy.data.batch_remove(items)


class KitLoader:
    """Loads kit pieces once per (file, simplify) and returns triangles (a, b, c, material) in kit units, Blender axes."""

    def __init__(self, files_of):
        self.files_of = files_of  # (kit, rel) -> absolute path
        self.cache = {}

    def __call__(self, kit, rel, simplify):
        key = (kit, rel, tuple(sorted((simplify or {}).items())))
        if key not in self.cache:
            raw = self._import(kit, rel)
            if simplify:
                raw = _simplify(raw, simplify)
            self.cache[key] = raw
        return self.cache[key]

    def _import(self, kit, rel):
        _clear_scene()
        bpy.ops.import_scene.gltf(filepath=self.files_of(kit, rel), loglevel=50)
        bpy.context.view_layer.update()
        dg = bpy.context.evaluated_depsgraph_get()
        tris = []
        cells = config.KIT_ATLAS_CELLS.get(kit)
        for obj in sorted((o for o in bpy.context.scene.objects if o.type == "MESH"), key=lambda o: o.name):
            ev = obj.evaluated_get(dg)
            me = ev.to_mesh()
            me.calc_loop_triangles()
            mw = obj.matrix_world
            uv = me.uv_layers.active.data if me.uv_layers.active else None
            for t in me.loop_triangles:
                slot = obj.material_slots[t.material_index].material if obj.material_slots else None
                mname = _SUFFIX.sub("", slot.name) if slot else "-"
                if cells is not None:
                    mname = atlas.classify(cells, [tuple(uv[i].uv) for i in t.loops]) if uv is not None else f"Atlas/{cells['default'][0]}@1"
                pts = [tuple(mw @ me.vertices[v].co) for v in t.vertices]
                tris.append((pts[0], pts[1], pts[2], mname))
            ev.to_mesh_clear()
        _clear_scene()
        return tris

    def occlusion(self, tris, ground):
        """
        Baked ambient occlusion: one (level, level, level) tuple per triangle
        (0 = open … AO_LEVELS = fully occluded) from fixed hemisphere rays
        against the mesh itself (and the ground plane z = 0 when ground).
        """
        from mathutils.bvhtree import BVHTree

        if not tris:
            return []
        verts, polys = [], []
        for t in tris:
            base = len(verts)
            verts += [Vector(p) for p in t[:3]]
            polys.append((base, base + 1, base + 2))
        bvh = BVHTree.FromPolygons(verts, polys, all_triangles=True, epsilon=0.0)
        dirs = geometry.hemisphere(config.AO_RAYS)
        dist = config.AO_DISTANCE
        levels = config.AO_LEVELS
        cache = {}
        out = []
        for t in tris:
            n = t[6] if len(t) > 6 else geometry.normal(*t[:3])
            tb = geometry.frame(n)
            world = [Vector(tuple(d[0] * tb[0][i] + d[1] * tb[1][i] + d[2] * tb[2][i] for i in range(3))) for d in dirs]
            cx = [sum(p[i] for p in t[:3]) / 3 for i in range(3)]
            corner = []
            for p in t[:3]:
                # Slightly inside the triangle and off its surface (no self hits at shared edges).
                o = tuple(p[i] + (cx[i] - p[i]) * 0.15 + n[i] * 2e-3 for i in range(3))
                key = (tuple(round(c, 5) for c in o), tuple(round(c, 4) for c in n))
                if key not in cache:
                    origin = Vector(o)
                    hits = 0
                    for d in world:
                        loc, _, _, _ = bvh.ray_cast(origin, d, dist)
                        if loc is not None:
                            hits += 1
                        elif ground and d.z < -1e-6 and o[2] >= -1e-6 and -o[2] / d.z <= dist:
                            hits += 1
                    cache[key] = int(math.floor(hits / len(world) * levels + 0.5))
                corner.append(cache[key])
            out.append(tuple(corner))
        return out

    def decimate(self, mesh, ratio):
        """A Mesh decimated by edge collapse to ratio of its triangles (role, shade, label and explicit normals kept per face)."""
        keys = []
        index = {}
        raw = []
        for t in mesh.tris:
            k = tuple(t[3:])
            if k not in index:
                index[k] = f"m{len(keys)}"
                keys.append(k)
            raw.append((t[0], t[1], t[2], index[k]))
        out = _simplify(raw, {"collapse": ratio})
        back = {f"m{i}": k for i, k in enumerate(keys)}
        tris = [(a, b, c) + back[m] for a, b, c, m in out if geometry.area2(a, b, c) > 1e-12]
        return geometry.Mesh(tris)

    def bevel(self, tris, width):
        """Primitive triangles (a, b, c) with their sharp edges (> 30°) bevelled by width (one segment)."""
        key = ("bevel", round(width, 6), tuple(tuple(round(c, 6) for p in t for c in p) for t in tris))
        if key not in self.cache:
            _clear_scene()
            obj, _ = _mesh_from_tris("bevel", [(a, b, c, "-") for a, b, c in tris])
            mod = obj.modifiers.new("bevel", "BEVEL")
            mod.width = width
            mod.segments = 1
            mod.limit_method = "ANGLE"
            mod.angle_limit = math.radians(30)
            mod.use_clamp_overlap = True
            dg = bpy.context.evaluated_depsgraph_get()
            ev = obj.evaluated_get(dg)
            me = ev.to_mesh()
            me.calc_loop_triangles()
            out = [tuple(tuple(me.vertices[v].co) for v in lt.vertices) for lt in me.loop_triangles]
            ev.to_mesh_clear()
            _clear_scene()
            self.cache[key] = out
        return self.cache[key]

def _mesh_from_tris(name, tris):
    """A Blender mesh object from (a, b, c, material) triangles, welded (decimation needs connectivity)."""
    me = bpy.data.meshes.new(name)
    mats = []
    for t in tris:
        if t[3] not in mats:
            mats.append(t[3])
    bm = bmesh.new()
    for t in tris:
        vs = [bm.verts.new(p) for p in t[:3]]
        try:
            f = bm.faces.new(vs)
        except ValueError:
            continue
        f.material_index = mats.index(t[3])
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        mat = bpy.data.materials.get(m) or bpy.data.materials.new(m)
        me.materials.append(mat)
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    return obj, mats


def _simplify(tris, simplify):
    _clear_scene()
    obj, mats = _mesh_from_tris("simplify", tris)
    if "dissolve" in simplify:
        mod = obj.modifiers.new("dissolve", "DECIMATE")
        mod.decimate_type = "DISSOLVE"
        mod.angle_limit = math.radians(simplify["dissolve"])
        mod.delimit = {"MATERIAL"}
    if "collapse" in simplify:
        mod = obj.modifiers.new("collapse", "DECIMATE")
        mod.decimate_type = "COLLAPSE"
        mod.ratio = simplify["collapse"]
        mod.use_collapse_triangulate = True
    dg = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(dg)
    me = ev.to_mesh()
    me.calc_loop_triangles()
    out = []
    for t in me.loop_triangles:
        pts = [tuple(me.vertices[v].co) for v in t.vertices]
        out.append((pts[0], pts[1], pts[2], mats[t.material_index]))
    ev.to_mesh_clear()
    _clear_scene()
    return out


# Contact sheets --------------------------------------------------------------

ELEVATION = math.radians(30)
BASE_AZIMUTH = math.radians(45)
#: Direction toward the sun in recipe space (the game's world-fixed golden-hour sun, render/lighting.ts).
_SUN = Vector((0.66 * math.cos(math.radians(38)), -0.75 * math.cos(math.radians(38)), math.sin(math.radians(38)))).normalized()
_INK = (0.17, 0.13, 0.09)


def _srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def _lit(rgb, n, sky, sun):
    d = max(0.0, n.dot(_SUN))
    return tuple(min(1.0, c * (0.6 * s + 0.7 * u * d)) for c, s, u in zip(rgb, sky, sun))


def _render_object(name, tris, corners, rot_k, location, sky, sun):
    me = bpy.data.meshes.new(name)
    verts, faces = [], []
    for t in tris:
        base = len(verts)
        verts += list(t[:3])
        faces.append((base, base + 1, base + 2))
    me.from_pydata(verts, [], faces)
    attr = me.color_attributes.new("col", "FLOAT_COLOR", "CORNER")
    data = []
    for t, cols in zip(tris, corners):
        n = Vector(t[6] if len(t) > 6 else geometry.normal(*t[:3]))
        for col in cols:
            data += [_srgb_to_linear(c) for c in _lit(col, n, sky, sun)] + [1.0]
    attr.data.foreach_set("color", data)
    me.color_attributes.active_color = attr
    obj = bpy.data.objects.new(name, me)
    obj.rotation_euler = (0.0, 0.0, rot_k * math.pi / 2)
    obj.location = location
    bpy.context.scene.collection.objects.link(obj)
    return obj


def _text(body, location, rotation, size):
    cu = bpy.data.curves.new("label", "FONT")
    cu.body = body
    cu.size = size
    cu.align_x = "CENTER"
    tmp = bpy.data.objects.new("label_tmp", cu)
    bpy.context.scene.collection.objects.link(tmp)
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(tmp.evaluated_get(dg))
    bpy.data.objects.remove(tmp)
    attr = me.color_attributes.new("col", "FLOAT_COLOR", "CORNER")
    ink = [_srgb_to_linear(c) for c in _INK] + [1.0]
    attr.data.foreach_set("color", ink * len(attr.data))
    me.color_attributes.active_color = attr
    obj = bpy.data.objects.new("label", me)
    obj.location = location
    obj.rotation_euler = rotation
    bpy.context.scene.collection.objects.link(obj)


def render_sheet(path, cells, cols, rows, cell_tiles, px, sky, sun, background):
    """
    Renders cells (label, tris, corner colours, rotation step, column, row) into a
    grid seen by the game's camera (orthographic, 30° elevation, azimuth 45°;
    rotation step k turns the model by k·90°, i.e. the camera's step k).
    """
    _clear_scene()
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    shading = scene.display.shading
    shading.light = "FLAT"
    shading.color_type = "VERTEX"
    shading.show_object_outline = True
    shading.object_outline_color = (0.12, 0.09, 0.06)
    scene.view_settings.view_transform = "Standard"
    scene.render.film_transparent = False
    world = bpy.data.worlds.get("sheet") or bpy.data.worlds.new("sheet")
    world.color = tuple(_srgb_to_linear(c) for c in background)
    scene.world = world
    scene.render.resolution_x = cols * px
    scene.render.resolution_y = rows * px
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    cam_data = bpy.data.cameras.get("sheet") or bpy.data.cameras.new("sheet")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = max(cols, rows) * cell_tiles
    cam = bpy.data.objects.new("sheet_cam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    back = Vector((math.sin(BASE_AZIMUTH) * math.cos(ELEVATION), math.cos(BASE_AZIMUTH) * math.cos(ELEVATION), math.sin(ELEVATION)))
    rot = (-back).to_track_quat("-Z", "Y")
    cam.rotation_euler = rot.to_euler()
    cam.location = back * 200.0
    cam_data.clip_end = 400.0
    m = rot.to_matrix()
    right, up = m.col[0], m.col[1]
    for i, (label, tris, corners, k, col, row) in enumerate(cells):
        cx = (col - (cols - 1) / 2) * cell_tiles
        cy = ((rows - 1) / 2 - row) * cell_tiles
        centre = right * cx + up * cy
        _render_object(f"cell{i}", tris, corners, k, centre - up * (cell_tiles * 0.12), sky, sun)
        if label:
            _text(label, centre - up * (cell_tiles * 0.42), rot.to_euler(), cell_tiles * 0.07)
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    _clear_scene()


def render_thumb(path, tris, corners, px, sky, sun, frame):
    """
    Renders one model as a build-card thumbnail: the game's camera
    (orthographic, 30° elevation, azimuth 45°), flat vertex colours with
    the contact sheets' ink outline, transparent background, px × px.
    frame(right, up) returns the model's centre in the view plane and the
    ortho scale (pipeline.thumb_frame).
    """
    _clear_scene()
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    shading = scene.display.shading
    shading.light = "FLAT"
    shading.color_type = "VERTEX"
    shading.show_object_outline = True
    shading.object_outline_color = (0.12, 0.09, 0.06)
    scene.view_settings.view_transform = "Standard"
    scene.render.film_transparent = True
    scene.render.resolution_x = px
    scene.render.resolution_y = px
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.render.image_settings.compression = 100
    # No metadata (date, time, render time, file name…): rebuilds are byte-identical.
    for attr in dir(scene.render):
        if attr.startswith("use_stamp"):
            setattr(scene.render, attr, False)
    cam_data = bpy.data.cameras.get("thumb") or bpy.data.cameras.new("thumb")
    cam_data.type = "ORTHO"
    cam = bpy.data.objects.new("thumb_cam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    back = Vector((math.sin(BASE_AZIMUTH) * math.cos(ELEVATION), math.cos(BASE_AZIMUTH) * math.cos(ELEVATION), math.sin(ELEVATION)))
    rot = (-back).to_track_quat("-Z", "Y")
    cam.rotation_euler = rot.to_euler()
    m = rot.to_matrix()
    right, up = m.col[0], m.col[1]
    (cx, cy), scale = frame(tuple(right), tuple(up))
    cam_data.ortho_scale = scale
    cam.location = back * 200.0 + right * cx + up * cy
    cam_data.clip_end = 400.0
    _render_object("thumb", tris, corners, 0, Vector((0.0, 0.0, 0.0)), sky, sun)
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    _clear_scene()

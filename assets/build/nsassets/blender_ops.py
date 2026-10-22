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
from .palette import hex_rgb

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
        self.atlas_pixels = {}

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
        swatches = config.KIT_ATLAS_SWATCHES.get(kit)
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
                elif swatches is not None:
                    mname = "Atlas/" + self._swatch(slot, uv, t, swatches)
                pts = [tuple(mw @ me.vertices[v].co) for v in t.vertices]
                tris.append((pts[0], pts[1], pts[2], mname))
            ev.to_mesh_clear()
        _clear_scene()
        return tris

    def _swatch(self, material, uv, tri, swatches):
        img = None
        if material and material.node_tree:
            for n in material.node_tree.nodes:
                if n.type == "TEX_IMAGE" and n.image:
                    img = n.image
                    break
        if img is None or uv is None:
            return swatches[0][0]
        key = img.name
        if key not in self.atlas_pixels:
            self.atlas_pixels[key] = (img.size[0], img.size[1], img.pixels[:])
        w, h, px = self.atlas_pixels[key]
        u = sum(uv[i].uv[0] for i in tri.loops) / 3
        v = sum(uv[i].uv[1] for i in tri.loops) / 3
        x = int(math.floor(u * w)) % w
        y = int(math.floor(v * h)) % h
        i = (y * w + x) * 4
        rgb = (px[i], px[i + 1], px[i + 2])
        best = min(swatches, key=lambda s: sum((a - b) ** 2 for a, b in zip(rgb, hex_rgb(s[1]))))
        return best[0]


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


def _render_object(name, tris, colors, rot_k, location, sky, sun):
    me = bpy.data.meshes.new(name)
    verts, faces = [], []
    for t in tris:
        base = len(verts)
        verts += list(t[:3])
        faces.append((base, base + 1, base + 2))
    me.from_pydata(verts, [], faces)
    attr = me.color_attributes.new("col", "FLOAT_COLOR", "CORNER")
    data = []
    for t in tris:
        n = Vector(t[6] if len(t) > 6 else geometry.normal(*t[:3]))
        rgb = _lit(colors[(t[3], t[4])], n, sky, sun)
        lin = [_srgb_to_linear(c) for c in rgb] + [1.0]
        data += lin * 3
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
    Renders cells (label, tris, colors, rotation step, column, row) into a
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
    for i, (label, tris, colors, k, col, row) in enumerate(cells):
        cx = (col - (cols - 1) / 2) * cell_tiles
        cy = ((rows - 1) / 2 - row) * cell_tiles
        centre = right * cx + up * cy
        _render_object(f"cell{i}", tris, colors, k, centre - up * (cell_tiles * 0.12), sky, sun)
        if label:
            _text(label, centre - up * (cell_tiles * 0.42), rot.to_euler(), cell_tiles * 0.07)
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    _clear_scene()

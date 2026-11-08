# Sahkarmi brand faces: five floating robot heads (owner reference 2026-11-08) ->
# .blend, one .glb each (Idle / Hover / Wave clips), lineup render, avatar frames.
# Run: blender -b -P build_heads.py -- <out_dir>
import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
OUT = argv[0]
for sub in ("glb", "renders", "avatars"):
    os.makedirs(os.path.join(OUT, sub), exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = 24
D = math.radians
HOVER = 0.42  # head centre height above the pedestal top


def lin(h):
    h = h.lstrip("#")
    c = [int(h[i : i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c)


_mats = {}


def mat(name, color, metallic=0.0, rough=0.5, coat=0.0, emit=None, strength=0.0, sheen=0.0, film=0.0):
    if name in _mats:
        return _mats[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes["Principled BSDF"]
    p.inputs["Base Color"].default_value = (*lin(color), 1)
    p.inputs["Metallic"].default_value = metallic
    p.inputs["Roughness"].default_value = rough
    for key, value in (("Coat Weight", coat), ("Sheen Weight", sheen), ("Thin Film Thickness", film)):
        if key in p.inputs:
            p.inputs[key].default_value = value
    if emit:
        p.inputs["Emission Color"].default_value = (*lin(emit), 1)
        p.inputs["Emission Strength"].default_value = strength
    m.diffuse_color = (*lin(color), 1)
    _mats[name] = m
    return m


VISOR = lambda: mat("visor_glass", "#0b0e14", rough=0.05, coat=1.0)  # noqa: E731
CHROME = lambda: mat("chrome", "#c9ced6", metallic=1.0, rough=0.18)  # noqa: E731
DARK = lambda: mat("dark_metal", "#2f343c", metallic=1.0, rough=0.35)  # noqa: E731

_parts = []


def finish(o, material, bone, smooth=True, bevel=0.0, segments=3):
    o.data.materials.clear()
    o.data.materials.append(material)
    for poly in o.data.polygons:
        poly.material_index = 0
    for poly in o.data.polygons:
        poly.use_smooth = smooth
    if bevel:
        mod = o.modifiers.new("bevel", "BEVEL")
        mod.width = bevel
        mod.segments = segments
        mod.limit_method = "ANGLE"
    _parts.append((o, bone))
    return o


def sphere(name, loc, r, material, bone="body", scale=(1, 1, 1), seg=48, rings=24, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=rings, radius=r, location=loc, rotation=rot)
    o = bpy.context.object
    o.name, o.scale = name, scale
    return finish(o, material, bone)


def ico(name, loc, r, material, bone="body", subdiv=1, scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdiv, radius=r, location=loc)
    o = bpy.context.object
    o.name, o.scale = name, scale
    return finish(o, material, bone, smooth=False, bevel=0.012, segments=2)


def cyl(name, loc, r, depth, material, bone="body", rot=(0, 0, 0), verts=32, scale=(1, 1, 1), bevel=0.0):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=depth, location=loc, rotation=rot)
    o = bpy.context.object
    o.name, o.scale = name, scale
    return finish(o, material, bone, smooth=False, bevel=bevel)


def cone(name, loc, r1, r2, depth, material, bone="body", rot=(0, 0, 0), verts=32, smooth=True):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r1, radius2=r2, depth=depth, location=loc, rotation=rot)
    o = bpy.context.object
    o.name = name
    return finish(o, material, bone, smooth=smooth)


def torus(name, loc, major, minor, material, bone="body", rot=(0, 0, 0), scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor, location=loc, rotation=rot,
                                     major_segments=48, minor_segments=12)
    o = bpy.context.object
    o.name, o.scale = name, scale
    return finish(o, material, bone)


def rbox(name, loc, size, material, bone="body", rot=(0, 0, 0), bevel=0.05, segments=6, smooth=True):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.object
    o.name, o.scale = name, size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    o = finish(o, material, bone, smooth=smooth, bevel=bevel, segments=segments)
    if smooth:
        o.modifiers["bevel"].limit_method = "NONE"
    return o


def arc_eye(name, loc, r, material, bone="eyes"):
    """A happy ^ eye: the upper half of a torus."""
    bpy.ops.mesh.primitive_torus_add(major_radius=r, minor_radius=r * 0.28, location=(0, 0, 0),
                                     rotation=(D(90), 0, 0), major_segments=32, minor_segments=10)
    o = bpy.context.object
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < -0.0001 and abs(v.co.z) > r * 0.05], context="VERTS")
    bm.to_mesh(o.data)
    bm.free()
    o.location = loc
    o.name = name
    return finish(o, material, bone)


def led(color, strength=3.0):
    return mat(f"led_{color}", color, emit=color, strength=strength, rough=0.4)


_shell = {"r": 0.4, "scale": (1, 1, 1)}


def visor(z, w, h, r=0.4, scale=(1, 1, 1)):
    """Glossy glass mask that follows the head: a slightly larger shell cut to a rounded rectangle."""
    _shell.update(r=r * 1.02, scale=scale)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=96, ring_count=48, radius=r * 1.02, location=(0, 0, 0))
    shell = bpy.context.object
    shell.scale = scale
    bpy.ops.object.transform_apply(scale=True)
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, -r, z))
    cutter = bpy.context.object
    cutter.scale = (w, r * 1.4, h)
    bpy.ops.object.transform_apply(scale=True)
    bev = cutter.modifiers.new("round", "BEVEL")
    bev.width, bev.segments, bev.limit_method = min(w, h) * 0.46, 12, "NONE"
    bpy.context.view_layer.objects.active = cutter
    bpy.ops.object.modifier_apply(modifier="round")
    cut = shell.modifiers.new("cut", "BOOLEAN")
    cut.operation, cut.object, cut.solver = "INTERSECT", cutter, "EXACT"
    bpy.context.view_layer.objects.active = shell
    bpy.ops.object.modifier_apply(modifier="cut")
    bpy.data.objects.remove(cutter, do_unlink=True)
    shell.name = "visor"
    return finish(shell, VISOR(), "body")


def surface_y(x, z):
    r = _shell["r"]
    sx, sy, sz = _shell["scale"]
    inside = max(1 - (x / (r * sx)) ** 2 - (z / (r * sz)) ** 2, 0.0)
    return -r * sy * math.sqrt(inside)


def pill_eyes(z, spread, w, h, color, bone="eyes"):
    for s in (1, -1):
        y = surface_y(s * spread, z) - 0.006
        rbox(f"eye_{'L' if s > 0 else 'R'}", (s * spread, y, z), (w, 0.03, h), led(color), bone=bone,
             bevel=min(w, h) * 0.45, segments=6)


# ------------------------------------------------------------------ the five heads (front = -Y)
def startup():
    teal = mat("startup_teal", "#1f8fa8", metallic=0.55, rough=0.3, coat=0.8)
    body = ico("body", (0, 0, 0), 0.42, teal, subdiv=2, scale=(1.0, 0.95, 0.98))
    body.data.materials.append(mat("startup_plates", "#aebdc8", metallic=1.0, rough=0.22))
    for poly in body.data.polygons:
        c = poly.center
        if poly.index % 7 == 3 and not (abs(c.x) < 0.33 and c.y < 0 and abs(c.z) < 0.2):
            poly.material_index = 1
    visor(0.02, 0.58, 0.25, r=0.42, scale=(1.0, 0.95, 0.98))
    pill_eyes(0.03, 0.12, 0.13, 0.075, "#2aa8ff")
    for s in (1, -1):
        cyl("ear", (s * 0.42, 0, 0.0), 0.12, 0.12, CHROME(), rot=(0, D(90), 0), bevel=0.012)
        for k in range(4):
            torus("ear_grille", (s * (0.485 + 0.0), 0, 0), 0.03 + k * 0.022, 0.006, DARK(), rot=(0, D(90), 0))


def publisher():
    black = mat("publisher_black", "#1d1e22", rough=0.82, sheen=0.5)
    mb = bpy.data.metaballs.new("cloud")
    mb.resolution = 0.03
    mbo = bpy.data.objects.new("body", mb)
    bpy.context.collection.objects.link(mbo)
    for (x, z, r) in ((0, 0.06, 0.34), (-0.3, -0.05, 0.25), (0.3, -0.05, 0.25), (-0.17, 0.2, 0.25), (0.17, 0.2, 0.25),
                      (0, -0.12, 0.3), (-0.45, -0.14, 0.18), (0.45, -0.14, 0.18), (0, 0.28, 0.22)):
        el = mb.elements.new()
        el.co = (x, 0, z)
        el.radius = r * 1.3
    for o in bpy.context.selected_objects:
        o.select_set(False)
    bpy.context.view_layer.objects.active = mbo
    mbo.select_set(True)
    bpy.ops.object.convert(target="MESH")
    body = bpy.context.object
    body.name = "body"
    body.scale = (1.0, 0.72, 0.9)
    bpy.ops.object.transform_apply(scale=True)
    finish(body, black, "body")
    for s in (1, -1):
        arc_eye(f"eye_{'L' if s > 0 else 'R'}", (s * 0.12, -0.3, 0.03), 0.062, led("#ff3fa8", 4.0))
    gold = mat("nib_gold", "#d4a648", metallic=1.0, rough=0.2)
    cyl("nib_collar", (0, 0, 0.42), 0.055, 0.07, DARK(), bone="crest", verts=24)
    cone("nib", (0, 0, 0.56), 0.06, 0.004, 0.22, gold, bone="crest", verts=24)
    cyl("nib_slit", (0, -0.05, 0.56), 0.006, 0.13, DARK(), bone="crest", rot=(D(-14), 0, 0), verts=8)
    for x in (0.2, 0.31):
        cyl("dial", (x, -0.27, -0.06), 0.042, 0.06, CHROME(), rot=(D(90), 0, 0), bevel=0.006)
        cyl("dial_tick", (x, -0.302, -0.045), 0.007, 0.012, DARK(), rot=(D(90), 0, 0), verts=8)


def outreach():
    violet = mat("outreach_violet", "#5a46e6", metallic=0.5, rough=0.16, coat=1.0, film=380.0)
    sphere("body", (0, 0, 0), 0.4, violet)
    visor(0.02, 0.52, 0.24)
    pill_eyes(0.025, 0.11, 0.085, 0.085, "#7a3cff")
    for s in (1, -1):
        cyl("antenna", (s * 0.13, 0, 0.47), 0.012, 0.2, CHROME(), bone="crest", rot=(0, D(-s * 14), 0), verts=10)
        sphere("antenna_tip", (s * 0.155, 0, 0.58), 0.035, mat("antenna_violet", "#7d5cff", metallic=0.6, rough=0.2),
               bone="crest", seg=20, rings=10)
    cyl("megaphone_mount", (0.4, 0, -0.02), 0.07, 0.08, CHROME(), rot=(0, D(90), 0), bevel=0.01)
    cone("megaphone", (0.5, 0, -0.02), 0.06, 0.15, 0.18, CHROME(), rot=(0, D(90), 0), verts=40)
    cyl("megaphone_mouth", (0.592, 0, -0.02), 0.13, 0.01, DARK(), rot=(0, D(90), 0), verts=40)


def mailer():
    brass = mat("mailer_brass", "#c99a45", metallic=1.0, rough=0.3)
    sphere("body", (0, 0, 0), 0.4, brass)
    seam = mat("brass_dark", "#8e6a2c", metallic=1.0, rough=0.4)
    torus("seam", (0, 0, 0), 0.401, 0.008, seam, rot=(D(90), 0, 0))
    torus("seam_top", (0, 0, 0.27), 0.296, 0.007, seam)
    for i in range(18):
        a = 2 * math.pi * i / 18
        sphere("rivet", (0.404 * math.cos(a), 0.0, 0.404 * math.sin(a)), 0.014, DARK(), seg=10, rings=6)
        sphere("rivet_top", (0.299 * math.cos(a), 0.299 * math.sin(a), 0.272), 0.012, DARK(), seg=10, rings=6)
    visor(0.03, 0.48, 0.22)
    pill_eyes(0.035, 0.1, 0.075, 0.085, "#ff8c00")
    paper = mat("envelope_brass", "#d8b56a", metallic=0.7, rough=0.35)
    rbox("envelope", (0, 0.02, 0.47), (0.36, 0.05, 0.24), paper, bone="crest", bevel=0.012, segments=3, smooth=False)
    fold = mat("envelope_fold", "#b8903f", metallic=0.8, rough=0.35)
    for y in (-0.028, 0.068):
        bm = bmesh.new()
        a, b, c = bm.verts.new((-0.18, y, 0.59)), bm.verts.new((0.18, y, 0.59)), bm.verts.new((0, y, 0.45))
        bm.faces.new((a, c, b))
        me = bpy.data.meshes.new("flap")
        bm.to_mesh(me)
        bm.free()
        o = bpy.data.objects.new("envelope_flap", me)
        bpy.context.collection.objects.link(o)
        o.modifiers.new("thick", "SOLIDIFY").thickness = 0.008
        finish(o, fold, "crest", smooth=False)


def whatsapp():
    green = mat("whatsapp_green", "#17a352", rough=0.5, coat=0.5)
    sphere("body", (0, 0, 0), 0.4, green, scale=(1.05, 0.92, 0.98))
    cone("bubble_tail", (-0.27, -0.06, -0.34), 0.11, 0.0, 0.2, green, rot=(D(-15), D(-40), 0), verts=24)
    visor(0.02, 0.54, 0.32, scale=(1.05, 0.92, 0.98))
    for s in (1, -1):
        sphere(f"eye_{'L' if s > 0 else 'R'}", (s * 0.11, surface_y(s * 0.11, 0.025) - 0.004, 0.025), 0.062,
               led("#22e06a", 4.0), bone="eyes", scale=(1, 0.3, 1), seg=24, rings=12)
    cyl("antenna", (0.16, 0, 0.47), 0.012, 0.2, CHROME(), bone="crest", rot=(0, D(18), 0), verts=10)
    sphere("chat_bubble", (0.21, 0, 0.62), 0.085, green, bone="crest", scale=(1, 0.7, 1))
    cone("chat_tail", (0.15, 0, 0.55), 0.03, 0.0, 0.06, green, bone="crest", rot=(0, D(-140), 0), verts=12)
    white = mat("phone_white", "#ffffff", rough=0.4)
    rbox("phone", (0.21, -0.062, 0.62), (0.07, 0.012, 0.03), white, bone="crest", rot=(0, D(-40), 0), bevel=0.012,
         segments=4)


CHARACTERS = [
    ("Startup", startup, "#3fb6ff"),
    ("Publisher", publisher, "#ff5fb8"),
    ("Outreach", outreach, "#9b6bff"),
    ("Mailer", mailer, "#ffad2e"),
    ("WhatsApp", whatsapp, "#33f07a"),
]


# ------------------------------------------------------------------ rig: root (hover) > body > eyes, crest
def build_rig(name):
    data = bpy.data.armatures.new(name + "_rig")
    rig = bpy.data.objects.new(name + "_Rig", data)
    bpy.context.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    eb = data.edit_bones

    def bone(n, head, tail, parent=None):
        b = eb.new(n)
        b.head, b.tail, b.roll = head, tail, 0
        if parent:
            b.parent = eb[parent]

    bone("root", (0, 0, 0), (0, 0, 0.2))
    bone("body", (0, 0, HOVER - 0.3), (0, 0, HOVER + 0.3), "root")
    bone("eyes", (0, -0.4, HOVER + 0.02), (0, -0.4, HOVER + 0.12), "body")
    bone("crest", (0, 0, HOVER + 0.4), (0, 0, HOVER + 0.6), "body")
    bpy.ops.object.mode_set(mode="OBJECT")
    return rig


def bind(rig, parts):
    bpy.context.view_layer.update()
    for o, bone in parts:
        world = o.matrix_world.copy()
        o.parent = rig
        if bone:
            o.parent_type = "BONE"
            o.parent_bone = bone
        bpy.context.view_layer.update()
        o.matrix_world = world


def key(rig, f, bone, rot=None, loc=None, scale=None):
    pb = rig.pose.bones[bone]
    pb.rotation_mode = "XYZ"
    if rot is not None:
        pb.rotation_euler = tuple(D(a) for a in rot)
        pb.keyframe_insert("rotation_euler", frame=f)
    if loc is not None:
        pb.location = loc
        pb.keyframe_insert("location", frame=f)
    if scale is not None:
        pb.scale = scale
        pb.keyframe_insert("scale", frame=f)


def reset(rig):
    for pb in rig.pose.bones:
        pb.rotation_mode = "XYZ"
        pb.rotation_euler = (0, 0, 0)
        pb.location = (0, 0, 0)
        pb.scale = (1, 1, 1)


def action(rig, clip, build, frames):
    ad = rig.animation_data_create()
    ad.action = None
    reset(rig)
    build(rig)
    act = ad.action
    act.name = f"{rig.name.replace('_Rig', '')}_{clip}"
    act.use_fake_user = True
    track = ad.nla_tracks.new()
    track.name = clip
    track.strips.new(clip, 1, act).action_frame_end = frames
    ad.action = None
    reset(rig)


def blink(rig, at):
    for f, s in ((at - 2, 1.0), (at, 0.12), (at + 2, 1.0)):
        key(rig, f, "eyes", scale=(1, s, 1))


def idle(rig):  # gentle hover, a slow look around, one blink
    for f, z, tilt, turn in ((1, 0.0, 0, 0), (13, 0.035, 2, 6), (25, 0.0, 0, 0), (37, 0.035, -2, -6), (49, 0.0, 0, 0)):
        key(rig, f, "root", loc=(0, 0, z))
        key(rig, f, "body", rot=(tilt, 0, turn))
    key(rig, 1, "eyes", scale=(1, 1, 1))
    blink(rig, 30)
    key(rig, 49, "eyes", scale=(1, 1, 1))
    for f, w in ((1, 0), (13, 6), (25, 0), (37, -6), (49, 0)):
        key(rig, f, "crest", rot=(0, w, 0))


def hover(rig):  # livelier flight: figure-eight drift with banking
    for i in range(9):
        f = 1 + i * 6
        a = 2 * math.pi * i / 8
        key(rig, f, "root", loc=(0.12 * math.sin(a), 0, 0.06 + 0.05 * math.sin(2 * a)))
        key(rig, f, "body", rot=(4 * math.sin(2 * a), -10 * math.cos(a), 8 * math.sin(a)))
    key(rig, 1, "eyes", scale=(1, 1, 1))
    blink(rig, 26)
    key(rig, 49, "eyes", scale=(1, 1, 1))
    for f, w in ((1, -8), (13, 8), (25, -8), (37, 8), (49, -8)):
        key(rig, f, "crest", rot=(0, w, 0))


def wave(rig):  # happy hello: hop, squash, wiggle, blink
    for f, z, s in ((1, 0.0, 1.0), (5, -0.02, 0.92), (10, 0.12, 1.06), (15, 0.0, 0.94), (19, 0.07, 1.03),
                    (24, 0.0, 0.97), (37, 0.0, 1.0)):
        key(rig, f, "root", loc=(0, 0, z))
        key(rig, f, "body", scale=(1 + (1 - s) * 0.5, s, 1 + (1 - s) * 0.5))
    for f, r in ((1, 0), (10, 10), (15, -10), (20, 8), (26, -6), (31, 0), (37, 0)):
        key(rig, f, "body", rot=(0, r, 0))
    key(rig, 1, "eyes", scale=(1, 1, 1))
    blink(rig, 14)
    blink(rig, 28)
    key(rig, 37, "eyes", scale=(1, 1, 1))
    for f, w in ((1, 0), (8, 18), (14, -18), (20, 14), (27, -8), (37, 0)):
        key(rig, f, "crest", rot=(0, w, 0))


rigs = {}
for name, fn, halo in CHARACTERS:
    coll = bpy.data.collections.new(name)
    scene.collection.children.link(coll)
    bpy.context.view_layer.active_layer_collection = bpy.context.view_layer.layer_collection.children[name]
    _parts.clear()
    fn()
    for o, _ in _parts:
        o.location.z += HOVER
        o.name = f"{name}_{o.name}"
    rig = build_rig(name)
    bind(rig, list(_parts))
    _parts.clear()
    base = mat("pedestal", "#e7dccb", rough=0.5, coat=0.3)
    cyl(f"{name}_pedestal", (0, 0, -0.06), 0.3, 0.09, base, None, verts=64, bevel=0.025)
    torus(f"{name}_status_halo", (0, 0, -0.012), 0.3, 0.012, mat(f"halo_{halo}", halo, emit=halo, strength=2.5),
          None)
    _parts.clear()
    action(rig, "Idle", idle, 49)
    action(rig, "Hover", hover, 49)
    action(rig, "Wave", wave, 37)
    rigs[name] = (rig, coll)

for name, (rig, coll) in rigs.items():
    for o in bpy.context.selected_objects:
        o.select_set(False)
    for o in coll.all_objects:
        o.select_set(True)
    bpy.context.view_layer.objects.active = rig
    path = os.path.join(OUT, "glb", f"sahkarmi-{name.lower()}.glb")
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_apply=True,
                              export_animations=True, export_animation_mode="NLA_TRACKS", export_yup=True)
    print(f"{name}: {os.path.getsize(path) // 1024} KB")

# ------------------------------------------------------------------ studio, lineup
xs = [-2.0, -1.0, 0.0, 1.0, 2.0]
for (name, (rig, coll)), x in zip(rigs.items(), xs):
    rig.location.x = x
    for o in coll.all_objects:
        if o.parent is None and o is not rig:
            o.location.x += x
world = bpy.data.worlds.new("beige")
scene.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (*lin("#e9ddc9"), 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.6
scene.render.film_transparent = True
bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, -0.105))
floor = bpy.context.object
floor.name = "floor"
floor.data.materials.append(mat("floor", "#efe3d0", rough=0.9))
floor.hide_render = True


def light(name, loc, energy, color, size):
    d = bpy.data.lights.new(name, "AREA")
    d.energy, d.color, d.size = energy, color, size
    o = bpy.data.objects.new(name, d)
    scene.collection.objects.link(o)
    o.location = loc
    o.rotation_euler = (Vector((0, 0, 0.4)) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()


light("key", (-3, -5, 4), 600, (1, 0.96, 0.9), 4)
light("fill", (4, -4, 2), 220, (0.9, 0.95, 1), 5)
light("rim", (0, 5, 4), 700, (1, 1, 1), 4)
cd = bpy.data.cameras.new("cam")
cd.type = "ORTHO"
cd.ortho_scale = 5.4
cam = bpy.data.objects.new("camera", cd)
scene.collection.objects.link(cam)
cam.location = (0, -9, 2.6)
cam.rotation_euler = (Vector((0, 0, 0.42)) - cam.location).to_track_quat("-Z", "Y").to_euler()
scene.camera = cam
for engine in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT"):
    try:
        scene.render.engine = engine
        break
    except TypeError:
        continue
scene.view_settings.view_transform = "Standard"
for rig, _ in rigs.values():
    for t in rig.animation_data.nla_tracks:
        t.mute = t.name != "Idle"
scene.frame_set(1)
scene.render.resolution_x, scene.render.resolution_y = 1920, 820
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "sahkarmi_brand_faces.blend"))
scene.render.filepath = os.path.join(OUT, "renders", "lineup.png")
bpy.ops.render.render(write_still=True)

# ------------------------------------------------------------------ avatar frames: head only, straight on
if "avatars" in argv:
    scene.render.film_transparent = True
    scene.render.resolution_x = scene.render.resolution_y = 320
    for o in bpy.data.objects:
        if o.name == "floor" or "pedestal" in o.name or "status_halo" in o.name:
            o.hide_render = True
    for name, (rig, coll) in rigs.items():
        for other in bpy.data.collections:
            other.hide_render = other is not coll
        x = rig.location.x
        cd.ortho_scale = 1.42
        cam.location = (x, -9, HOVER + 0.75)
        cam.rotation_euler = (Vector((x, 0, HOVER + 0.08)) - cam.location).to_track_quat("-Z", "Y").to_euler()
        tracks = rig.animation_data.nla_tracks
        for clip, frames in (("Idle", range(1, 49, 2)), ("Wave", range(1, 38, 2))):
            for t in tracks:
                t.mute = t.name != clip
            for i, f in enumerate(frames):
                scene.frame_set(f)
                scene.render.filepath = os.path.join(OUT, "avatars", f"{name.lower()}-{clip.lower()}-{i:02d}.png")
                bpy.ops.render.render(write_still=True)

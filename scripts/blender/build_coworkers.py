# Sahkarmi AI Coworkers: five rigged, animated chibi robots -> .blend, .glb, preview renders.
# Run: blender -b -P build_coworkers.py -- <out_dir> [render]
import math
import os
import sys

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
OUT = argv[0] if argv else os.path.join(os.path.expanduser("~"), "Desktop", "Sahkarmi 3D Coworkers")
DO_RENDER = "render" in argv
os.makedirs(os.path.join(OUT, "glb"), exist_ok=True)
os.makedirs(os.path.join(OUT, "renders"), exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = 24
D = math.radians

# ---------------------------------------------------------------- materials
_mats = {}


def mat(name, color, metallic=0.0, rough=0.5, coat=0.0, emit=None, strength=0.0, sheen=0.0, iridescence=0.0):
    if name in _mats:
        return _mats[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes.get("Principled BSDF")
    p.inputs["Base Color"].default_value = (*color, 1)
    p.inputs["Metallic"].default_value = metallic
    p.inputs["Roughness"].default_value = rough
    for key, value in (("Coat Weight", coat), ("Sheen Weight", sheen), ("Thin Film Thickness", iridescence)):
        if key in p.inputs:
            p.inputs[key].default_value = value
    if emit:
        p.inputs["Emission Color"].default_value = (*emit, 1)
        p.inputs["Emission Strength"].default_value = strength
    m.diffuse_color = (*color, 1)
    _mats[name] = m
    return m


def hexrgb(h):
    h = h.lstrip("#")
    srgb = [int(h[i : i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb)


GLASS = lambda: mat("visor_glass", hexrgb("#10141c"), rough=0.06, coat=1.0)  # noqa: E731
STEEL = lambda: mat("anodized_steel", hexrgb("#9aa3ad"), metallic=1.0, rough=0.28)  # noqa: E731
DARKMETAL = lambda: mat("dark_metal", hexrgb("#3a3f47"), metallic=1.0, rough=0.35)  # noqa: E731

# ---------------------------------------------------------------- mesh helpers
_parts = []  # (object, bone) for the character being built


def _finish(obj, material, bone, smooth=True, bevel=0.0):
    obj.data.materials.append(material)
    if smooth:
        for poly in obj.data.polygons:
            poly.use_smooth = True
    if bevel:
        mod = obj.modifiers.new("bevel", "BEVEL")
        mod.width = bevel
        mod.segments = 2
        mod.limit_method = "ANGLE"
    _parts.append((obj, bone))
    return obj


def sphere(name, loc, r, material, bone, scale=(1, 1, 1), seg=32, rings=16, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=rings, radius=r, location=loc, rotation=rot)
    o = bpy.context.object
    o.name = name
    o.scale = scale
    return _finish(o, material, bone)


def cylinder(name, loc, r, depth, material, bone, rot=(0, 0, 0), verts=24, scale=(1, 1, 1), bevel=0.0):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=depth, location=loc, rotation=rot)
    o = bpy.context.object
    o.name = name
    o.scale = scale
    return _finish(o, material, bone, smooth=False, bevel=bevel)


def cone(name, loc, r1, r2, depth, material, bone, rot=(0, 0, 0), verts=24, smooth=True):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r1, radius2=r2, depth=depth, location=loc, rotation=rot)
    o = bpy.context.object
    o.name = name
    return _finish(o, material, bone, smooth=smooth)


def torus(name, loc, major, minor, material, bone, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor, location=loc, rotation=rot,
                                     major_segments=40, minor_segments=10)
    o = bpy.context.object
    o.name = name
    return _finish(o, material, bone)


def box(name, loc, size, material, bone, rot=(0, 0, 0), bevel=0.01):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.object
    o.name = name
    o.scale = size
    return _finish(o, material, bone, smooth=False, bevel=bevel)


def segment(name, a, b, r, material, bone):
    a, b = Vector(a), Vector(b)
    d = b - a
    rot = Vector((0, 0, 1)).rotation_difference(d.normalized()).to_euler()
    bpy.ops.mesh.primitive_cylinder_add(vertices=14, radius=r, depth=d.length, location=(a + b) / 2, rotation=rot)
    o = bpy.context.object
    o.name = name
    return _finish(o, material, bone)


def gem(name, center, r, h, material, bone, sides=8):
    """Faceted ceramic gem (elongated octahedron family)."""
    bm = bmesh.new()
    cx, cy, cz = center
    top = bm.verts.new((cx, cy, cz + h * 0.62))
    bot = bm.verts.new((cx, cy, cz - h * 0.5))
    rings = []
    for k, (rad, z, off) in enumerate(((r * 0.6, h * 0.36, 0.0), (r, 0.0, 0.5), (r * 0.66, -h * 0.3, 0.0))):
        ring = []
        for i in range(sides):
            a = 2 * math.pi * (i + off) / sides
            ring.append(bm.verts.new((cx + rad * math.cos(a), cy + rad * math.sin(a), cz + z)))
        rings.append(ring)
    for i in range(sides):
        j = (i + 1) % sides
        bm.faces.new((top, rings[0][i], rings[0][j]))
        bm.faces.new((rings[0][i], rings[1][i], rings[0][j]))
        bm.faces.new((rings[0][j], rings[1][i], rings[1][j]))
        bm.faces.new((rings[1][i], rings[2][i], rings[1][j]))
        bm.faces.new((rings[1][j], rings[2][i], rings[2][j]))
        bm.faces.new((rings[2][i], bot, rings[2][j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    return _finish(o, material, bone, smooth=False, bevel=0.012)


def cloud(name, center, material, bone):
    cx, cy, cz = center
    mb = bpy.data.metaballs.new(name + "_mb")
    mb.resolution = 0.045
    mbo = bpy.data.objects.new(name, mb)
    bpy.context.collection.objects.link(mbo)
    for (x, y, z, r) in ((0, 0, 0, 0.36), (-0.24, 0, -0.05, 0.27), (0.24, 0, -0.05, 0.27), (-0.13, 0.02, 0.17, 0.26),
                         (0.14, 0.02, 0.18, 0.25), (0, 0.05, -0.12, 0.3), (-0.33, 0.02, -0.12, 0.2), (0.33, 0.02, -0.12, 0.2)):
        el = mb.elements.new()
        el.co = (x, y, z)
        el.radius = r * 1.25
    bpy.context.view_layer.objects.active = mbo
    for o in bpy.context.selected_objects:
        o.select_set(False)
    mbo.select_set(True)
    bpy.ops.object.convert(target="MESH")
    o = bpy.context.object
    o.name = name
    o.location = (cx, cy, cz)
    return _finish(o, material, bone)


# ---------------------------------------------------------------- rig + common limbs
def build_rig(name, body_z, body_top, legs=True, hip_x=0.14, leg_len=0.36, arms=True, shoulder=(0.36, 0.0),
              arm_len=0.3, extra_bones=()):
    arm_data = bpy.data.armatures.new(name + "_rig")
    rig = bpy.data.objects.new(name + "_Rig", arm_data)
    bpy.context.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm_data.edit_bones

    def bone(n, head, tail, parent=None):
        b = eb.new(n)
        b.head, b.tail = head, tail
        b.roll = 0
        if parent:
            b.parent = eb[parent]
        return b

    bone("root", (0, 0, 0), (0, -0.25, 0))
    bone("body", (0, 0, body_z), (0, 0, body_top), "root")
    joints = {}
    if legs:
        for s, side in ((1, "L"), (-1, "R")):
            hip = (s * hip_x, 0, leg_len)
            knee = (s * hip_x * 1.05, -0.02, leg_len * 0.52)
            ankle = (s * hip_x * 1.05, 0.0, 0.07)
            toe = (s * hip_x * 1.05, -0.13, 0.03)
            bone(f"thigh.{side}", hip, knee, "root")
            bone(f"shin.{side}", knee, ankle, f"thigh.{side}")
            bone(f"foot.{side}", ankle, toe, f"shin.{side}")
            joints[side] = (hip, knee, ankle, toe)
    if arms:
        sx, sz = shoulder
        for s, side in ((1, "L"), (-1, "R")):
            sh = (s * sx, 0, sz)
            el = (s * (sx + 0.07), -0.02, sz - arm_len * 0.5)
            wr = (s * (sx + 0.09), -0.05, sz - arm_len)
            bone(f"upperarm.{side}", sh, el, "body")
            bone(f"forearm.{side}", el, wr, f"upperarm.{side}")
            joints["arm" + side] = (sh, el, wr)
    for n, head, tail in extra_bones:
        bone(n, head, tail, "body")
    bpy.ops.object.mode_set(mode="OBJECT")
    return rig, joints


def add_limbs(joints, metal, foot_mat, legs=True, arms=True, leg_r=0.035, arm_r=0.028, hand_mat=None):
    hand_mat = hand_mat or foot_mat
    if legs:
        for side in ("L", "R"):
            hip, knee, ankle, toe = joints[side]
            sphere(f"hip.{side}", hip, leg_r * 1.6, DARKMETAL(), f"thigh.{side}", seg=16, rings=8)
            segment(f"thigh.{side}", hip, knee, leg_r, metal, f"thigh.{side}")
            sphere(f"knee.{side}", knee, leg_r * 1.45, DARKMETAL(), f"shin.{side}", seg=16, rings=8)
            segment(f"shin.{side}", knee, ankle, leg_r * 0.9, metal, f"shin.{side}")
            sphere(f"ankle.{side}", ankle, leg_r * 1.3, DARKMETAL(), f"foot.{side}", seg=16, rings=8)
            fx, fy, _ = ankle
            box(f"foot.{side}", (fx, fy - 0.045, 0.03), (0.1, 0.19, 0.06), foot_mat, f"foot.{side}", bevel=0.022)
    if arms:
        for side in ("L", "R"):
            sh, el, wr = joints["arm" + side]
            sphere(f"shoulder.{side}", sh, arm_r * 1.7, DARKMETAL(), f"upperarm.{side}", seg=16, rings=8)
            segment(f"upperarm.{side}", sh, el, arm_r, metal, f"upperarm.{side}")
            sphere(f"elbow.{side}", el, arm_r * 1.4, DARKMETAL(), f"forearm.{side}", seg=16, rings=8)
            segment(f"forearm.{side}", el, wr, arm_r * 0.9, metal, f"forearm.{side}")
            sphere(f"hand.{side}", wr, arm_r * 2.0, hand_mat, f"forearm.{side}", seg=20, rings=10)


def eyes(z, y, spread, size, color, bone="body", shape=(1.0, 0.5, 1.25)):
    led = mat(f"led_{color}", hexrgb(color), emit=hexrgb(color), strength=2.2, rough=0.3)
    for s, side in ((1, "L"), (-1, "R")):
        sphere(f"eye.{side}", (s * spread, y, z), size, led, bone, scale=shape, seg=20, rings=10)


def pedestal(name, halo_hex):
    base = mat("pedestal", hexrgb("#efe6d6"), rough=0.55, coat=0.3)
    cylinder("pedestal", (0, 0, -0.04), 0.55, 0.08, base, None, verts=48, bevel=0.015)
    halo = mat(f"halo_{halo_hex}", hexrgb(halo_hex), emit=hexrgb(halo_hex), strength=2.0)
    torus("status_halo", (0, 0, 0.005), 0.5, 0.03, halo, None)


# ---------------------------------------------------------------- characters
def startup():
    clay = mat("startup_teal_ceramic", hexrgb("#178ea6"), rough=0.4, coat=0.6)
    rig, j = build_rig("Startup", 0.42, 1.12, leg_len=0.4, hip_x=0.13, shoulder=(0.31, 0.74), arm_len=0.32)
    gem("body", (0, 0, 0.78), 0.36, 0.62, clay, "body")
    sphere("visor", (0, -0.2, 0.84), 0.25, GLASS(), "body", scale=(1.0, 0.55, 0.62))
    eyes(0.85, -0.335, 0.085, 0.042, "#45c7ff")
    for s in (1, -1):
        cylinder("headset", (s * 0.33, 0, 0.86), 0.075, 0.07, STEEL(), "body", rot=(0, D(90), 0), bevel=0.01)
        cylinder("headset_pad", (s * 0.37, 0, 0.86), 0.05, 0.03, mat("headset_cap", hexrgb("#1f6f7b"), rough=0.5), "body",
                 rot=(0, D(90), 0))
    add_limbs(j, STEEL(), clay)
    return rig


def publisher():
    clay = mat("publisher_charcoal_matte", hexrgb("#2b2b30"), rough=0.75, sheen=0.4)
    rig, j = build_rig("Publisher", 0.38, 1.1, leg_len=0.36, hip_x=0.15, shoulder=(0.42, 0.66), arm_len=0.27,
                       extra_bones=[("crest", (0, 0, 1.05), (0, 0, 1.3))])
    cloud("body", (0, 0, 0.74), clay, "body")
    sphere("visor", (0, -0.27, 0.74), 0.26, GLASS(), "body", scale=(1.05, 0.45, 0.6))
    eyes(0.76, -0.385, 0.09, 0.04, "#ff6fb1", shape=(1.15, 0.5, 1.0))
    nib = mat("pen_nib_gold", hexrgb("#c9a14a"), metallic=1.0, rough=0.25)
    cone("pen_nib", (0, 0, 1.17), 0.07, 0.0, 0.2, nib, "crest", verts=16)
    cylinder("pen_collar", (0, 0, 1.06), 0.06, 0.04, DARKMETAL(), "crest", verts=20)
    add_limbs(j, STEEL(), clay)
    return rig


def outreach():
    pearl = mat("outreach_pearl_cobalt", hexrgb("#3a4fd8"), metallic=0.35, rough=0.22, coat=1.0, iridescence=420.0)
    violet = mat("outreach_violet", hexrgb("#7a4fe0"), metallic=0.6, rough=0.25, coat=0.8)
    rig, j = build_rig("Outreach", 0.4, 1.1, leg_len=0.38, hip_x=0.13, shoulder=(0.35, 0.72), arm_len=0.34)
    sphere("body", (0, 0, 0.76), 0.34, pearl, "body")
    cone("megaphone_visor", (0, -0.31, 0.78), 0.2, 0.28, 0.16, violet, "body", rot=(D(90), 0, 0), verts=32)
    sphere("visor_glass", (0, -0.36, 0.78), 0.23, GLASS(), "body", scale=(1, 0.25, 1))
    eyes(0.79, -0.41, 0.075, 0.038, "#b07bff")
    dial = mat("dial_chrome", hexrgb("#d9dce3"), metallic=1.0, rough=0.15)
    for s in (1, -1):
        cylinder("dial", (s * 0.33, 0.02, 0.86), 0.06, 0.05, dial, "body", rot=(0, D(90), 0), bevel=0.008)
        torus("dial_ring", (s * 0.36, 0.02, 0.86), 0.06, 0.01, violet, "body", rot=(0, D(90), 0))
    add_limbs(j, STEEL(), violet)
    return rig


def flap(material):
    bm = bmesh.new()
    a = bm.verts.new((-0.14, -0.022, 1.29))
    b = bm.verts.new((0.14, -0.022, 1.29))
    c = bm.verts.new((0, -0.022, 1.19))
    bm.faces.new((a, c, b))
    me = bpy.data.meshes.new("envelope_flap")
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new("envelope_flap", me)
    bpy.context.collection.objects.link(o)
    mod = o.modifiers.new("thick", "SOLIDIFY")
    mod.thickness = 0.006
    return _finish(o, mat("envelope_fold", hexrgb("#e6d7bb"), rough=0.7), "crest", smooth=False)


def mailer():
    brass = mat("mailer_brushed_brass", hexrgb("#c8963e"), metallic=1.0, rough=0.33)
    rig, j = build_rig("Mailer", 0.45, 1.15, legs=False, arms=False,
                       extra_bones=[("crest", (0, 0, 1.1), (0, 0, 1.3)), ("jet", (0, 0, 0.46), (0, 0, 0.18))])
    sphere("body", (0, 0, 0.8), 0.34, brass, "body")
    torus("porthole", (0, -0.315, 0.82), 0.14, 0.025, DARKMETAL(), "body", rot=(D(90), 0, 0))
    sphere("visor", (0, -0.3, 0.82), 0.14, GLASS(), "body", scale=(1, 0.4, 1))
    eyes(0.83, -0.355, 0.055, 0.035, "#ffb02e", shape=(1, 0.5, 1))
    for i in range(14):
        a = 2 * math.pi * i / 14
        sphere("rivet", (0.345 * math.cos(a), 0.345 * math.sin(a), 0.8), 0.014, DARKMETAL(), "body", seg=10, rings=6)
    paper = mat("envelope_paper", hexrgb("#f4ead8"), rough=0.7)
    box("envelope", (0, 0, 1.2), (0.28, 0.04, 0.18), paper, "crest", bevel=0.008)
    flap(paper)
    cylinder("envelope_seal", (0, -0.03, 1.2), 0.028, 0.012, mat("envelope_seal", hexrgb("#d24a3c"), rough=0.5),
             "crest", rot=(D(90), 0, 0), verts=20)
    cone("jet_nozzle", (0, 0, 0.42), 0.17, 0.1, 0.14, DARKMETAL(), "body", verts=32)
    flame = mat("jet_flame", hexrgb("#ff7a1a"), emit=hexrgb("#ff8c2a"), strength=5.0)
    core = mat("jet_core", hexrgb("#fff1b0"), emit=hexrgb("#ffe08a"), strength=6.0)
    cone("jet_flame", (0, 0, 0.2), 0.11, 0.0, 0.32, flame, "jet", rot=(D(180), 0, 0), verts=20)
    cone("jet_core", (0, 0, 0.27), 0.06, 0.0, 0.18, core, "jet", rot=(D(180), 0, 0), verts=16)
    return rig


def whatsapp():
    green = mat("whatsapp_emerald_matte", hexrgb("#1fae5b"), rough=0.68, sheen=0.3)
    rig, j = build_rig("WhatsApp", 0.34, 1.0, leg_len=0.3, hip_x=0.12, shoulder=(0.33, 0.62), arm_len=0.24,
                       extra_bones=[("crest", (0, 0, 0.98), (0, 0, 1.28))])
    sphere("body", (0, 0, 0.68), 0.34, green, "body", scale=(1.05, 0.95, 0.95))
    cone("bubble_tail", (-0.27, -0.08, 0.42), 0.09, 0.0, 0.2, green, "body", rot=(D(-20), D(-35), 0), verts=20)
    sphere("visor", (0, -0.24, 0.7), 0.24, GLASS(), "body", scale=(1.0, 0.48, 0.66))
    white = mat("eye_white", hexrgb("#e8fff1"), emit=hexrgb("#c6ffd9"), strength=3.0)
    for s in (1, -1):
        sphere("eye", (s * 0.08, -0.345, 0.71), 0.05, white, "body", scale=(1, 0.45, 1))
        sphere("pupil", (s * 0.08, -0.37, 0.705), 0.024, mat("pupil", hexrgb("#0b1a12"), rough=0.2), "body",
               scale=(1, 0.4, 1))
    segment("antenna", (0, 0, 1.0), (0.04, 0, 1.2), 0.012, STEEL(), "crest")
    sphere("antenna_tip", (0.04, 0, 1.22), 0.035, mat("antenna_glow", hexrgb("#5dff9b"), emit=hexrgb("#5dff9b"),
                                                       strength=6.0), "crest", seg=16, rings=8)
    add_limbs(j, STEEL(), green, leg_r=0.032, arm_r=0.026)
    return rig


CHARACTERS = [
    ("Startup", startup, "#3cc8ff", True),
    ("Publisher", publisher, "#ff6fb1", True),
    ("Outreach", outreach, "#a86bff", True),
    ("Mailer", mailer, "#ffb02e", False),
    ("WhatsApp", whatsapp, "#36e27a", True),
]


# ---------------------------------------------------------------- parenting
def bind(rig, parts):
    bpy.context.view_layer.update()
    for obj, bone in parts:
        world = obj.matrix_world.copy()
        obj.parent = rig
        if bone:
            obj.parent_type = "BONE"
            obj.parent_bone = bone
        bpy.context.view_layer.update()
        obj.matrix_world = world


# ---------------------------------------------------------------- animation
def key(rig, frame, bone, rot=None, loc=None, scale=None):
    pb = rig.pose.bones[bone]
    pb.rotation_mode = "XYZ"
    if rot is not None:
        pb.rotation_euler = Euler(tuple(D(a) for a in rot))
        pb.keyframe_insert("rotation_euler", frame=frame)
    if loc is not None:
        pb.location = loc
        pb.keyframe_insert("location", frame=frame)
    if scale is not None:
        pb.scale = scale
        pb.keyframe_insert("scale", frame=frame)


def reset(rig):
    for pb in rig.pose.bones:
        pb.rotation_mode = "XYZ"
        pb.rotation_euler = (0, 0, 0)
        pb.location = (0, 0, 0)
        pb.scale = (1, 1, 1)


def action(rig, name, builder, frames):
    ad = rig.animation_data_create()
    ad.action = None
    reset(rig)
    builder(rig)
    act = ad.action
    act.name = f"{rig.name.replace('_Rig', '')}_{name}"
    act.use_fake_user = True
    for fc in getattr(act, "fcurves", []):
        for kp in fc.keyframe_points:
            kp.interpolation = "BEZIER"
    track = ad.nla_tracks.new()
    track.name = name
    strip = track.strips.new(name, 1, act)
    strip.action_frame_end = frames
    ad.action = None
    reset(rig)
    return act


def walk(rig):
    for side, ph in (("L", 0), ("R", 12)):
        for f, th, sh, ft in ((1, 24, 6, -8), (7, 0, 42, -14), (13, -24, 4, 10), (19, 0, 6, 0), (25, 24, 6, -8)):
            fr = (f - 1 + ph) % 24 + 1
            key(rig, fr, f"thigh.{side}", rot=(th, 0, 0))
            key(rig, fr, f"shin.{side}", rot=(sh, 0, 0))
            key(rig, fr, f"foot.{side}", rot=(ft, 0, 0))
            if fr == 1:
                key(rig, 25, f"thigh.{side}", rot=(th, 0, 0))
                key(rig, 25, f"shin.{side}", rot=(sh, 0, 0))
                key(rig, 25, f"foot.{side}", rot=(ft, 0, 0))
    for f, bob, roll in ((1, -0.02, 4), (7, 0.03, 0), (13, -0.02, -4), (19, 0.03, 0), (25, -0.02, 4)):
        key(rig, f, "body", loc=(0, bob, 0), rot=(0, roll, 0))
    for side, s in (("L", -1), ("R", 1)):
        if f"upperarm.{side}" in rig.pose.bones:
            for f, a in ((1, -22 * s), (13, 22 * s), (25, -22 * s)):
                key(rig, f, f"upperarm.{side}", rot=(a, 0, 0))
                key(rig, f, f"forearm.{side}", rot=(-12, 0, 0))
    if "crest" in rig.pose.bones:
        for f, w in ((1, -5), (7, 6), (13, -5), (19, 6), (25, -5)):
            key(rig, f, "crest", rot=(w, 0, 0))


def idle(rig):
    for f, bob, tilt in ((1, 0.0, 0), (13, 0.018, 2.5), (25, 0.0, 0), (37, 0.018, -2.5), (49, 0.0, 0)):
        key(rig, f, "body", loc=(0, bob, 0), rot=(0, tilt, 0), scale=(1, 1 + bob * 1.5, 1))
    for side, s in (("L", 1), ("R", -1)):
        if f"upperarm.{side}" in rig.pose.bones:
            for f, a in ((1, 6 * s), (25, 10 * s), (49, 6 * s)):
                key(rig, f, f"upperarm.{side}", rot=(0, 0, a))
    if "crest" in rig.pose.bones:
        for f, w in ((1, 0), (13, 7), (25, 0), (37, -7), (49, 0)):
            key(rig, f, "crest", rot=(0, w, 0))


def wave(rig):
    for f, bob in ((1, 0.0), (19, 0.025), (37, 0.0)):
        key(rig, f, "body", loc=(0, bob, 0), rot=(0, 3, 0))
    if "upperarm.R" in rig.pose.bones:
        for f, a in ((1, 0), (7, 150), (31, 150), (37, 0)):
            key(rig, f, "upperarm.R", rot=(0, 0, a))
        for f, a in ((1, 0), (7, 20), (12, -25), (17, 20), (22, -25), (27, 20), (31, 0), (37, 0)):
            key(rig, f, "forearm.R", rot=(0, 0, a))
        for f, a in ((1, 6), (37, 6)):
            key(rig, f, "upperarm.L", rot=(0, 0, a))
    else:  # Mailer: friendly spin-and-tilt greeting
        for f, a in ((1, 0), (10, 20), (19, -20), (28, 20), (37, 0)):
            key(rig, f, "body", rot=(0, a * 0.5, 0))
    if "crest" in rig.pose.bones:
        for f, w in ((1, 0), (10, 12), (19, -12), (28, 12), (37, 0)):
            key(rig, f, "crest", rot=(0, w, 0))


def hover(rig):
    for f, z, tilt in ((1, 0.0, -3), (13, 0.08, 3), (25, 0.0, -3), (37, 0.08, 3), (49, 0.0, -3)):
        key(rig, f, "root", loc=(0, 0, z))
        key(rig, f, "body", rot=(tilt, 0, tilt * 0.6))
    for f, s in ((1, 1.0), (4, 1.35), (7, 0.9), (10, 1.3), (13, 1.0), (16, 1.4), (19, 0.95), (22, 1.3), (25, 1.0),
                 (28, 1.35), (31, 0.9), (34, 1.3), (37, 1.0), (40, 1.4), (43, 0.95), (46, 1.3), (49, 1.0)):
        key(rig, f, "jet", scale=(1, s, 1))
    if "crest" in rig.pose.bones:
        for f, w in ((1, 0), (13, -6), (25, 0), (37, 6), (49, 0)):
            key(rig, f, "crest", rot=(w, 0, 0))


# ---------------------------------------------------------------- build all
summary = []
rigs = {}
for name, fn, halo, legs in CHARACTERS:
    coll = bpy.data.collections.new(name)
    scene.collection.children.link(coll)
    bpy.context.view_layer.active_layer_collection = bpy.context.view_layer.layer_collection.children[name]
    _parts.clear()
    rig = fn()
    for obj, _ in _parts:
        obj.name = f"{name}_{obj.name}"
    bind(rig, list(_parts))
    _parts.clear()
    pedestal(name, halo)
    ped = list(_parts)
    for obj, _ in ped:
        obj.name = f"{name}_{obj.name}"
    _parts.clear()
    hover_anim = hover if not legs else None
    action(rig, "Idle", idle if legs else hover, 49)
    action(rig, "Walk" if legs else "Hover", walk if legs else hover, 25 if legs else 49)
    action(rig, "Wave", wave, 37)
    rigs[name] = (rig, coll)

# ---------------------------------------------------------------- export (one .glb per character)
for name, (rig, coll) in rigs.items():
    for o in bpy.context.selected_objects:
        o.select_set(False)
    objs = list(coll.all_objects)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = rig
    path = os.path.join(OUT, "glb", f"sahkarmi-{name.lower()}.glb")
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_animations=True,
        export_animation_mode="NLA_TRACKS",
        export_yup=True,
        export_draco_mesh_compression_enable=False,
    )
    tris = 0
    for o in objs:
        if o.type == "MESH":
            ev = o.evaluated_get(bpy.context.evaluated_depsgraph_get())
            m = ev.to_mesh()
            m.calc_loop_triangles()
            tris += len(m.loop_triangles)
            ev.to_mesh_clear()
    summary.append(f"{name}: {os.path.getsize(path) // 1024} KB, {tris} triangles, "
                   f"bones={len(rig.data.bones)}, clips={[t.name for t in rig.animation_data.nla_tracks]}")

# ---------------------------------------------------------------- lineup scene (preview render)
xs = [-2.6, -1.3, 0.0, 1.3, 2.6]
for (name, (rig, coll)), x in zip(rigs.items(), xs):
    rig.location.x = x
    for o in coll.all_objects:
        if o.parent is None and o is not rig:
            o.location.x += x

world = bpy.data.worlds.new("beige")
scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes["Background"]
bg.inputs["Color"].default_value = (*hexrgb("#efe4d2"), 1)
bg.inputs["Strength"].default_value = 0.9

bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, -0.08))
floor = bpy.context.object
floor.name = "floor"
floor.data.materials.append(mat("floor", hexrgb("#efe4d2"), rough=0.9))


def light(name, kind, loc, energy, color=(1, 1, 1), size=3.0):
    data = bpy.data.lights.new(name, kind)
    data.energy = energy
    data.color = color
    if kind == "AREA":
        data.size = size
    o = bpy.data.objects.new(name, data)
    scene.collection.objects.link(o)
    o.location = loc
    direction = Vector((0, 0, 0.6)) - Vector(loc)
    o.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    return o


light("key", "AREA", (-4, -5, 6), 1400, (1.0, 0.96, 0.9), 4)
light("fill", "AREA", (5, -4, 3), 500, (0.9, 0.95, 1.0), 5)
light("rim", "AREA", (0, 6, 5), 900, (1, 1, 1), 4)

cam_data = bpy.data.cameras.new("cam")
cam_data.type = "ORTHO"
cam_data.ortho_scale = 7.2
cam = bpy.data.objects.new("iso_camera", cam_data)
scene.collection.objects.link(cam)
cam.location = (6.5, -9.0, 6.2)
cam.rotation_euler = (Vector((0, 0, 0.55)) - cam.location).to_track_quat("-Z", "Y").to_euler()
scene.camera = cam

for engine in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT"):
    try:
        scene.render.engine = engine
        break
    except TypeError:
        continue
try:
    scene.eevee.use_raytracing = True
except AttributeError:
    pass
scene.render.resolution_x = 1920
scene.render.resolution_y = 1080
scene.view_settings.view_transform = "AgX"
try:
    scene.view_settings.look = "AgX - Medium High Contrast"
except TypeError:
    pass

# ready pose for the still: Idle frame 13 everywhere, Startup waving
for name, (rig, _) in rigs.items():
    ad = rig.animation_data
    for t in ad.nla_tracks:
        t.mute = t.name != ("Wave" if name in ("Startup", "WhatsApp") else "Idle")
scene.frame_set(13)

bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "sahkarmi_coworkers.blend"))
if DO_RENDER:
    scene.render.filepath = os.path.join(OUT, "renders", "lineup.png")
    bpy.ops.render.render(write_still=True)
print("SUMMARY")
for line in summary:
    print(line)

import math
import os
import sys

import bpy
from mathutils import Vector


def output_path():
    args = sys.argv
    if "--" not in args or len(args) <= args.index("--") + 1:
        raise RuntimeError("缺少 GLB 输出路径")
    return os.path.abspath(args[args.index("--") + 1])


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (
        bpy.data.meshes,
        bpy.data.curves,
        bpy.data.materials,
        bpy.data.armatures,
        bpy.data.actions,
    ):
        for block in list(datablocks):
            if block.users == 0:
                datablocks.remove(block)


def material(name, color, roughness=0.72, metallic=0.0):
    value = bpy.data.materials.new(name)
    value.diffuse_color = (*color, 1.0)
    value.use_nodes = True
    shader = value.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*color, 1.0)
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Metallic"].default_value = metallic
    return value


def create_armature():
    bpy.ops.object.armature_add(enter_editmode=True, location=(0, 0, 0))
    armature = bpy.context.object
    armature.name = "RuralPlayerGold"
    armature.data.name = "RuralPlayerGoldSkeleton"
    armature.data.edit_bones.remove(armature.data.edit_bones[0])

    specs = [
        ("root", (0, 0, 0), (0, 0, 0.18), None),
        ("hips", (0, 0, 0.90), (0, 0, 1.08), "root"),
        ("spine", (0, 0, 1.08), (0, 0, 1.32), "hips"),
        ("chest", (0, 0, 1.32), (0, 0, 1.53), "spine"),
        ("neck", (0, 0, 1.53), (0, 0, 1.66), "chest"),
        ("head", (0, 0, 1.66), (0, 0, 1.91), "neck"),
        ("upper_leg.L", (-0.15, 0, 0.96), (-0.15, 0, 0.57), "hips"),
        ("shin.L", (-0.15, 0, 0.57), (-0.15, 0, 0.17), "upper_leg.L"),
        ("foot.L", (-0.15, 0, 0.17), (-0.15, -0.23, 0.08), "shin.L"),
        ("upper_leg.R", (0.15, 0, 0.96), (0.15, 0, 0.57), "hips"),
        ("shin.R", (0.15, 0, 0.57), (0.15, 0, 0.17), "upper_leg.R"),
        ("foot.R", (0.15, 0, 0.17), (0.15, -0.23, 0.08), "shin.R"),
        ("upper_arm.L", (-0.30, 0, 1.47), (-0.61, 0, 1.29), "chest"),
        ("forearm.L", (-0.61, 0, 1.29), (-0.88, 0, 1.16), "upper_arm.L"),
        ("hand.L", (-0.88, 0, 1.16), (-1.00, 0, 1.11), "forearm.L"),
        ("upper_arm.R", (0.30, 0, 1.47), (0.61, 0, 1.29), "chest"),
        ("forearm.R", (0.61, 0, 1.29), (0.88, 0, 1.16), "upper_arm.R"),
        ("hand.R", (0.88, 0, 1.16), (1.00, 0, 1.11), "forearm.R"),
    ]
    bones = {}
    for name, head, tail, parent_name in specs:
        bone = armature.data.edit_bones.new(name)
        bone.head = head
        bone.tail = tail
        bone.use_deform = name != "root"
        if parent_name:
            bone.parent = bones[parent_name]
        bones[name] = bone

    bpy.ops.object.mode_set(mode="POSE")
    for bone in armature.pose.bones:
        bone.rotation_mode = "XYZ"
    bpy.ops.object.mode_set(mode="OBJECT")
    return armature


def add_weighted_sphere(parts, name, location, scale, mat, bone, segments=12, rings=8):
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=segments,
        ring_count=rings,
        location=location,
    )
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    group = obj.vertex_groups.new(name=bone)
    group.add(range(len(obj.data.vertices)), 1.0, "REPLACE")
    parts.append(obj)
    return obj


def add_weighted_segment(parts, name, start, end, radius, mat, bone):
    start_v = Vector(start)
    end_v = Vector(end)
    direction = end_v - start_v
    midpoint = (start_v + end_v) * 0.5
    obj = add_weighted_sphere(
        parts,
        name,
        midpoint,
        (radius, radius, max(radius, direction.length * 0.52)),
        mat,
        bone,
    )
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(direction.normalized())
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=False)
    return obj


def create_player_mesh(armature, mats):
    parts = []
    add_weighted_sphere(parts, "JerseyTorso", (0, 0, 1.32), (0.37, 0.24, 0.36), mats["jersey"], "chest", 16, 10)
    add_weighted_sphere(parts, "Shorts", (0, 0, 0.99), (0.30, 0.22, 0.18), mats["shorts"], "hips")
    add_weighted_sphere(parts, "Head", (0, 0, 1.78), (0.22, 0.20, 0.25), mats["skin"], "head", 16, 10)
    add_weighted_sphere(parts, "Hair", (0, 0.025, 1.93), (0.225, 0.205, 0.12), mats["hair"], "head")
    add_weighted_sphere(parts, "Nose", (0, -0.196, 1.79), (0.045, 0.055, 0.055), mats["skin"], "head", 10, 6)
    add_weighted_sphere(parts, "EyeL", (-0.073, -0.183, 1.83), (0.025, 0.018, 0.032), mats["dark"], "head", 8, 6)
    add_weighted_sphere(parts, "EyeR", (0.073, -0.183, 1.83), (0.025, 0.018, 0.032), mats["dark"], "head", 8, 6)

    for side, sign in (("L", -1), ("R", 1)):
        add_weighted_segment(parts, "UpperArm" + side, (0.30 * sign, 0, 1.46), (0.61 * sign, 0, 1.29), 0.105, mats["jersey"], "upper_arm." + side)
        add_weighted_segment(parts, "Forearm" + side, (0.61 * sign, 0, 1.29), (0.88 * sign, 0, 1.16), 0.085, mats["skin"], "forearm." + side)
        add_weighted_sphere(parts, "Hand" + side, (0.97 * sign, -0.01, 1.12), (0.085, 0.075, 0.10), mats["skin"], "hand." + side, 10, 6)
        add_weighted_segment(parts, "Thigh" + side, (0.15 * sign, 0, 0.93), (0.15 * sign, 0, 0.57), 0.14, mats["skin"], "upper_leg." + side)
        add_weighted_segment(parts, "Sock" + side, (0.15 * sign, 0, 0.57), (0.15 * sign, 0, 0.18), 0.105, mats["socks"], "shin." + side)
        add_weighted_sphere(parts, "Boot" + side, (0.15 * sign, -0.10, 0.10), (0.13, 0.22, 0.09), mats["boots"], "foot." + side, 12, 7)

    bpy.ops.object.select_all(action="DESELECT")
    for part in parts:
        part.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    player = bpy.context.object
    player.name = "PlayerGoldMesh"
    player.data.name = "PlayerGoldMesh"
    modifier = player.modifiers.new("RuralPlayerSkin", "ARMATURE")
    modifier.object = armature
    player.parent = armature
    for polygon in player.data.polygons:
        polygon.use_smooth = True
    return player


def reset_pose(armature):
    for bone in armature.pose.bones:
        bone.location = (0, 0, 0)
        bone.rotation_euler = (0, 0, 0)
        bone.scale = (1, 1, 1)


def key_pose(armature, frame, rotations=None, locations=None):
    reset_pose(armature)
    rotations = rotations or {}
    locations = locations or {}
    for name, value in rotations.items():
        armature.pose.bones[name].rotation_euler = value
    for name, value in locations.items():
        armature.pose.bones[name].location = value
    for bone in armature.pose.bones:
        bone.keyframe_insert("rotation_euler", frame=frame, group=bone.name)
        bone.keyframe_insert("location", frame=frame, group=bone.name)


def create_actions(armature):
    armature.animation_data_create()
    clips = {}

    def begin(name):
        action = bpy.data.actions.new(name)
        action.use_fake_user = True
        armature.animation_data.action = action
        clips[name] = action
        return action

    begin("idle")
    key_pose(armature, 1, {"chest": (0.015, 0, -0.02), "upper_arm.L": (0, 0.04, -0.04), "upper_arm.R": (0, -0.04, 0.04)})
    key_pose(armature, 15, {"chest": (-0.018, 0, 0.02), "upper_arm.L": (0, -0.03, -0.02), "upper_arm.R": (0, 0.03, 0.02)}, {"hips": (0, 0, 0.012)})
    key_pose(armature, 30, {"chest": (0.015, 0, -0.02), "upper_arm.L": (0, 0.04, -0.04), "upper_arm.R": (0, -0.04, 0.04)})

    begin("jog")
    for frame, phase in ((1, 1), (8, 0), (15, -1), (23, 0), (30, 1)):
        key_pose(armature, frame, {
            "upper_leg.L": (0.55 * phase, 0, 0),
            "upper_leg.R": (-0.55 * phase, 0, 0),
            "shin.L": (-0.28 * max(phase, 0), 0, 0),
            "shin.R": (-0.28 * max(-phase, 0), 0, 0),
            "upper_arm.L": (-0.48 * phase, 0, -0.12),
            "upper_arm.R": (0.48 * phase, 0, 0.12),
            "forearm.L": (-0.25, 0, 0),
            "forearm.R": (-0.25, 0, 0),
            "chest": (0.10, 0, 0),
        }, {"hips": (0, 0, 0.035 if phase == 0 else 0)})

    begin("sprint")
    for frame, phase in ((1, 1), (7, 0), (15, -1), (22, 0), (30, 1)):
        key_pose(armature, frame, {
            "upper_leg.L": (0.88 * phase, 0, 0),
            "upper_leg.R": (-0.88 * phase, 0, 0),
            "shin.L": (-0.62 * max(phase, 0), 0, 0),
            "shin.R": (-0.62 * max(-phase, 0), 0, 0),
            "upper_arm.L": (-0.76 * phase, 0, -0.16),
            "upper_arm.R": (0.76 * phase, 0, 0.16),
            "forearm.L": (-0.42, 0, 0),
            "forearm.R": (-0.42, 0, 0),
            "chest": (0.24, 0, 0),
            "neck": (-0.10, 0, 0),
        }, {"hips": (0, 0, 0.055 if phase == 0 else 0)})

    begin("pass")
    key_pose(armature, 1)
    key_pose(armature, 8, {
        "upper_leg.R": (0.52, 0, 0.08),
        "shin.R": (0.34, 0, 0),
        "upper_arm.L": (0, 0, -0.40),
        "upper_arm.R": (0, 0, 0.35),
        "chest": (0.02, 0, -0.12),
    })
    key_pose(armature, 14, {
        "upper_leg.R": (-0.38, 0, 0.06),
        "shin.R": (0.16, 0, 0),
        "foot.R": (0.10, 0, 0),
        "upper_arm.L": (0, 0, 0.32),
        "upper_arm.R": (0, 0, -0.42),
        "chest": (0.08, 0, 0.15),
    })
    key_pose(armature, 21, {"upper_leg.R": (-0.52, 0, 0), "chest": (0.04, 0, 0.06)})
    key_pose(armature, 30)

    begin("shoot")
    key_pose(armature, 1)
    key_pose(armature, 8, {
        "upper_leg.R": (0.85, 0, 0.16),
        "shin.R": (0.68, 0, 0),
        "upper_leg.L": (0.12, 0, -0.06),
        "upper_arm.L": (0, 0, -0.62),
        "upper_arm.R": (0, 0, 0.58),
        "chest": (0.16, 0, -0.22),
    })
    key_pose(armature, 15, {
        "upper_leg.R": (-0.56, 0, 0.10),
        "shin.R": (0.18, 0, 0),
        "foot.R": (0.12, 0, 0),
        "upper_leg.L": (-0.08, 0, 0),
        "upper_arm.L": (0, 0, 0.50),
        "upper_arm.R": (0, 0, -0.68),
        "chest": (0.24, 0, 0.24),
        "neck": (-0.12, 0, 0),
    }, {"hips": (0, -0.04, 0.02)})
    key_pose(armature, 23, {
        "upper_leg.R": (-0.90, 0, 0),
        "shin.R": (0.12, 0, 0),
        "chest": (0.14, 0, 0.12),
    })
    key_pose(armature, 30)

    begin("stumble")
    key_pose(armature, 1)
    key_pose(armature, 10, {
        "chest": (0.46, 0, 0.22),
        "neck": (-0.25, 0, -0.10),
        "upper_arm.L": (0, -0.20, -1.00),
        "upper_arm.R": (0, 0.20, 1.00),
        "upper_leg.L": (0.38, 0, -0.10),
        "upper_leg.R": (-0.32, 0, 0.10),
    }, {"hips": (0, -0.05, -0.08)})
    key_pose(armature, 20, {
        "chest": (0.22, 0, -0.24),
        "upper_arm.L": (0, 0.18, 0.76),
        "upper_arm.R": (0, -0.18, -0.76),
        "upper_leg.L": (-0.28, 0, 0),
        "upper_leg.R": (0.24, 0, 0),
    }, {"hips": (0, 0.02, -0.03)})
    key_pose(armature, 30)

    armature.animation_data.action = clips["idle"]
    bpy.context.scene.frame_start = 1
    bpy.context.scene.frame_end = 30
    bpy.context.scene.render.fps = 30
    return clips


def add_box(name, location, scale, mat):
    bpy.ops.mesh.primitive_cube_add(location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    return obj


def add_cylinder_between(name, start, end, radius, mat):
    start_v = Vector(start)
    end_v = Vector(end)
    direction = end_v - start_v
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=12,
        radius=radius,
        depth=direction.length,
        location=(start_v + end_v) * 0.5,
    )
    obj = bpy.context.object
    obj.name = name
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(direction.normalized())
    obj.data.materials.append(mat)
    return obj


def create_environment(mats):
    root = bpy.data.objects.new("GoldPitchRoot", None)
    bpy.context.collection.objects.link(root)
    objects = [add_box("Pitch", (0, 0, -0.05), (32, 21, 0.05), mats["grass"])]
    line_h = 0.015
    objects.extend([
        add_box("LineNorth", (0, 20.93, line_h), (32, 0.07, 0.018), mats["white"]),
        add_box("LineSouth", (0, -20.93, line_h), (32, 0.07, 0.018), mats["white"]),
        add_box("LineEast", (31.93, 0, line_h), (0.07, 21, 0.018), mats["white"]),
        add_box("LineWest", (-31.93, 0, line_h), (0.07, 21, 0.018), mats["white"]),
        add_box("Halfway", (0, 0, line_h), (0.055, 21, 0.018), mats["white"]),
    ])
    bpy.ops.mesh.primitive_torus_add(
        major_radius=4.8,
        minor_radius=0.055,
        major_segments=48,
        minor_segments=6,
        location=(0, 0, 0.02),
    )
    circle = bpy.context.object
    circle.name = "CenterCircle"
    circle.data.materials.append(mats["white"])
    objects.append(circle)

    for sign, label in ((-1, "West"), (1, "East")):
        x = 32 * sign
        back_x = 33.15 * sign
        for y in (-3.66, 3.66):
            objects.append(add_cylinder_between("GoalPost" + label, (x, y, 0), (x, y, 2.44), 0.06, mats["white"]))
            objects.append(add_cylinder_between("GoalDepth" + label, (x, y, 2.44), (back_x, y, 2.44), 0.045, mats["white"]))
        objects.append(add_cylinder_between("Crossbar" + label, (x, -3.66, 2.44), (x, 3.66, 2.44), 0.06, mats["white"]))

    for side in (-1, 1):
        y = 23.0 * side
        for x in (-15, 0, 15):
            objects.append(add_box("VillageStand", (x, y, 0.55), (5.2, 1.2, 0.55), mats["wood"]))
            objects.append(add_box("FestivalBanner", (x, y - 1.22 * side, 1.05), (4.8, 0.035, 0.38), mats["banner"]))

    tree_positions = [(-27, -24), (-18, 24), (25, 24), (28, -24), (-5, -24)]
    for index, (x, y) in enumerate(tree_positions):
        trunk = add_cylinder_between("TreeTrunk", (x, y, 0), (x, y, 1.7), 0.16, mats["wood"])
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=1.15, location=(x, y, 2.25))
        crown = bpy.context.object
        crown.name = "TreeCrown"
        crown.scale = (1.0, 0.8, 1.15)
        crown.data.materials.append(mats["leaf_a"] if index % 2 else mats["leaf_b"])
        objects.extend([trunk, crown])

    for obj in objects:
        obj.parent = root
    return root


def create_ball(mats):
    root = bpy.data.objects.new("BallGold", None)
    bpy.context.collection.objects.link(root)
    root.location = (0.18, -0.55, 0)
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=3, radius=0.11, location=(0, 0, 0.11))
    ball = bpy.context.object
    ball.name = "BallGoldWhite"
    ball.data.materials.append(mats["ball_white"])
    ball.parent = root
    patch_directions = [
        (0, -1, 0),
        (0.85, -0.35, 0.38),
        (-0.85, -0.35, 0.38),
        (0.62, 0.55, -0.28),
        (-0.62, 0.55, -0.28),
    ]
    for index, direction in enumerate(patch_directions):
        vector = Vector(direction).normalized()
        position = Vector((0, 0, 0.11)) + vector * 0.102
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=0.028, location=position)
        patch = bpy.context.object
        patch.name = "BallPatch" + str(index)
        patch.scale = (1.0, 0.45, 1.0)
        patch.data.materials.append(mats["dark"])
        patch.parent = root
    return root


def point_at(obj, target):
    direction = Vector(target) - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def render_previews(destination):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1024
    scene.render.resolution_y = 576
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False

    scene.world.use_nodes = True
    background = scene.world.node_tree.nodes.get("Background")
    background.inputs["Color"].default_value = (0.20, 0.34, 0.48, 1)
    background.inputs["Strength"].default_value = 0.45

    bpy.ops.object.light_add(type="AREA", location=(-8, -12, 18))
    key = bpy.context.object
    key.name = "PreviewKey"
    key.data.energy = 1800
    key.data.shape = "DISK"
    key.data.size = 12
    key.data.color = (1.0, 0.72, 0.48)
    point_at(key, (0, 0, 0))

    bpy.ops.object.light_add(type="AREA", location=(10, 8, 10))
    fill = bpy.context.object
    fill.name = "PreviewFill"
    fill.data.energy = 1100
    fill.data.size = 10
    fill.data.color = (0.48, 0.68, 1.0)
    point_at(fill, (0, 0, 1))

    bpy.ops.object.camera_add(location=(42, -50, 38))
    camera = bpy.context.object
    camera.name = "PreviewCamera"
    camera.data.lens = 48
    point_at(camera, (0, 0, 0))
    scene.camera = camera

    base, _extension = os.path.splitext(destination)
    scene.render.filepath = base + "-wide.png"
    bpy.ops.render.render(write_still=True)

    camera.location = (3.6, -5.2, 2.7)
    camera.data.lens = 58
    point_at(camera, (0, 0, 1.05))
    scene.render.filepath = base + "-player.png"
    bpy.ops.render.render(write_still=True)

    armature = bpy.data.objects.get("RuralPlayerGold")
    shoot = bpy.data.actions.get("shoot")
    if armature and armature.animation_data and shoot:
        armature.animation_data.action = shoot
        scene.frame_set(15)
        camera.location = (3.8, -5.8, 2.45)
        point_at(camera, (0, 0, 0.95))
        scene.render.filepath = base + "-shoot.png"
        bpy.ops.render.render(write_still=True)


def main():
    destination = output_path()
    os.makedirs(os.path.dirname(destination), exist_ok=True)
    clear_scene()
    mats = {
        "skin": material("SkinWarm", (0.74, 0.40, 0.24), 0.78),
        "jersey": material("VillageRed", (0.66, 0.055, 0.035), 0.62),
        "shorts": material("IndigoShorts", (0.025, 0.08, 0.16), 0.70),
        "socks": material("RiceWhiteSocks", (0.88, 0.82, 0.68), 0.78),
        "boots": material("CharcoalBoots", (0.025, 0.022, 0.018), 0.55),
        "hair": material("Hair", (0.025, 0.016, 0.012), 0.82),
        "dark": material("Ink", (0.012, 0.014, 0.018), 0.58),
        "grass": material("TerracedGrass", (0.12, 0.34, 0.11), 0.90),
        "white": material("PitchChalk", (0.93, 0.90, 0.78), 0.88),
        "wood": material("VillageTimber", (0.30, 0.12, 0.045), 0.86),
        "banner": material("FestivalRed", (0.74, 0.035, 0.02), 0.70),
        "leaf_a": material("LeafTea", (0.08, 0.25, 0.07), 0.92),
        "leaf_b": material("LeafSun", (0.20, 0.38, 0.07), 0.92),
        "ball_white": material("BallIvory", (0.94, 0.92, 0.82), 0.58),
    }
    armature = create_armature()
    create_player_mesh(armature, mats)
    create_actions(armature)
    create_environment(mats)
    create_ball(mats)

    bpy.context.scene.world.color = (0.035, 0.055, 0.08)
    bpy.context.scene["m0_contract"] = "64x42m|30fps|18bones|6clips"
    bpy.ops.export_scene.gltf(
        filepath=destination,
        export_format="GLB",
        export_yup=True,
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_force_sampling=True,
        export_optimize_animation_size=False,
        export_skins=True,
        export_def_bones=True,
        export_morph=False,
        export_cameras=False,
        export_lights=False,
        export_extras=True,
        export_materials="EXPORT",
        export_image_format="NONE",
        export_apply=False,
    )
    render_previews(destination)
    print("Generated:", destination)
    print("Actions:", ", ".join(sorted(action.name for action in bpy.data.actions)))
    print("Deform bones:", sum(1 for bone in armature.data.bones if bone.use_deform))


if __name__ == "__main__":
    main()

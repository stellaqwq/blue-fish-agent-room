"""Read the authored room and export an independent realtime asset. Never save source."""
import bpy
import json
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public' / 'assets'
OUT.mkdir(parents=True, exist_ok=True)
bpy.context.view_layer.update()

def bounds(objects):
    pts = [o.matrix_world @ Vector(c) for o in objects for c in o.bound_box]
    return {'min': [min(p[i] for p in pts) for i in range(3)],
            'max': [max(p[i] for p in pts) for i in range(3)]}

groups = {
    'bed': [o for o in bpy.data.objects if any(c.name.startswith('02 ') for c in o.users_collection)],
    'desk': [o for o in bpy.data.objects if o.name.startswith('Desk ·')],
    'chair': [o for o in bpy.data.objects if o.name.startswith(('Chair ·', 'Cardigan'))],
    'basket': [o for o in bpy.data.objects if o.name.startswith('Wastebasket ·')],
}
report = {'source': 'blue_night_room.blend', 'axes': 'Blender x,y,z -> Web x,z,-y',
          'bounds': {k: bounds(v) for k,v in groups.items() if v}, 'material_conversion': 'PBR base colours; procedural bump omitted, wood ramps averaged.'}

# Core glTF cannot transport Blender's procedural shader graph. Keep authored colour
# and surface properties; evaluated geometry keeps the sculpted fabric folds.
for m in bpy.data.materials:
    if not m.use_nodes:
        continue
    p = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if not p:
        continue
    color = list(m.diffuse_color)
    socket = p.inputs.get('Base Color')
    if socket and socket.is_linked:
        source = socket.links[0].from_node
        if source.type == 'VALTORGB':
            colors = [e.color[:] for e in source.color_ramp.elements]
            color = [sum(c[i] for c in colors)/len(colors) for i in range(4)]
    for name in ('Base Color', 'Normal'):
        s = p.inputs.get(name)
        if s:
            for link in list(s.links):
                m.node_tree.links.remove(link)
    p.inputs['Base Color'].default_value = color

# Export geometry only: realtime lighting is explicitly owned by the viewer.
bpy.ops.object.select_all(action='DESELECT')
for o in bpy.context.scene.objects:
    if o.type in {'MESH', 'CURVE', 'SURFACE', 'FONT'}:
        o.select_set(True)
        if o.type == 'MESH':
            for mod in o.modifiers:
                if mod.type == 'SUBSURF':
                    mod.levels = min(mod.levels, 1)
bpy.ops.export_scene.gltf(filepath=str(OUT / 'room.glb'), export_format='GLB',
    use_selection=True, export_apply=True, export_cameras=False, export_lights=False,
    export_animations=False, export_extras=False, export_yup=True)
(OUT / 'room-info.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print('ROOM_EXPORT', json.dumps({'bytes': (OUT/'room.glb').stat().st_size, **report}))

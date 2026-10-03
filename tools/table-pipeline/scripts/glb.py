# Minimal GLB writer for one mesh (positions, normals, uvs, indices, optional texture).
import json, struct
import numpy as np
def write_glb(path, pos, nrm, uv, idx, tex_bytes=None, mime='image/png', unlit=False):
    buf = bytearray(); views = []; accs = []
    def view(data, target=None):
        while len(buf) % 4: buf.append(0)
        views.append({'buffer': 0, 'byteOffset': len(buf), 'byteLength': len(data), **({'target': target} if target else {})}); buf.extend(data)
        return len(views) - 1
    def acc(arr, typ, comp, target, minmax=False):
        a = {'bufferView': view(arr.tobytes(), target), 'componentType': comp, 'count': len(arr), 'type': typ}
        if minmax: a['min'] = arr.min(0).tolist(); a['max'] = arr.max(0).tolist()
        accs.append(a); return len(accs) - 1
    attrs = {'POSITION': acc(pos.astype(np.float32), 'VEC3', 5126, 34962, True),
             'NORMAL': acc(nrm.astype(np.float32), 'VEC3', 5126, 34962),
             'TEXCOORD_0': acc(uv.astype(np.float32), 'VEC2', 5126, 34962)}
    ind = acc(idx.astype(np.uint32).reshape(-1), 'SCALAR', 5125, 34963)
    js = {'asset': {'version': '2.0', 'generator': 'air-smash theme bake'}, 'scene': 0, 'scenes': [{'nodes': [0]}],
          'nodes': [{'mesh': 0, 'name': 'table'}], 'meshes': [{'primitives': [{'attributes': attrs, 'indices': ind, 'material': 0}]}],
          'materials': [{'name': 'theme', 'pbrMetallicRoughness': {'metallicFactor': 0, 'roughnessFactor': 0.6}}],
          'accessors': accs, 'bufferViews': views, 'buffers': [{'byteLength': 0}]}
    if tex_bytes:
        js['images'] = [{'bufferView': view(tex_bytes), 'mimeType': mime}]; js['samplers'] = [{}]; js['textures'] = [{'source': 0, 'sampler': 0}]
        js['materials'][0]['pbrMetallicRoughness']['baseColorTexture'] = {'index': 0}
        if unlit: js['extensionsUsed'] = ['KHR_materials_unlit']; js['materials'][0]['extensions'] = {'KHR_materials_unlit': {}}
    while len(buf) % 4: buf.append(0)
    js['buffers'][0]['byteLength'] = len(buf)
    jb = json.dumps(js, separators=(',', ':')).encode(); jb += b' ' * ((4 - len(jb) % 4) % 4)
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(jb) + 8 + len(buf)))
        f.write(struct.pack('<II', len(jb), 0x4E4F534A)); f.write(jb)
        f.write(struct.pack('<II', len(buf), 0x004E4942)); f.write(bytes(buf))
